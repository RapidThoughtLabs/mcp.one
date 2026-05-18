import fs from "node:fs";
import { loadConfigs } from "../loader.js";
import { startServer } from "../server.js";
import { loadSystemConfig } from "../system-config.js";
import { configureLimiter } from "../rate-limiter.js";
import { startWatcher } from "../watcher.js";
import { checkAuthEnvVars } from "../auth/index.js";
import { resolveConfigDir } from "../lib/resolve-config-dir.js";
import { VERSION } from "../lib/version.js";
import { log } from "../lib/logger.js";
import { loadEnvFile } from "../lib/env-writer.js";
import { INTERNAL_CONFIG } from "../internal-config.js";
import { connectorRegistry } from "../connectors/registry.js";
import { HttpConnector } from "../connectors/http.js";
import { CliConnector } from "../connectors/cli.js";
import { FileConnector } from "../connectors/file.js";
import { GrpcConnector } from "../connectors/grpc.js";
import { GraphqlConnector } from "../connectors/graphql.js";
import { McpConnector } from "../connectors/mcp.js";
import { discoverMcpServers } from "../discovery.js";
import { InternalConnector } from "../connectors/internal.js";
import { SqlConnector } from "../connectors/sql.js";
import { MongoConnector } from "../connectors/mongodb.js";
import type {
  McpConfig,
  HttpConnectorConfig,
  CliConnectorConfig,
  FileConnectorConfig,
  McpConnectorConfig,
  GraphqlConnectorConfig,
  GrpcConnectorConfig,
  SqlConnectorConfig,
  MongoConnectorConfig,
} from "../types.js";

function authStatus(config: McpConfig): string {
  if (config.connector.type === "http") {
    const auth = (config.connector as HttpConnectorConfig).auth;
    if (!auth) return "";
    const missing = checkAuthEnvVars(auth);
    if (missing.length === 0) return "✅";
    return `⚠️  missing: ${missing.join(", ")}`;
  }
  if (config.connector.type === "graphql") {
    const gql = config.connector as GraphqlConnectorConfig;
    if (!gql.auth) return "";
    const missing = checkAuthEnvVars(gql.auth);
    if (missing.length === 0) return "✅";
    return `⚠️  missing: ${missing.join(", ")}`;
  }
  return "";
}

