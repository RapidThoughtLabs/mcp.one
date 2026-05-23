import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { McpConfig, McpConnectorConfig } from "./types.js";
import { PKG_NAME } from "./lib/version.js";

const SCAN_PATHS = [
  // Claude Desktop (macOS)
  () => path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
  // Claude Desktop (Linux)
  () => path.join(os.homedir(), ".config", "claude", "claude_desktop_config.json"),
  // Cursor
  () => path.join(os.homedir(), ".cursor", "mcp.json"),
];

interface DiscoveredServer {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export function discoverMcpServers(): McpConfig[] {
  const discovered: McpConfig[] = [];
  const seenIds = new Set<string>();

  for (const getPath of SCAN_PATHS) {
    const configPath = getPath();
    if (!fs.existsSync(configPath)) continue;

    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const servers = parseMcpClientConfig(raw);

      for (const srv of servers) {
        // Skip entries that would spawn another mcp-one process — prevents
        // an infinite recursive spawn loop when mcp-one itself is listed in
        // the client config it is reading (e.g. Cursor's mcp.json).
        if (isSelfReferential(srv)) {
          console.error(
            `[discovery] Skipped: ${srv.id} — would spawn another ${PKG_NAME} process (recursive loop prevention)`,
          );
          continue;
        }

        const id = `${srv.id}-mcp`; // D1: always append connector type suffix
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const connector: McpConnectorConfig = {
          type: "mcp",
          transport: "stdio",
          command: srv.command,
          args: srv.args,
          env: srv.env,
        };

        discovered.push({
          id,
          name: srv.id,
          description: `Auto-discovered MCP server: ${srv.id}`,
          connector,
          tools: [],
        });

        console.error(`[discovery] Found: ${id} (from ${path.basename(configPath)})`);
      }
    } catch (err) {
      console.error(`[discovery] Failed to parse ${configPath}:`, (err as Error).message);
    }
  }

  return discovered;
}

/**
 * Returns true if the discovered server entry would launch another instance
 * of this package, which would cause an infinite recursive spawn loop.
 *
 * Detection uses exact token equality (not substring) to avoid false positives
 * on packages whose names merely contain the package name (e.g. "mcp-one-extra").
 *
 * Checks (in order):
 *   1. Any arg token exactly equals PKG_NAME   → covers: npx [-y] mcp-one start
 *   2. Command basename (without .cmd) equals PKG_NAME
 *                                              → covers: mcp-one start (global install)
 *                                                        mcp-one.cmd start (Windows)
 *                                                        /usr/local/bin/mcp-one start
 *
 * Exported for unit testing only — not part of the public API.
 */
export function isSelfReferential(srv: DiscoveredServer): boolean {
  // Tier 1: any token in [command, ...args] exactly equals the package name
  const allTokens = [srv.command, ...(srv.args ?? [])];
  if (allTokens.some((t) => t === PKG_NAME)) return true;

  // Tier 2: command basename matches the binary name (handles absolute paths
  // and Windows .cmd wrappers)
  const base = path.basename(srv.command, ".cmd");
  if (base === PKG_NAME) return true;

  return false;
}

function parseMcpClientConfig(raw: unknown): DiscoveredServer[] {
  const servers: DiscoveredServer[] = [];
  if (!raw || typeof raw !== "object") return servers;

  const r = raw as Record<string, unknown>;
  const mcpServers = r.mcpServers as Record<string, unknown> | undefined;
  if (!mcpServers || typeof mcpServers !== "object") return servers;

  for (const [name, config] of Object.entries(mcpServers)) {
    if (!config || typeof config !== "object") continue;
    const c = config as Record<string, unknown>;
    if (typeof c.command !== "string") continue;

    servers.push({
      id: name,
      command: c.command,
      args: Array.isArray(c.args) ? (c.args as string[]) : undefined,
      env: c.env && typeof c.env === "object" ? (c.env as Record<string, string>) : undefined,
    });
  }

  return servers;
}
