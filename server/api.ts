import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import type { McpClientInstance } from "./mcp-client.js";
import { createAdminClient, AdminUnavailableError } from "./mcp-admin.js";
import { loadManifest, loadRegistries } from "../src/registry/auth.js";

// ── Credential writer ─────────────────────────────────────────────
// Writes env vars to ~/.mcp-one.env (home-relative, same as src/lib/env-writer)
// and immediately loads them into process.env so mcp-one picks them up.

const ENV_PATH = path.join(os.homedir(), ".mcp-one.env");

function writeCredentials(
  serviceId: string,
  entries: { key: string; value: string }[],
  overwrite = false,
): string[] {
  const valid = entries.filter((e) => e.value.trim().length > 0);
  if (valid.length === 0) return [];

  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];

  // Strip trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  const written: string[] = [];
  const toAppend: { key: string; value: string }[] = [];

  for (const { key, value } of valid) {
    const idx = lines.findIndex((l) => {
      const t = l.trim();
      if (t.startsWith("#") || !t.includes("=")) return false;
      return t.slice(0, t.indexOf("=")).trim() === key;
    });

    if (idx !== -1 && overwrite) {
      lines[idx] = `${key}=${value}`;
      written.push(key);
    } else if (idx === -1) {
      toAppend.push({ key, value });
    }
    // idx !== -1 && !overwrite → skip (already set)
  }

  let result = lines.join("\n");
  if (toAppend.length > 0) {
    if (result.length > 0) result += "\n\n";
    result += `# ${serviceId} (added via mcp-one UI)\n`;
    for (const { key, value } of toAppend) {
      result += `${key}=${value}\n`;
      written.push(key);
    }
  } else if (written.length > 0) {
    result += "\n";
  }

  if (written.length > 0) {
    fs.writeFileSync(ENV_PATH, result, "utf-8");
  }

  // Always mirror submitted values into process.env, even when the file
  // write was skipped (key already present, overwrite=false). Without
  // this, a save can be a no-op on disk AND leave process.env empty,
  // causing the auth card to stay red forever.
  for (const { key, value } of valid) {
    process.env[key] = value;
  }

  return written;
}

// ─────────────────────────────────────────────────────────────────

