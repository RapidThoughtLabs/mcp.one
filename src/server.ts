import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import type { McpConfig, RegisteredTool, CallerContext } from "./types.js";
import { buildInputSchema } from "./lib/schema.js";
import { execute } from "./executor.js";
import { createAdminRouter, getServerSettings, type ManifestStyle } from "./admin-api.js";
import type { LifecycleCtx, ConfigRuntime } from "./lifecycle/pipeline.js";
import { VERSION } from "./lib/version.js";
import { invalidate as invalidateValidationCache } from "./connectors/validation.js";

// ── Tool Registry ─────────────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  registerConfig(config: McpConfig): void {
    invalidateValidationCache(config.id);
    for (const tool of config.tools) {
      const qualifiedName = `${config.id}.${tool.name}`;
      const existing = this.tools.get(qualifiedName);
      if (existing && existing.configId !== config.id) {
        console.error(
          `[registry] ⚠️  Tool "${qualifiedName}" already registered by "${existing.configId}" — overwriting with "${config.id}"`,
        );
      }
      this.tools.set(qualifiedName, {
        configId: config.id,
        configName: config.name,
        configDescription: config.description,
        connectorConfig: config.connector,
        tool,
      });
    }
  }

  unregisterConfig(configId: string): void {
    invalidateValidationCache(configId);
    for (const [name, tool] of this.tools) {
      if (tool.configId === configId) {
        this.tools.delete(name);
      }
    }
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  size(): number {
    return this.tools.size;
  }
}

// ── Manifest view helpers ─────────────────────────────────────────

const DISCOVERY_FLAT = new Set(["one.search", "one.list_tools", "one.list_configs", "one.invoke"]);
const DISCOVERY_TRIO = new Set(["one.search", "one.list_tools", "one.list_configs"]);

function buildManifestView(style: ManifestStyle, registry: ToolRegistry) {
  if (style === "namespaced") {
    return {
      visible: registry.list().filter((rt) => DISCOVERY_TRIO.has(`${rt.configId}.${rt.tool.name}`)),
      rewrite: (qualified: string) => qualified,
      resolve: (incoming: string) => incoming,
    };
  }
  return {
    visible: registry.list().filter((rt) => DISCOVERY_FLAT.has(`${rt.configId}.${rt.tool.name}`)),
    rewrite: (qualified: string) => qualified.replace(/^one\./, ""),
    resolve: (incoming: string) => (incoming.includes(".") ? incoming : `one.${incoming}`),
  };
}

// ── Config Write Lock ─────────────────────────────────────────────

const BLOCKED_WHEN_LOCKED = new Set([
  "one.create_config", "one.update_config", "one.delete_config",
  "one.add_tool",      "one.remove_tool",   "one.update_tool",
  "one.registry_install", "one.registry_update", "one.auth_set",
]);

function blockedTool(qualifiedName: string, args: Record<string, unknown>): string | null {
  if (BLOCKED_WHEN_LOCKED.has(qualifiedName)) return qualifiedName;
  if (qualifiedName === "one.invoke") {
    const target = args["tool"];
    if (typeof target === "string" && BLOCKED_WHEN_LOCKED.has(target)) return target;
  }
  return null;
}

// ── Server factory — wire handlers onto a fresh Server instance ───

