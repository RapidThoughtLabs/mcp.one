import type { OAuth2StaticAuth } from "../types.js";
import { AuthNotConfiguredError } from "./errors.js";
import { resolveEnv } from "../lib/env-store.js";

export function resolveOAuth2StaticAuth(auth: OAuth2StaticAuth, configId: string): Record<string, string> {
  const token = resolveEnv(configId, auth.token_env);
  if (!token) {
    throw new AuthNotConfiguredError(configId, "oauth2_static", [auth.token_env]);
  }
  return { Authorization: `Bearer ${token}` };
}
