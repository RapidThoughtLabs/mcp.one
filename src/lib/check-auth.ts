import type { AuthConfig, McpConfig, HttpConnectorConfig, GrpcConnectorConfig, GraphqlConnectorConfig } from "../types.js";
import { checkAuthEnvVars } from "../auth/index.js";
import { resolveEnv } from "./env-store.js";

// ── Connector-aware helpers ────────────────────────────────────────

/**
 * Extract the AuthConfig from a McpConfig's connector, if one exists.
 */
export function getConfigAuth(config: McpConfig): AuthConfig | undefined {
  const c = config.connector;
  if (c.type === "http")    return (c as HttpConnectorConfig).auth;
  if (c.type === "grpc")    return (c as GrpcConnectorConfig).auth;
  if (c.type === "graphql") return (c as GraphqlConnectorConfig).auth;
  return undefined;
}

/**
 * Extract the base URL from an HTTP connector config, if present.
 */
export function getConfigBaseUrl(config: McpConfig): string | undefined {
  if (config.connector.type === "http") {
    return (config.connector as HttpConnectorConfig).base_url;
  }
  return undefined;
}

// Re-export for callers that only need the simple missing-var check
export { checkAuthEnvVars };

export interface AuthVarStatus {
  name: string;
  set: boolean;
}

/**
 * Returns per-variable presence status for every env var an auth block references.
 * Used by `mcp-one auth status` to display a per-variable health table.
 */
export function getAuthVarStatuses(auth: AuthConfig, configId: string): AuthVarStatus[] {
  switch (auth.type) {
    case "bearer":
    case "oauth2_static":
      return [{ name: auth.token_env, set: !!resolveEnv(configId, auth.token_env) }];

    case "basic":
      return [
        { name: auth.username_env, set: !!resolveEnv(configId, auth.username_env) },
        { name: auth.token_env,    set: !!resolveEnv(configId, auth.token_env) },
      ];

    case "api_key":
      return [{ name: auth.key_env, set: !!resolveEnv(configId, auth.key_env) }];
  }
}

/**
 * Returns the names of all env vars referenced by an auth block — whether set or not.
 * Used by `mcp-one auth setup` to know which vars to prompt for.
 */
export function getAuthVarNames(auth: AuthConfig): string[] {
  switch (auth.type) {
    case "bearer":
    case "oauth2_static":
      return [auth.token_env];

    case "basic":
      return [auth.username_env, auth.token_env];

    case "api_key":
      return [auth.key_env];
  }
}
