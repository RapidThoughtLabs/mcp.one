import fs from "node:fs";
import path from "node:path";

const configEnv = new Map<string, Map<string, string>>();

function parseEnvContent(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
    if (key) map.set(key, val);
  }
  return map;
}

/** Load a per-config env file into the in-memory store. Returns count of vars loaded. */
export function loadConfigEnv(configId: string, filePath: string): number {
  if (!fs.existsSync(filePath)) {
    configEnv.delete(configId);
    return 0;
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const map = parseEnvContent(content);
  configEnv.set(configId, map);
  return map.size;
}

/** Remove all env vars for a config from the in-memory store. */
export function unloadConfigEnv(configId: string): void {
  configEnv.delete(configId);
}

/**
 * Resolve an env var for a specific config.
 * Checks the per-config store only — no cross-config bleed.
 */
export function resolveEnv(configId: string, varName: string): string | undefined {
  return configEnv.get(configId)?.get(varName);
}

/**
 * Build the full environment for a child process spawned by a config.
 * Starts from base (process.env by default so PATH/HOME/etc. flow through),
 * overlays per-config secrets, then overlays literal connector.env declarations.
 */
export function buildChildEnv(
  configId: string,
  declared?: Record<string, string>,
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const merged: Record<string, string> = { ...(base as Record<string, string>) };
  const configMap = configEnv.get(configId);
  if (configMap) {
    for (const [k, v] of configMap) merged[k] = v;
  }
  if (declared) {
    for (const [k, v] of Object.entries(declared)) merged[k] = v;
  }
  return merged;
}

/** Load all mcp.*.env files from a config directory into the in-memory store. */
export function loadAllConfigEnvs(configDir: string): void {
  if (!fs.existsSync(configDir)) return;
  let entries: string[];
  try {
    entries = fs.readdirSync(configDir);
  } catch {
    return;
  }
  for (const file of entries) {
    if (!file.startsWith("mcp.") || !file.endsWith(".env")) continue;
    const configId = file.slice(4, -4); // "mcp.github.env" → "github"
    loadConfigEnv(configId, path.join(configDir, file));
  }
}
