import os from "node:os";
import path from "node:path";
import type { SystemConfig } from "../system-config.js";

/**
 * Resolves the config directory with this precedence:
 *   1. cliOverride (e.g. positional arg to `mcp-one start ./my-dir`)
 *   2. systemConfig.config_dir from mcp-one.config.json
 *   3. Default: ~/mcp-configs  (home-relative so all invocations share one location)
 *
 * `list` and `auth` commands always pass undefined for cliOverride —
 * config dir is never a positional arg for those commands.
 */
export function resolveConfigDir(
  cliOverride: string | undefined,
  systemConfig: SystemConfig,
): string {
  if (cliOverride) return cliOverride;
  if (systemConfig.config_dir) {
    return path.resolve(process.cwd(), systemConfig.config_dir);
  }
  return path.join(os.homedir(), "mcp-configs");
}
