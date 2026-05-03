/**
 * Shared connector-type constants and helpers.
 *
 * The local filesystem convention is `mcp.{base_id}-{connector_type}.json`
 * and the stored `id` field mirrors the filename (compound form: "github-http").
 * This module centralises the whitelist of recognised connector suffixes and
 * the helper that splits a compound id back into its parts.
 *
 * The loader's broader whitelist (src/loader.ts) also includes "internal",
 * which is reserved for mcp.one itself and never appears as a filename suffix.
 */

export const CONNECTOR_TYPES = ["http", "cli", "file", "grpc", "graphql", "mcp", "sql", "mongodb"] as const;
export type ConnectorTypeSuffix = typeof CONNECTOR_TYPES[number];

/**
 * Split a compound id into its base and connector-type parts.
 * Returns `{ base: id, connectorType: "unknown" }` if no known suffix is present.
 */
export function extractBaseAndConnector(id: string): { base: string; connectorType: string } {
  for (const ct of CONNECTOR_TYPES) {
    if (id === ct) return { base: id, connectorType: ct };
    if (id.endsWith(`-${ct}`)) {
      return { base: id.slice(0, -(ct.length + 1)), connectorType: ct };
    }
  }
  return { base: id, connectorType: "unknown" };
}

export function isConnectorType(value: string): value is ConnectorTypeSuffix {
  return (CONNECTOR_TYPES as readonly string[]).includes(value);
}
