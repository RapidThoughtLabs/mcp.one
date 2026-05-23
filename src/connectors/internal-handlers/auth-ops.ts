/**
 * Auth management handlers for the internal connector.
 */

import { getConfigAuth, checkAuthEnvVars, getAuthVarStatuses } from "../../lib/check-auth.js";
import { writeConfigEnv } from "../../lib/env-writer.js";
import type { ConnectorResult } from "../base.js";
import type { InternalContext } from "../internal.js";

export async function handleAuthStatus(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const filterById = args.config_id as string | undefined;

  // Read all configs from disk to get auth info
  const { loadConfigs } = await import("../../loader.js");
  const configs = loadConfigs(ctx.configDir);

  const statuses = configs
    .filter((c) => !filterById || c.id === filterById)
    .map((c) => {
      const auth = getConfigAuth(c);
      if (!auth) return { config_id: c.id, auth: false, status: "no_auth_required" };

      const missing  = checkAuthEnvVars(auth, c.id);
      const varStatus = getAuthVarStatuses(auth, c.id);

      return {
        config_id:    c.id,
        auth:         true,
        auth_type:    auth.type,
        status:       missing.length === 0 ? "configured" : "missing_credentials",
        vars:         varStatus,
        missing_vars: missing,
      };
    });

  const unconfiguredCount = statuses.filter((s) => s.status === "missing_credentials").length;

  return {
    success: true,
    data: {
      configs: statuses,
      summary: {
        total:        statuses.length,
        configured:   statuses.filter((s) => s.status === "configured").length,
        unconfigured: unconfiguredCount,
        no_auth:      statuses.filter((s) => s.status === "no_auth_required").length,
      },
    },
  };
}

export async function handleAuthSet(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const configId = args.config_id as string | undefined;
  const key      = args.key       as string | undefined;
  const value    = args.value     as string | undefined;

  if (!configId || typeof configId !== "string" || configId.trim() === "") {
    return { success: false, data: { error: "config_id is required and must be a non-empty string" } };
  }
  if (!key || typeof key !== "string" || key.trim() === "") {
    return { success: false, data: { error: "key is required and must be a non-empty string" } };
  }
  if (value === undefined || value === null) {
    return { success: false, data: { error: "value is required" } };
  }

  const result = writeConfigEnv(ctx.configDir, configId, [{ key, value: String(value) }], true);

  if (result.written.includes(key)) {
    return {
      success: true,
      data: { key, config_id: configId, message: `${key} written to mcp.${configId}.env.` },
    };
  }

  return {
    success: false,
    data: { key, message: `${key} was skipped (already set). Pass overwrite: true to force.` },
  };
}
