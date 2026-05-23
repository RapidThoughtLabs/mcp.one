import path from "node:path";
import os from "node:os";
import { Router } from "express";
import type { McpClientInstance } from "./mcp-client.js";
import { createAdminClient, AdminUnavailableError } from "./mcp-admin.js";
import { loadManifest, loadRegistries } from "../src/registry/auth.js";
import { writeConfigEnv } from "../src/lib/env-writer.js";
import { loadSystemConfig } from "../src/system-config.js";
import { resolveConfigDir } from "../src/lib/resolve-config-dir.js";

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

  // ── GET /api/server-settings ─────────────────────────────────────
  // Read current hot reload + log level from the mcp-one admin API.

  router.get("/server-settings", async (_req, res) => {
    try {
      const settings = await admin.get("/server-settings");
      res.json(settings);
    } catch (err) {
      if (err instanceof AdminUnavailableError) {
        // Return safe defaults when mcp-one is not connected
        res.json({ hotReload: true, logLevel: "info", unavailable: true });
        return;
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── POST /api/server-settings ────────────────────────────────────
  // Apply new hot reload / log level settings to the live mcp-one process.

  router.post("/server-settings", async (req, res) => {
    try {
      const data = await admin.post("/server-settings", req.body as unknown);
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
      const allTools = (await admin.get("/tools")) as { configId: string; name: string; description: string; inputSchema: Record<string, unknown> }[]
      const tools = allTools.filter((t) => t.configId === id);
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

  // ── POST /api/logs ───────────────────────────────────────────────
  // Client telemetry logging (for LLM request visibility in the backend console)

  router.post("/logs", (req, res) => {
    const { level, source, msg } = req.body as { level?: string; source?: string; msg?: string };
    if (level && source && msg) {
      mcp.addLog(
        level as "info" | "warn" | "error" | "debug",
        source as "mcp" | "api" | "config",
        msg
      );
    }
    res.json({ ok: true });
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
      const systemConfig = loadSystemConfig(process.cwd());
      const configDir = resolveConfigDir(undefined, systemConfig);
      const result = writeConfigEnv(configDir, configId, entries, overwrite);
      mcp.addLog("info", "api", `Credentials saved for: ${configId} (${result.written.join(", ")})`);
      // Tell mcp-one to reload this config's env so auth checks see the new values immediately.
      admin.post("/reload-env", { configId }).catch(() => {});
      res.json({ ok: true, written: result.written, skipped: result.skipped });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
