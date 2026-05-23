import { AuthNotConfiguredError } from "../../../auth/errors.js";
import { resolveEnv } from "../../../lib/env-store.js";
import type { SqlConnectorConfig } from "../../../types.js";

export interface SqlCredentials {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | { rejectUnauthorized?: boolean; ca_path?: string };
}

export function resolveCredentials(configId: string, config: SqlConnectorConfig): SqlCredentials {
  if (config.connection_string_env) {
    const val = resolveEnv(configId, config.connection_string_env);
    if (!val) {
      throw new AuthNotConfiguredError(configId, "connection_string", [config.connection_string_env]);
    }
    return { connectionString: val };
  }

  const missingVars: string[] = [];
  let user: string | undefined;
  let password: string | undefined;

  if (config.auth) {
    user = resolveEnv(configId, config.auth.username_env);
    password = resolveEnv(configId, config.auth.token_env);
    if (!user) missingVars.push(config.auth.username_env);
    if (!password) missingVars.push(config.auth.token_env);
  }

  if (missingVars.length > 0) {
    throw new AuthNotConfiguredError(configId, "basic", missingVars);
  }

  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user,
    password,
    ssl: config.ssl,
  };
}
