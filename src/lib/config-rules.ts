import { CONNECTOR_TYPES } from "./connector-types.js";

export const RESERVED_IDS = ["one"];

export interface AuthStatus {
  type: string;
  ok: boolean;
  missingVars: string[];
}

export interface ConfigSummary {
  id: string;
  name: string;
  description?: string;
  connector: {
    type: string;
    base_url?: string;
    endpoint?: string;
    transport?: string;
  };
  toolCount: number;
  auth?: AuthStatus;
  raw: Record<string, unknown>;
}

/** Returns an error string if the base id is invalid, null if valid. */
export function validateBaseId(id: unknown): string | null {
  if (!id || typeof id !== "string" || id.trim() === "") {
    return "id must be a non-empty string";
  }
  if (RESERVED_IDS.includes(id)) {
    return `id "${id}" is reserved`;
  }
  for (const ct of CONNECTOR_TYPES) {
    if (id.endsWith(`-${ct}`)) {
      const base = id.slice(0, -(ct.length + 1));
      return `id "${id}" already includes the connector suffix "-${ct}". Use base id "${base}" — the suffix is added automatically from connector.type`;
    }
  }
  return null;
}

export function compoundId(baseId: string, connectorType: string): string {
  return `${baseId}-${connectorType}`;
}

/**
 * Extract all env var names referenced by a config's connector auth block.
 * Walks token_env / username_env / key_env regardless of whether they are set.
 */
export function collectAuthEnvVars(config: unknown): Set<string> {
  const vars = new Set<string>();
  if (!config || typeof config !== "object") return vars;
  const c = config as Record<string, unknown>;
  const connector = c["connector"];
  if (!connector || typeof connector !== "object") return vars;
  const auth = (connector as Record<string, unknown>)["auth"];
  if (!auth || typeof auth !== "object") return vars;
  const a = auth as Record<string, unknown>;
  if (typeof a["token_env"] === "string") vars.add(a["token_env"]);
  if (typeof a["username_env"] === "string") vars.add(a["username_env"]);
  if (typeof a["key_env"] === "string") vars.add(a["key_env"]);
  return vars;
}

export function getMissingAuthVars(auth: unknown): string[] {
  if (!auth || typeof auth !== "object") return [];
  const a = auth as Record<string, unknown>;
  const candidates: string[] = [];
  if (a["type"] === "bearer" || a["type"] === "oauth2_static") {
    if (typeof a["token_env"] === "string") candidates.push(a["token_env"]);
  } else if (a["type"] === "basic") {
    if (typeof a["username_env"] === "string") candidates.push(a["username_env"]);
    if (typeof a["token_env"] === "string") candidates.push(a["token_env"]);
  } else if (a["type"] === "api_key") {
    if (typeof a["key_env"] === "string") candidates.push(a["key_env"]);
  }
  return candidates.filter((v) => !process.env[v]);
}

export function toConfigSummary(raw: Record<string, unknown>, toolCount: number): ConfigSummary {
  const id = String(raw["id"] ?? "");
  const name = String(raw["name"] ?? "");
  const description = typeof raw["description"] === "string" ? raw["description"] : undefined;

  const connRaw =
    raw["connector"] && typeof raw["connector"] === "object"
      ? (raw["connector"] as Record<string, unknown>)
      : { type: "unknown" };

  const connector: ConfigSummary["connector"] = { type: String(connRaw["type"] ?? "unknown") };
  if (connRaw["base_url"]) connector.base_url = String(connRaw["base_url"]);
  if (connRaw["endpoint"]) connector.endpoint = String(connRaw["endpoint"]);
  if (connRaw["transport"]) connector.transport = String(connRaw["transport"]);

  let auth: AuthStatus | undefined;
  if (connRaw["type"] === "http" || connRaw["type"] === "graphql") {
    const authData = connRaw["auth"];
    const missingVars = getMissingAuthVars(authData);
    auth = {
      type:
        typeof authData === "object" && authData
          ? String((authData as Record<string, unknown>)["type"] ?? "unknown")
          : "none",
      ok: missingVars.length === 0,
      missingVars,
    };
  }

  return { id, name, description, connector, toolCount, auth, raw };
}
