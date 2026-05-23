import path from "node:path";
import { watch } from "chokidar";
import { loadConfigEnv, unloadConfigEnv } from "./lib/env-store.js";
import type { ToolRegistry } from "./server.js";
import { loadSingleConfig } from "./loader.js";
import { connectorRegistry } from "./connectors/registry.js";
import type { GraphqlConnector } from "./connectors/graphql.js";
import type { GrpcConnector } from "./connectors/grpc.js";
import type { SqlConnector } from "./connectors/sql.js";
import type { MongoConnector } from "./connectors/mongodb.js";
import type { GraphqlConnectorConfig, GrpcConnectorConfig, SqlConnectorConfig, MongoConnectorConfig } from "./types.js";

// ── Constants ──────────────────────────────────────────────────────

/** Wait for file writes to settle before reloading (handles editors that
 *  write via temp-file rename, e.g. vim, VS Code). */
const DEBOUNCE_MS = 300;

// ── Internal helpers ───────────────────────────────────────────────

/** Returns true if the path looks like a mcp.*.json config file (excluding the reserved mcp.one.json). */
function isMcpConfigFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return base.startsWith("mcp.") && base.endsWith(".json") && base !== "mcp.one.json";
}

/** Returns true if the path looks like a per-config secrets file (mcp.*.env). */
function isMcpEnvFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return base.startsWith("mcp.") && base.endsWith(".env");
}

/** Extract configId from a mcp.{configId}.env filename. */
function configIdFromEnvFile(filePath: string): string {
  const base = path.basename(filePath); // "mcp.github-graphql.env"
  return base.slice(4, -4);             // "github-graphql"
}

function makeDebouncer() {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return function debounce(key: string, fn: () => void | Promise<void>): void {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        const result = fn();
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            console.error("[watcher] async handler error:", err);
          });
        }
      }, DEBOUNCE_MS),
    );
  };
}

// ── startWatcher ───────────────────────────────────────────────────

/**
 * Watch `configDir` for `mcp.*.json` files.
 * On add / change / unlink → update the ToolRegistry and call
 * `notifyToolsChanged()` so all connected transports (stdio + HTTP)
 * see fresh tools without a restart.
 *
 * Note: chokidar v4+ dropped glob support — we watch the directory and
 * filter events by filename pattern ourselves.
 *
 * @param configDir          Directory to watch (same one passed to loadConfigs)
 * @param registry           Live ToolRegistry from startServer()
 * @param notifyToolsChanged Broadcasts tool-list-changed to all active transports
 */
export interface WatcherHandle {
  pause(): void;
  resume(): void;
  isPaused(): boolean;
}