export function createApiRouter(mcp: McpClientInstance): Router {
  const router = Router();
  const admin = createAdminClient(mcp);

  // ── GET /api/health ──────────────────────────────────────────────
  // Returns server status and MCP connection state

  router.get("/health", (_req, res) => {
    const { status, toolCount, endpoint } = mcp.getStatus();
    res.json({
      status: "ok",
      mcpStatus: status,
      mcpConnected: status === "connected",
      toolCount,
      endpoint,
      ts: Date.now(),
    });
  });

  // ── POST /api/connect ─────────────────────────────────────────────
  // Connect to a specific mcp-one HTTP endpoint

  router.post("/connect", async (req, res) => {
    const { endpoint } = req.body as { endpoint?: string };
    if (!endpoint || typeof endpoint !== "string") {
      res.status(400).json({ error: '"endpoint" (string) is required' });
      return;
    }
    try {
      await mcp.connectToEndpoint(endpoint);
      mcp.addLog("info", "api", `Connected to endpoint: ${endpoint}`);
      res.json({ ok: true, endpoint });
    } catch (err) {
      res.status(502).json({ error: `Failed to connect: ${(err as Error).message}` });
    }
  });

  // ── POST /api/disconnect ──────────────────────────────────────────
  // Disconnect from current mcp-one instance

  router.post("/disconnect", async (_req, res) => {
    await mcp.disconnect();
    res.json({ ok: true });
  });

  // ── GET /api/configs ─────────────────────────────────────────────
  // Proxy to mcp-one admin API — live tool counts included server-side.

  router.get("/configs", async (_req, res) => {
    try {
      const configs = await admin.get("/configs");
      res.json(configs);
    } catch (err) {
      if (err instanceof AdminUnavailableError) {
        res.json([]);
        return;
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── GET /api/configs/:id/detail ──────────────────────────────────
  // Full detail: config (via admin proxy) + runtime tools + registry origin

  router.get("/configs/:id/detail", async (req, res) => {
    try {
      const id = req.params["id"]!;
      let config: unknown;
      try {
        config = await admin.get(`/configs/${id}`);
      } catch (err) {
        if (err instanceof AdminUnavailableError) {
          res.status(503).json({ error: "mcp-one not connected" });
          return;
        }
        const status = (err as Error & { status?: number }).status;
        if (status === 404) {
          res.status(404).json({ error: `Config "${id}" not found` });
          return;
        }
        throw err;
      }
      const tools = mcp.listTools().filter((t) => t.configId === id);
      const manifest = loadManifest();
      const registries = loadRegistries();
      const entry = manifest.installed.find((e) => {
        const withoutNs = e.slug.replace(/^@[^/]+\//, "");
        const colonIdx  = withoutNs.indexOf(":");
        if (colonIdx === -1) return false;
        const base = withoutNs.slice(0, colonIdx);
        const ct   = withoutNs.slice(colonIdx + 1);
        return `${base}-${ct}` === id;
      }) ?? null;
      let registryUrl: string | null = null;
      if (entry) {
        const reg = registries.find((r) => r.name === entry.registry);
        registryUrl = reg?.url ?? null;
      }
      res.json({ config, tools, registry: entry ? { ...entry, registryUrl } : null });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── GET /api/configs/:id ─────────────────────────────────────────
  // Single config by id

  router.get("/configs/:id", async (req, res) => {
    try {
      const data = await admin.get(`/configs/${req.params["id"]!}`);
      res.json(data);
    } catch (err) {
      if (err instanceof AdminUnavailableError) {
        res.status(503).json({ error: "mcp-one not connected" });
        return;
      }
      const status = (err as Error & { status?: number }).status ?? 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  // ── POST /api/configs ────────────────────────────────────────────
  // Create a new config. Body uses base id; mcp-one compounds it with connector.type.

  router.post("/configs", async (req, res) => {
    try {
      const data = await admin.post("/configs", req.body as unknown);
      const id = (data as Record<string, unknown>)["id"] ?? (req.body as Record<string, unknown>)["id"] ?? "?";
      mcp.addLog("info", "config", `Config created: ${id}`);
      res.status(201).json(data);
    } catch (err) {
      if (err instanceof AdminUnavailableError) {
        res.status(503).json({ error: "mcp-one not connected" });
        return;
      }
      const status = (err as Error & { status?: number }).status ?? 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  // ── PUT /api/configs/:id ─────────────────────────────────────────
  // Replace entire config — full JSON including tools array.

  router.put("/configs/:id", async (req, res) => {
    try {
      const id = req.params["id"]!;
      const data = await admin.put(`/configs/${id}`, req.body as unknown);
      mcp.addLog("info", "config", `Config updated: ${id}`);
      res.json(data);
    } catch (err) {
      if (err instanceof AdminUnavailableError) {
        res.status(503).json({ error: "mcp-one not connected" });
        return;
      }
      const status = (err as Error & { status?: number }).status ?? 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  // ── DELETE /api/configs/:id ──────────────────────────────────────
  // Delete a config file via mcp-one admin API.

  router.delete("/configs/:id", async (req, res) => {
    try {
      const id = req.params["id"]!;
      const data = await admin.delete(`/configs/${id}`);
      mcp.addLog("info", "config", `Config deleted: ${id}`);
      res.json(data);
    } catch (err) {
      if (err instanceof AdminUnavailableError) {
        res.status(503).json({ error: "mcp-one not connected" });
        return;
      }
      const status = (err as Error & { status?: number }).status ?? 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  // ── GET /api/tools ───────────────────────────────────────────────
  // All tools from all configs (unfiltered — for dashboard sidebar)

  router.get("/tools", async (_req, res) => {
    try {
      const tools = await admin.get("/tools");
      res.json(tools);
    } catch (err) {
      if (err instanceof AdminUnavailableError) {
        res.status(503).json({ error: err.message });
      } else {
        res.status(500).json({ error: (err as Error).message });
      }
    }
  });

  // ── GET /api/tools/manifest ──────────────────────────────────────
  // The DISCOVERY_TRIO advertised to LLMs via MCP tools/list.
  // Used by the chat agent and the handshake preview card.

  router.get("/tools/manifest", (_req, res) => {
    res.json(mcp.listTools());
  });

  // ── POST /api/tools/call ─────────────────────────────────────────
  // Execute a tool: { name: string, arguments: object }

  router.post("/tools/call", async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const name = body["name"];
    const args = (body["arguments"] ?? {}) as Record<string, unknown>;

    // Build a caller label from optional agent headers forwarded by the UI.
    // The mcp-one server will also see X-Source: dashboard from the bridge transport.
    const callerParts = ["dashboard"];
    const agentId = req.headers["x-agent-id"] as string | undefined;
    const chatId  = req.headers["x-chat-id"]  as string | undefined;
    if (agentId) callerParts.push(`agent:${agentId}`);
    if (chatId)  callerParts.push(`chat:${chatId}`);
    const callerInfo = callerParts.join(" | ");

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: '"name" (string) is required' });
      return;
    }

    try {
      const result = await mcp.callTool(name, args);
      mcp.addLog("info", "api", `tools/call ${name} [${callerInfo}] → OK`);
      res.json({ ok: true, result });
    } catch (err) {
      const message = (err as Error).message;
      mcp.addLog("error", "api", `tools/call ${name} [${callerInfo}] → ERROR: ${message}`);
      const status = message === "MCP server not connected" ? 503 : 500;
      res.status(status).json({ error: message });
    }
  });

  // ── GET /api/logs ────────────────────────────────────────────────
  // In-memory activity log (last 500 entries)

  router.get("/logs", (_req, res) => {
    const limit = 500;
    const logs = mcp.getLogs().slice(-limit);
    res.json(logs);
  });

  // ── POST /api/credentials ────────────────────────────────────────
  // Write credential env vars to .env for a given config.
  // Body: { configId: string, entries: { key: string, value: string }[], overwrite?: boolean }

  router.post("/credentials", (req, res) => {
    const { configId, entries, overwrite = false } = req.body as {
      configId?: string;
      entries?: { key: string; value: string }[];
      overwrite?: boolean;
    };

    if (!configId || typeof configId !== "string") {
      res.status(400).json({ error: '"configId" (string) is required' });
      return;
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ error: '"entries" must be a non-empty array of {key, value}' });
      return;
    }

    try {
      const written = writeCredentials(configId, entries, overwrite);
      mcp.addLog("info", "api", `Credentials saved for: ${configId} (${written.join(", ")})`);
      // Fire-and-forget: tell mcp-one to reload .env so getMissingAuthVars() sees the new values.
      // Failure is non-fatal — the file is already written; mcp-one will pick it up on restart.
      admin.post("/reload-env", {}).catch(() => {});
      res.json({ ok: true, written });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
