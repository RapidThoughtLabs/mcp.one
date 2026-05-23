import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { validateConfig } from "./loader.js";
import { loadConfigEnv } from "./lib/env-store.js";
import { log } from "./lib/logger.js";
import { CONNECTOR_TYPES, isConnectorType } from "./lib/connector-types.js";
import {
  RESERVED_IDS,
  validateBaseId,
  compoundId,
  toConfigSummary,
} from "./lib/config-rules.js";
import type { RegisteredTool, ParamDef } from "./types.js";

function buildInputSchema(params: ParamDef[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of params) {
    const prop: Record<string, unknown> = { type: p.type, description: p.description };
    if (p.default !== undefined) prop.default = p.default;
    properties[p.name] = prop;
    if (p.required) required.push(p.name);
  }
  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

export interface AdminContext {
  configDir: string;
  registry: { list(): RegisteredTool[] };
  watcher: { pause(): void; resume(): void; isPaused(): boolean } | null;
}

// ── In-memory server settings ─────────────────────────────────────
// These reset to defaults on process restart, which is intentional.
// The --debug CLI flag is the durable way to boot with debug logging.

type LogLevel = "debug" | "info" | "warn" | "error";

const VALID_LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

const serverSettings: { hotReload: boolean; logLevel: LogLevel } = {
  hotReload: true,
  logLevel: "info",
};

export function createAdminRouter(ctx: AdminContext): Router {
  const router = Router();

  // ── GET /admin/server-settings ───────────────────────────────────
  // Returns current runtime server settings (hot reload + log level).

  router.get("/server-settings", (_req, res) => {
    res.json({
      hotReload: ctx.watcher ? !ctx.watcher.isPaused() : serverSettings.hotReload,
      logLevel: serverSettings.logLevel,
    });
  });

  // ── POST /admin/server-settings ──────────────────────────────────
  // Accepts { hotReload?: boolean, logLevel?: string } and applies them live.

  router.post("/server-settings", (req, res) => {
    const body = req.body as { hotReload?: unknown; logLevel?: unknown };
    const errors: string[] = [];

    if (body.hotReload !== undefined) {
      if (typeof body.hotReload !== "boolean") {
        errors.push('"hotReload" must be a boolean');
      } else {
        serverSettings.hotReload = body.hotReload;
        if (ctx.watcher) {
          if (body.hotReload) {
            ctx.watcher.resume();
          } else {
            ctx.watcher.pause();
          }
        }
      }
    }

    if (body.logLevel !== undefined) {
      if (!VALID_LOG_LEVELS.includes(body.logLevel as LogLevel)) {
        errors.push(`"logLevel" must be one of: ${VALID_LOG_LEVELS.join(", ")}`);
      } else {
        serverSettings.logLevel = body.logLevel as LogLevel;
        log.setConsoleLevel(body.logLevel as LogLevel);
      }
    }

    if (errors.length > 0) {
      res.status(400).json({ error: errors.join("; ") });
      return;
    }

    res.json({
      ok: true,
      settings: {
        hotReload: ctx.watcher ? !ctx.watcher.isPaused() : serverSettings.hotReload,
        logLevel: serverSettings.logLevel,
      },
    });
  });

  // GET /admin/tools — all registered tools across all configs (unfiltered)
  router.get("/tools", (_req, res) => {
    const tools = ctx.registry.list().map((rt: RegisteredTool) => ({
      name: `${rt.configId}.${rt.tool.name}`,
      description: rt.tool.description,
      inputSchema: buildInputSchema(rt.tool.params),
      configId: rt.configId,
    }));
    res.json(tools);
  });

  // GET /admin/configs — flat array of ConfigSummary (raw JSON + live tool counts + auth status)
  router.get("/configs", (_req, res) => {
    const { configDir, registry } = ctx;

    const toolsByConfig = new Map<string, number>();
    for (const rt of registry.list()) {
      toolsByConfig.set(rt.configId, (toolsByConfig.get(rt.configId) ?? 0) + 1);
    }

    if (!fs.existsSync(configDir)) {
      res.json([]);
      return;
    }

    const configs = fs
      .readdirSync(configDir)
      .filter((f) => f.startsWith("mcp.") && f.endsWith(".json"))
      .flatMap((f) => {
        try {
          const raw = JSON.parse(
            fs.readFileSync(path.join(configDir, f), "utf-8"),
          ) as Record<string, unknown>;
          const id = String(raw["id"] ?? "");
          return [toConfigSummary(raw, toolsByConfig.get(id) ?? 0)];
        } catch {
          return [];
        }
      });

    res.json(configs);
  });

  // GET /admin/configs/:id — full ConfigSummary for a single config
  router.get("/configs/:id", (req, res) => {
    const id = req.params["id"]!;
    const filePath = path.join(ctx.configDir, `mcp.${id}.json`);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `Config "${id}" not found` });
      return;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
      const toolCount = ctx.registry.list().filter((rt) => rt.configId === id).length;
      res.json(toConfigSummary(raw, toolCount));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /admin/configs — create (body sends base id; server compounds it with connector.type)
  router.post("/configs", (req, res) => {
    const body = req.body as Record<string, unknown>;

    const idError = validateBaseId(body["id"]);
    if (idError) {
      res.status(400).json({ error: idError });
      return;
    }
    const baseId = body["id"] as string;

    const connector = body["connector"] as Record<string, unknown> | undefined;
    const connectorType = connector?.["type"] as string | undefined;
    if (!connectorType || !isConnectorType(connectorType)) {
      res.status(400).json({ error: `connector.type must be one of: ${CONNECTOR_TYPES.join(", ")}` });
      return;
    }

    const cId = compoundId(baseId, connectorType);
    const filePath = path.join(ctx.configDir, `mcp.${cId}.json`);

    if (fs.existsSync(filePath) && !body["force"]) {
      res.status(409).json({
        error: `Config "${baseId}" (${connectorType}) already exists as mcp.${cId}.json. Pass force: true to overwrite.`,
      });
      return;
    }

    const rawConfig: Record<string, unknown> = {
      id: cId,
      name: body["name"] ?? baseId,
      connector: body["connector"] ?? {},
      tools: body["tools"] ?? [],
    };
    if (body["description"]) rawConfig["description"] = body["description"];
    if (body["overlays"]) rawConfig["overlays"] = body["overlays"];

    try {
      validateConfig(rawConfig, `mcp.${cId}.json`);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    fs.mkdirSync(ctx.configDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(rawConfig, null, 2) + "\n", "utf-8");

    res.status(201).json({ ok: true, id: cId });
  });

  // PUT /admin/configs/:id — replace entire config (full validation, supports tool edits)
  router.put("/configs/:id", (req, res) => {
    const id = req.params["id"]!;

    if (RESERVED_IDS.includes(id)) {
      res.status(403).json({ error: `Config "${id}" is protected and cannot be replaced` });
      return;
    }

    const filePath = path.join(ctx.configDir, `mcp.${id}.json`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `Config "${id}" not found` });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const bodyId = typeof body["id"] === "string" ? body["id"] : id;
    if (bodyId !== id) {
      res.status(400).json({ error: `Body id "${bodyId}" does not match URL id "${id}"` });
      return;
    }

    const raw = { ...body, id };

    try {
      validateConfig(raw, `mcp.${id}.json`);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    fs.writeFileSync(filePath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
    res.json({ ok: true });
  });

  // POST /admin/reload-env — reload a config's secrets file into the env store.
  // Called by the Express bridge after credentials are written to disk.
  router.post("/reload-env", (req, res) => {
    const { configId } = req.body as { configId?: string };
    if (!configId || typeof configId !== "string") {
      res.status(400).json({ error: "configId is required" });
      return;
    }
    const filePath = path.join(ctx.configDir, `mcp.${configId}.env`);
    const count = loadConfigEnv(configId, filePath);
    res.json({ ok: true, configId, updated: count });
  });

  // DELETE /admin/configs/:id — delete config file
  router.delete("/configs/:id", (req, res) => {
    const id = req.params["id"]!;

    if (RESERVED_IDS.includes(id)) {
      res.status(403).json({ error: `Config "${id}" is protected and cannot be deleted` });
      return;
    }

    const filePath = path.join(ctx.configDir, `mcp.${id}.json`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `Config "${id}" not found` });
      return;
    }

    fs.unlinkSync(filePath);
    res.json({ ok: true });
  });

  return router;
}