export function startWatcher(
  configDir: string,
  registry: ToolRegistry,
  notifyToolsChanged: () => Promise<void>,
): WatcherHandle {
  // Track which file owns which configId so we can unregister on unlink
  // without being able to read the deleted file.
  const fileToConfigId = new Map<string, string>();

  let paused = false;

  const debounce = makeDebouncer();

  // Watch the directory (not a glob — chokidar v4+ removed glob support).
  // We filter events to mcp.*.json ourselves via isMcpConfigFile().
  const watcher = watch(configDir, {
    ignoreInitial: true, // initial configs already loaded by cli.ts
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  // ── add ────────────────────────────────────────────────────────
  watcher.on("add", (filePath) => {
    if (isMcpEnvFile(filePath)) {
      debounce(filePath, () => {
        const configId = configIdFromEnvFile(filePath);
        const count = loadConfigEnv(configId, filePath);
        console.error(`[watcher] + ${path.basename(filePath)} (${count} var(s))`);
      });
      return;
    }
    if (!isMcpConfigFile(filePath)) return;
    debounce(filePath, async () => {
      if (paused) return;
      console.error(`[watcher] + ${path.basename(filePath)}`);

      const config = loadSingleConfig(filePath);
      if (!config) return;

      // If we somehow already have an entry for this path, clean it up first
      const prevId = fileToConfigId.get(filePath);
      if (prevId) registry.unregisterConfig(prevId);

      // Re-introspect GraphQL configs with empty tools
      if (config.connector.type === "graphql" && config.tools.length === 0) {
        const gql = connectorRegistry.get("graphql") as GraphqlConnector;
        await gql.reinitConfig(
          config.id,
          config.connector as GraphqlConnectorConfig,
          config.overlays,
        );
        config.tools = gql.getDiscoveredTools(config.id);
      }

      // Re-discover gRPC configs with empty tools
      if (config.connector.type === "grpc" && config.tools.length === 0) {
        const grpc = connectorRegistry.get("grpc") as GrpcConnector;
        await grpc.reinitConfig(
          config.id,
          config.connector as GrpcConnectorConfig,
          config.overlays,
        );
        config.tools = grpc.getDiscoveredTools(config.id);
      }

      // Reinit SQL pool on add
      if (config.connector.type === "sql") {
        const sql = connectorRegistry.get("sql") as SqlConnector;
        await sql.reinitConfig(config.id, config.connector as SqlConnectorConfig);
      }

      // Reinit MongoDB client on add
      if (config.connector.type === "mongodb") {
        const mongo = connectorRegistry.get("mongodb") as MongoConnector;
        await mongo.reinitConfig(config.id, config.connector as MongoConnectorConfig);
      }

      fileToConfigId.set(filePath, config.id);
      registry.registerConfig(config);
      await notifyToolsChanged();
      console.error(
        `[watcher]   ✓ Added "${config.id}" — ${config.tools.length} tools (${registry.size()} total)`,
      );
    });
  });

  // ── change ─────────────────────────────────────────────────────
  watcher.on("change", (filePath) => {
    if (isMcpEnvFile(filePath)) {
      debounce(filePath, () => {
        const configId = configIdFromEnvFile(filePath);
        const count = loadConfigEnv(configId, filePath);
        console.error(`[watcher] ~ ${path.basename(filePath)} (${count} var(s))`);
      });
      return;
    }
    if (!isMcpConfigFile(filePath)) return;
    debounce(filePath, async () => {
      if (paused) return;
      console.error(`[watcher] ~ ${path.basename(filePath)}`);

      // Remove previous version of this config
      const oldId = fileToConfigId.get(filePath);
      if (oldId) registry.unregisterConfig(oldId);

      const config = loadSingleConfig(filePath);
      if (!config) {
        // File is now invalid — remove it from tracking and notify
        if (oldId) {
          fileToConfigId.delete(filePath);
          await notifyToolsChanged();
          console.error(
            `[watcher]   ✗ "${oldId}" removed (invalid config) — ${registry.size()} total tools`,
          );
        }
        return;
      }

      // Re-introspect GraphQL configs with empty tools
      if (config.connector.type === "graphql" && config.tools.length === 0) {
        const gql = connectorRegistry.get("graphql") as GraphqlConnector;
        await gql.reinitConfig(
          config.id,
          config.connector as GraphqlConnectorConfig,
          config.overlays,
        );
        config.tools = gql.getDiscoveredTools(config.id);
      }

      // Re-discover gRPC configs with empty tools
      if (config.connector.type === "grpc" && config.tools.length === 0) {
        const grpc = connectorRegistry.get("grpc") as GrpcConnector;
        await grpc.reinitConfig(
          config.id,
          config.connector as GrpcConnectorConfig,
          config.overlays,
        );
        config.tools = grpc.getDiscoveredTools(config.id);
      }

      // Reinit SQL pool on change
      if (config.connector.type === "sql") {
        const sql = connectorRegistry.get("sql") as SqlConnector;
        await sql.reinitConfig(config.id, config.connector as SqlConnectorConfig);
      }

      // Reinit MongoDB client on change
      if (config.connector.type === "mongodb") {
        const mongo = connectorRegistry.get("mongodb") as MongoConnector;
        await mongo.reinitConfig(config.id, config.connector as MongoConnectorConfig);
      }

      fileToConfigId.set(filePath, config.id);
      registry.registerConfig(config);
      await notifyToolsChanged();
      console.error(
        `[watcher]   ↺ Reloaded "${config.id}" — ${config.tools.length} tools (${registry.size()} total)`,
      );
    });
  });

  // ── unlink ─────────────────────────────────────────────────────
  watcher.on("unlink", (filePath) => {
    if (isMcpEnvFile(filePath)) {
      debounce(filePath, () => {
        const configId = configIdFromEnvFile(filePath);
        unloadConfigEnv(configId);
        console.error(`[watcher] - ${path.basename(filePath)}`);
      });
      return;
    }
    if (!isMcpConfigFile(filePath)) return;
    debounce(filePath, async () => {
      if (paused) return;
      const configId = fileToConfigId.get(filePath);
      if (!configId) return;

      registry.unregisterConfig(configId);
      fileToConfigId.delete(filePath);
      await notifyToolsChanged();
      console.error(
        `[watcher]   - Removed "${configId}" — ${registry.size()} total tools`,
      );
    });
  });

  // ── errors ─────────────────────────────────────────────────────
  watcher.on("error", (err) => {
    console.error("[watcher] FS error:", err);
  });

  console.error(`[mcp-one] Watching ${configDir} for config changes`);
  return {
    pause(): void {
      paused = true;
      console.error("[watcher] Hot reload paused");
    },
    resume(): void {
      paused = false;
      console.error("[watcher] Hot reload resumed");
    },
    isPaused(): boolean {
      return paused;
    },
  };
}