export async function run(args: string[]): Promise<void> {
  // ── Parse flags ──────────────────────────────────────────────────
  const httpMode = args.includes("--http");
  const debugMode = args.includes("--debug");
  const portIndex = args.indexOf("--port");
  const portArg = portIndex !== -1 ? parseInt(args[portIndex + 1] ?? "3333", 10) : 3333;
  const port = isNaN(portArg) ? 3333 : portArg;

  // Load .env so auth env vars are available when checking missing credentials.
  loadEnvFile();

  // ── Initialize logger ──────────────────────────────────────────
  log.init({ debug: debugMode });

  // Strip flags before resolving config dir so positional arg still works
  const positionalArgs = args.filter(
    (a, i) => !a.startsWith("--") && (args[i - 1] !== "--port"),
  );

  const systemConfig = loadSystemConfig(process.cwd());
  const configDir = resolveConfigDir(positionalArgs[0], systemConfig);

  // Auto-create the config dir on first run so the watcher and loader always have a target
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    log.info("server", `Created config dir: ${configDir}`);
  }

  // ── Register connectors ──────────────────────────────────────────

  const mcpConnector      = new McpConnector();
  const graphqlConnector  = new GraphqlConnector();
  const grpcConnector     = new GrpcConnector();
  const internalConnector = new InternalConnector();
  const sqlConnector      = new SqlConnector();
  const mongoConnector    = new MongoConnector();
  connectorRegistry.register(new HttpConnector());
  connectorRegistry.register(new CliConnector());
  connectorRegistry.register(new FileConnector());
  connectorRegistry.register(grpcConnector);
  connectorRegistry.register(graphqlConnector);
  connectorRegistry.register(mcpConnector);
  connectorRegistry.register(internalConnector);
  connectorRegistry.register(sqlConnector);
  connectorRegistry.register(mongoConnector);

  // ── Configure rate limiter ───────────────────────────────────────

  if (systemConfig.rate_limits && Object.keys(systemConfig.rate_limits).length > 0) {
    configureLimiter(systemConfig.rate_limits);
    console.error(
      `[mcp-one] Rate limits active for: ${Object.keys(systemConfig.rate_limits).join(", ")}`,
    );
  }

  // ── Load configs ─────────────────────────────────────────────────

  log.info("server", `Loading configs from: ${configDir}`);

  // "one" is reserved — the internal config is embedded and always takes precedence
  const handAuthored = loadConfigs(configDir).filter((c) => {
    if (c.id === "one") {
      log.warn("server", `mcp.one.json in ${configDir} is ignored — internal config is built-in`);
      return false;
    }
    return true;
  });
  const autoDiscovered = discoverMcpServers();

  // Internal config is always first; hand-authored ids take precedence over auto-discovered
  const handAuthoredIds = new Set(handAuthored.map((c) => c.id));
  const allConfigs = [
    INTERNAL_CONFIG,
    ...handAuthored,
    ...autoDiscovered.filter((c) => !handAuthoredIds.has(c.id) && c.id !== "one"),
  ];

  if (handAuthored.length === 0 && autoDiscovered.length === 0) {
    log.info("server", `No user configs yet — drop mcp.*.json files in ${configDir} or call one.registry_install`);
  }

  // Queue MCP, GraphQL, and gRPC configs for discovery during initAll()
  for (const config of allConfigs) {
    if (config.connector.type === "mcp") {
      mcpConnector.addConfig(config.id, config.connector as McpConnectorConfig);
    }
    if (config.connector.type === "graphql" && config.tools.length === 0) {
      graphqlConnector.addConfig(
        config.id,
        config.connector as GraphqlConnectorConfig,
        config.overlays,
      );
    }
    if (config.connector.type === "grpc" && config.tools.length === 0) {
      grpcConnector.addConfig(
        config.id,
        config.connector as GrpcConnectorConfig,
        config.overlays,
      );
    }
    if (config.connector.type === "sql") {
      sqlConnector.addConfig(config.id, config.connector as SqlConnectorConfig);
    }
    if (config.connector.type === "mongodb") {
      mongoConnector.addConfig(config.id, config.connector as MongoConnectorConfig);
    }
  }

  // ── Startup banner ───────────────────────────────────────────────

  const discoverableTypes = ["mcp", "graphql", "grpc"] as const;
  const nonDiscoverableToolCount = allConfigs
    .filter((c) => !discoverableTypes.includes(c.connector.type as typeof discoverableTypes[number]))
    .reduce((n, c) => n + c.tools.length, 0);
  const mcpConfigCount = allConfigs.filter((c) => c.connector.type === "mcp").length;
  const graphqlDiscoverCount = allConfigs.filter(
    (c) => c.connector.type === "graphql" && c.tools.length === 0,
  ).length;
  const grpcDiscoverCount = allConfigs.filter(
    (c) => c.connector.type === "grpc" && c.tools.length === 0,
  ).length;

  log.raw("");
  const verStr = `mcp.one  v${VERSION}`;
  const bannerWidth = 41;
  const pad = Math.max(0, bannerWidth - verStr.length);
  const lpad = Math.floor(pad / 2);
  const rpad = pad - lpad;
  const verLine = `│${" ".repeat(lpad)}${verStr}${" ".repeat(rpad)}│`;
  log.raw("┌─────────────────────────────────────────┐");
  log.raw(verLine);
  log.raw("│  one server. any protocol. any LLM.    │");
  log.raw("└─────────────────────────────────────────┘");
  log.raw("");

  const summaryParts = [`${allConfigs.length} config(s)`, `${nonDiscoverableToolCount} tool(s)`];
  if (mcpConfigCount > 0) summaryParts.push(`${mcpConfigCount} MCP proxy(s) discovering...`);
  if (graphqlDiscoverCount > 0) summaryParts.push(`${graphqlDiscoverCount} GraphQL introspecting...`);
  if (grpcDiscoverCount > 0) summaryParts.push(`${grpcDiscoverCount} gRPC discovering...`);
  summaryParts.push("hot-reload ON");
  if (debugMode) summaryParts.push("debug ON");
  if (httpMode) summaryParts.push(`HTTP :${port}`);
  log.raw(`  ${summaryParts.join(" · ")}`);
  log.raw("");

  for (const c of allConfigs) {
    log.raw(`  ◆ ${c.id}  (${c.name})`);
    log.raw(`    connector: ${c.connector.type}`);

    if (c.connector.type === "http") {
      const http = c.connector as HttpConnectorConfig;
      const status = authStatus(c);
      log.raw(`    url:   ${http.base_url}`);
      log.raw(`    auth:  ${http.auth?.type ?? "none"} ${status}`);
      const toolNames = c.tools.map((t) => t.name).join(", ");
      log.raw(`    tools: ${toolNames}`);
    } else if (c.connector.type === "cli") {
      const cli = c.connector as CliConnectorConfig;
      if (cli.cwd) log.raw(`    cwd:   ${cli.cwd}`);
      if (cli.timeout_ms) log.raw(`    timeout: ${cli.timeout_ms}ms`);
      log.raw(`    tools: ${c.tools.map((t) => t.name).join(", ")}`);
    } else if (c.connector.type === "file") {
      const file = c.connector as FileConnectorConfig;
      if (file.base_path) log.raw(`    base_path: ${file.base_path}`);
      log.raw(`    tools: ${c.tools.map((t) => t.name).join(", ")}`);
    } else if (c.connector.type === "mcp") {
      const mc = c.connector as McpConnectorConfig;
      log.raw(`    transport: ${mc.transport}`);
      if (mc.command) log.raw(`    command:   ${mc.command} ${(mc.args ?? []).join(" ")}`);
      log.raw(`    tools: (discovering on connect)`);
    } else if (c.connector.type === "graphql") {
      const gql = c.connector as GraphqlConnectorConfig;
      log.raw(`    endpoint: ${gql.endpoint}`);
      if (gql.auth) log.raw(`    auth:     ${gql.auth.type}`);
      if (c.tools.length === 0) {
        log.raw(`    tools: (discovering via introspection)`);
      } else {
        log.raw(`    tools: ${c.tools.map((t) => t.name).join(", ")}`);
      }
    } else if (c.connector.type === "grpc") {
      const grpc = c.connector as GrpcConnectorConfig;
      log.raw(`    endpoint: ${grpc.endpoint}`);
      if (grpc.proto_path) log.raw(`    proto:    ${grpc.proto_path}`);
      if (grpc.reflection) log.raw(`    discovery: server reflection`);
      const tlsLabel = !grpc.tls ? "insecure" : grpc.tls === true ? "TLS" : "mTLS";
      log.raw(`    tls:      ${tlsLabel}`);
      if (grpc.auth) log.raw(`    auth:     ${grpc.auth.type}`);
      if (c.tools.length === 0) {
        log.raw(`    tools: (discovering from proto)`);
      } else {
        log.raw(`    tools: ${c.tools.map((t) => t.name).join(", ")}`);
      }
    } else if (c.connector.type === "internal") {
      log.raw(`    tools: ${c.tools.map((t) => t.name).join(", ")}`);
    } else if (c.connector.type === "sql") {
      const sql = c.connector as SqlConnectorConfig;
      log.raw(`    dialect:  ${sql.dialect}`);
      log.raw(`    database: ${sql.database ?? "(via DSN)"}`);
      log.raw(`    tools: ${c.tools.map((t) => t.name).join(", ")}`);
    } else if (c.connector.type === "mongodb") {
      const mongo = c.connector as MongoConnectorConfig;
      log.raw(`    database: ${mongo.database ?? "(via DSN)"}`);
      log.raw(`    tools: ${c.tools.map((t) => t.name).join(", ")}`);
    } else {
      if (c.tools.length > 0) log.raw(`    tools: ${c.tools.map((t) => t.name).join(", ")}`);
    }

    log.raw("");
  }

  // Warn about unconfigured HTTP services (non-blocking)
  const unconfigured = allConfigs.filter(
    (c) =>
      c.connector.type === "http" &&
      (c.connector as HttpConnectorConfig).auth !== undefined &&
      checkAuthEnvVars((c.connector as HttpConnectorConfig).auth!).length > 0,
  );
  if (unconfigured.length > 0) {
    log.raw(`  ⚠️  ${unconfigured.length} config(s) have missing auth. Affected tools will return a structured error when called.`);
    log.raw(`     Run: mcp auth setup`);
    log.raw("");
  }

  // ── Start MCP server ─────────────────────────────────────────────

  // ── Apply self_config filtering before registering ───────────────
  // Controls which mcp.one.json tools are exposed to LLMs.

  if (systemConfig.self_config === false) {
    // Kill-switch: remove mcp.one.json entirely
    const before = allConfigs.length;
    allConfigs.splice(0, allConfigs.length, ...allConfigs.filter((c) => c.id !== "one"));
    if (allConfigs.length < before) {
      log.info("server", "self_config: false — mcp.one self-management disabled");
    }
  } else if (systemConfig.self_config && typeof systemConfig.self_config === "object") {
    const sc = systemConfig.self_config as { allow?: string[]; deny?: string[] };
    const oneConfig = allConfigs.find((c) => c.id === "one");
    if (oneConfig) {
      if (sc.allow) {
        oneConfig.tools = oneConfig.tools.filter((t) => sc.allow!.includes(t.name));
        log.info("server", `self_config.allow — exposing ${oneConfig.tools.length} tool(s)`);
      } else if (sc.deny) {
        oneConfig.tools = oneConfig.tools.filter((t) => !sc.deny!.includes(t.name));
        log.info("server", `self_config.deny — ${sc.deny.length} tool(s) hidden`);
      }
    }
  }

  // ── Connector lifecycle ──────────────────────────────────────────
  // Run initAll() BEFORE starting the server so the first tools/list
  // response already contains GraphQL/gRPC/MCP discovered tools —
  // no race condition, no tools/list_changed needed on connect.

  await connectorRegistry.initAll();

  // Inject discovered tools into configs before registering with server
  for (const config of allConfigs) {
    if (config.connector.type === "mcp") {
      config.tools = mcpConnector.getDiscoveredTools(config.id);
    }
    if (config.connector.type === "graphql" && config.tools.length === 0) {
      config.tools = graphqlConnector.getDiscoveredTools(config.id);
    }
    if (config.connector.type === "grpc" && config.tools.length === 0) {
      config.tools = grpcConnector.getDiscoveredTools(config.id);
    }
  }

  // Start server with the complete, fully-discovered tool list.
  // Use a ref so the watcher handle can be threaded into the admin router
  // before startWatcher() is actually called (server mounts the admin router first).
  const watcherRef: { pause(): void; resume(): void; isPaused(): boolean } = {
    pause() { /* will be overwritten once startWatcher runs */ },
    resume() { /* will be overwritten once startWatcher runs */ },
    isPaused() { return false; },
  };

  const { registry, notifyToolsChanged } = await startServer(allConfigs, {
    http: httpMode,
    port,
    configDir,
    watcher: watcherRef,
  });

  // ── Bind internal connector with live server context ────────────
  internalConnector.bind({ registry, notifyToolsChanged, configDir });

  // Graceful shutdown
  const shutdown = async () => {
    await connectorRegistry.teardownAll();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  const liveWatcher = startWatcher(configDir, registry, notifyToolsChanged);

  // Patch the ref so the already-mounted admin route delegate to the real watcher
  watcherRef.pause    = () => liveWatcher.pause();
  watcherRef.resume   = () => liveWatcher.resume();
  watcherRef.isPaused = () => liveWatcher.isPaused();
}