function makeServer(
  registry: ToolRegistry,
  transportCtx?: Partial<CallerContext>,
): Server {
  const server = new Server(
    { name: "heku", version: VERSION },
    { capabilities: { tools: {} } },
  );

  // ── tools/list ────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, () => {
    const { manifestStyle } = getServerSettings();
    const { visible, rewrite } = buildManifestView(manifestStyle, registry);
    const tools = visible.map((rt) => ({
      name: rewrite(`${rt.configId}.${rt.tool.name}`),
      description: manifestStyle === "flat"
        ? rt.tool.description
        : `[${rt.configId}] ${rt.tool.description}`,
      inputSchema: buildInputSchema(rt.tool.params),
    }));
    return { tools };
  });

  // ── tools/call ────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const incomingName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    const { manifestStyle, configWriteLock } = getServerSettings();
    const { resolve } = buildManifestView(manifestStyle, registry);
    const toolName = resolve(incomingName);

    // Build caller context: merge transport-level info (headers) with
    // any _meta fields the client injected into the MCP request itself.
    // _meta is the MCP spec's extension point — stdio clients can use it
    // since they have no headers.
    const meta = (request.params as Record<string, unknown>)._meta as
      | Record<string, unknown>
      | undefined;
    const caller: CallerContext = {
      requestId: randomUUID(),
      transport: transportCtx?.transport ?? "stdio",
      agentId: transportCtx?.agentId ?? (meta?.agentId as string | undefined),
      chatId: transportCtx?.chatId ?? (meta?.chatId as string | undefined),
      sessionId: transportCtx?.sessionId ?? (meta?.sessionId as string | undefined),
      source: transportCtx?.source ?? (meta?.source as string | undefined),
      ip: transportCtx?.ip,
    };

    // Config Write Lock: block mutating tools from LLM agents
    if (configWriteLock) {
      const blocked = blockedTool(toolName, args);
      if (blocked) {
        console.error(`[server] WRITE LOCK blocked: ${blocked} (called as ${incomingName})`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Config Write Lock is enabled — "${blocked}" is blocked. Disable it in heku settings to make config changes.`,
                lockEnabled: true,
              }),
            },
          ],
          isError: true,
        };
      }
    }

    const tool = registry.get(toolName);
    if (!tool) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: `Unknown tool: "${toolName}"`,
              available: registry.list().map((t) => `${t.configId}.${t.tool.name}`),
            }),
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await execute(tool, args, caller);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
        ],
        isError: !result.success,
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: (err as Error).message, tool: toolName }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// ── Start options ─────────────────────────────────────────────────

export interface StartServerOptions {
  /** Also bind an HTTP transport on `port` (default 3333). */
  http?: boolean;
  port?: number;
  /** Config directory — mounts /admin/configs/* REST API when http is true. */
  configDir?: string;
  /** Live watcher handle — enables the admin API to pause/resume hot reload. */
  watcher?: { pause(): void; resume(): void; isPaused(): boolean };
  /** Pipeline functions — enable lifecycle control via admin API. */
  getRuntime?: (configId: string) => ConfigRuntime | undefined;
  bringServerOnline?: (ctx: LifecycleCtx) => void;
  takeServerOffline?: (configId: string, reason: "user-stop" | "config-deleted") => void;
}

// ── startServer ───────────────────────────────────────────────────

export async function startServer(
  configs: McpConfig[],
  options: StartServerOptions = {},
): Promise<{
  registry: ToolRegistry;
  /**
   * Broadcast a tool-list-changed notification to every connected transport.
   * Call this after any registry mutation so LLMs see fresh tools.
   */
  notifyToolsChanged: () => Promise<void>;
}> {
  const registry = new ToolRegistry();
  for (const config of configs) {
    registry.registerConfig(config);
  }

  // All active Server instances — one per transport.
  // Each shares the same ToolRegistry so tool calls are consistent.
  const activeServers = new Set<Server>();

  async function notifyToolsChanged(): Promise<void> {
    await Promise.allSettled(
      [...activeServers].map((s) =>
        s.sendToolListChanged().catch((err: unknown) => {
          console.error("[server] sendToolListChanged error:", err);
        }),
      ),
    );
  }

  // ── Transport 1: stdio (always on) ───────────────────────────────
  // Claude Desktop / Cursor spawns heku and talks via stdio.
  // This never changes — zero breakage to existing integrations.

  const stdioServer = makeServer(registry, { transport: "stdio" });
  const stdioTransport = new StdioServerTransport();
  await stdioServer.connect(stdioTransport);
  activeServers.add(stdioServer);

  console.error(
    `[heku] stdio  ready — ${registry.size()} tools from ${configs.length} config(s)`,
  );

  // ── Transport 2: HTTP (opt-in via --http flag) ───────────────────
  // UI dashboard / remote clients connect here.
  // Running simultaneously with stdio — zero conflict.

  if (options.http) {
    const port = options.port ?? 3333;

    const app = express();
    app.use(express.json());

    // ── Health endpoint ─────────────────────────────────────────
    // The Express API bridge (server/mcp-client.ts) hits this first
    // to detect whether an HTTP-mode heku is already running.
    app.get("/health", (_req, res) => {
      res.json({
        ok: true,
        service: "heku",
        version: VERSION,
        toolCount: registry.size(),
        transport: "http+stdio",
      });
    });

    // ── Admin REST API ──────────────────────────────────────────────
    // Console config CRUD — humans editing JSON. Full replace-style PUT.
    // Separate from the MCP tools (one.*) which are narrow/additive for LLMs.
    if (options.configDir) {
      app.use("/admin", createAdminRouter({
        configDir: options.configDir,
        registry,
        watcher: options.watcher ?? null,
        onManifestStyleChanged: () => void notifyToolsChanged(),
        notifyToolsChanged,
        getRuntime: options.getRuntime,
        bringServerOnline: options.bringServerOnline,
        takeServerOffline: options.takeServerOffline,
      }));
      console.error(`[heku] admin  ready — http://localhost:${port}/admin/configs`);
    }

    // ── MCP streamable-HTTP endpoint ─────────────────────────────
    // Stateless mode: the SDK transport can only handle ONE request per
    // instance (_hasHandledRequest guard). Create a fresh transport+server
    // for every incoming request so the SDK never throws on reuse.
    // Extract caller identity from request headers so it can be threaded
    // through the tool call and surfaced in logs.
    app.all("/mcp", async (req, res) => {
      // Restore default timeouts (or leave at user's 60s)
      req.setTimeout(60000);
      res.setTimeout(60000);

      const transportCtx: Partial<CallerContext> = {
        transport: "http",
        agentId: req.headers["x-agent-id"] as string | undefined,
        chatId: req.headers["x-chat-id"] as string | undefined,
        sessionId: req.headers["x-session-id"] as string | undefined,
        source: req.headers["x-source"] as string | undefined,
        ip: req.ip ?? req.socket.remoteAddress,
      };
      const reqTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const reqServer = makeServer(registry, transportCtx);
      await reqServer.connect(reqTransport);

      // Track the server so it receives ToolListChanged broadcast notifications
      activeServers.add(reqServer);

      // Properly fix idle timeouts by sending SSE keep-alive comments.
      // This resets the TCP/Node idle timer without needing setTimeout(0),
      // preventing zombie connections while keeping long LLM waits alive.
      let keepAliveTimer: NodeJS.Timeout | undefined;
      if (req.method === "GET") {
        keepAliveTimer = setInterval(() => {
          if (!res.writableEnded) {
            res.write(": keepalive\n\n");
          } else {
            clearInterval(keepAliveTimer);
          }
        }, 15_000);
      }

      try {
        await reqTransport.handleRequest(req, res, req.body as unknown);
      } catch (err) {
        if (!res.headersSent) {
          res.status(500).json({ error: (err as Error).message });
        }
      } finally {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        // Prevent memory leaks when connection closes
        activeServers.delete(reqServer);
      }
    });

    app.listen(port, () => {
      console.error(`[heku] http   ready — http://localhost:${port}/mcp`);
      console.error(`[heku] health        → http://localhost:${port}/health`);
    });
  }

  return { registry, notifyToolsChanged };
}
