import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Types ─────────────────────────────────────────────────────────

export interface RateLimitConfig {
  requests_per_minute: number;
}

export interface SystemConfig {
  /** Override the config directory (default: mcp-configs/) */
  config_dir?: string;
  /** Log verbosity level (default: info) */
  log_level?: "debug" | "info" | "error";
  /** Per-service rate limits keyed by config id */
  rate_limits?: Record<string, RateLimitConfig>;
  /**
   * Controls which self-management tools in mcp.one.json are exposed.
   * - true or undefined: all tools (default)
   * - false: disable mcp.one.json entirely (filter it out)
   * - { allow: string[] }: only these tool names are exposed
   * - { deny: string[] }: all tools except these are exposed
   */
  self_config?: boolean | { allow?: string[]; deny?: string[] };
}

// ── Loader ─────────────────────────────────────────────────────────

const SYSTEM_CONFIG_FILE = "mcp-one.config.json";

/**
 * Loads system config with precedence: CWD → home dir → empty defaults.
 * Reading from home dir first means `mcp-one start` launched from any
 * directory still finds the user's global config.
 */
export function loadSystemConfig(cwd: string = process.cwd()): SystemConfig {
  // Try CWD first (project-local override), then fall back to home dir.
  const candidates = [path.join(cwd, SYSTEM_CONFIG_FILE), path.join(os.homedir(), SYSTEM_CONFIG_FILE)];
  const configPath = candidates.find((p) => fs.existsSync(p));

  if (!configPath) {
    return {};
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      console.error(`[system-config] ${SYSTEM_CONFIG_FILE} must be a JSON object — using defaults`);
      return {};
    }

    const r = raw as Record<string, unknown>;
    const config: SystemConfig = {};

    if (typeof r.config_dir === "string") {
      config.config_dir = r.config_dir;
    }

    if (r.log_level === "debug" || r.log_level === "info" || r.log_level === "error") {
      config.log_level = r.log_level;
    }

    if (r.rate_limits && typeof r.rate_limits === "object" && !Array.isArray(r.rate_limits)) {
      config.rate_limits = {};
      for (const [serviceId, val] of Object.entries(r.rate_limits as Record<string, unknown>)) {
        if (val && typeof val === "object" && !Array.isArray(val)) {
          const v = val as Record<string, unknown>;
          if (typeof v.requests_per_minute === "number" && v.requests_per_minute > 0) {
            config.rate_limits[serviceId] = { requests_per_minute: v.requests_per_minute };
          }
        }
      }
    }

    if (r.self_config !== undefined) {
      if (typeof r.self_config === "boolean") {
        config.self_config = r.self_config;
      } else if (
        typeof r.self_config === "object" &&
        r.self_config !== null &&
        !Array.isArray(r.self_config)
      ) {
        const sc = r.self_config as Record<string, unknown>;
        const parsed: { allow?: string[]; deny?: string[] } = {};
        if (Array.isArray(sc.allow)) parsed.allow = sc.allow as string[];
        if (Array.isArray(sc.deny)) parsed.deny = sc.deny as string[];
        config.self_config = parsed;
      }
    }

    console.error(`[mcp-one] Loaded system config: ${SYSTEM_CONFIG_FILE}`);
    return config;
  } catch (err) {
    console.error(`[system-config] Failed to parse ${SYSTEM_CONFIG_FILE}:`, (err as Error).message);
    return {};
  }
}
