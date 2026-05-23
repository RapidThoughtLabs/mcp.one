import type { BasicAuth } from "../types.js";
import { AuthNotConfiguredError } from "./errors.js";
import { resolveEnv } from "../lib/env-store.js";

export function resolveBasicAuth(auth: BasicAuth, configId: string): Record<string, string> {
  const missing: string[] = [];

  const username = resolveEnv(configId, auth.username_env);
  if (!username) missing.push(auth.username_env);

  const token = resolveEnv(configId, auth.token_env);
  if (!token) missing.push(auth.token_env);

  if (missing.length > 0) {
    throw new AuthNotConfiguredError(configId, "basic", missing);
  }

  const encoded = Buffer.from(`${username!}:${token!}`).toString("base64");
  return { Authorization: `Basic ${encoded}` };
}
