import type { BearerAuth } from "../types.js";
import { AuthNotConfiguredError } from "./errors.js";
import { resolveEnv } from "../lib/env-store.js";

export function resolveBearerAuth(auth: BearerAuth, configId: string): Record<string, string> {
  const token = resolveEnv(configId, auth.token_env);
  if (!token) {
    throw new AuthNotConfiguredError(configId, "bearer", [auth.token_env]);
  }
  return { Authorization: `Bearer ${token}` };
}
