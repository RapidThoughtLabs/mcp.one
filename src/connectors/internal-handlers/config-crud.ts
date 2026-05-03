/**
 * Config CRUD handlers for the internal connector.
 *
 * Each handler reads/writes mcp.{id}.json files in configDir.
 * The hot-reload watcher in src/watcher.ts detects changes automatically
 * and re-registers tools — handlers just write the file and return.
 */

import fs from "node:fs";
import path from "node:path";
import { validateConfig } from "../../loader.js";
import { CONNECTOR_TYPES, type ConnectorTypeSuffix } from "../../lib/connector-types.js";
import { RESERVED_IDS, validateBaseId, compoundId } from "../../lib/config-rules.js";
import type { ConnectorResult } from "../base.js";
import type { InternalContext } from "../internal.js";

const SELF_ID = RESERVED_IDS[0]!; // "one" — protected from deletion/overwrite

function configFilePath(configDir: string, id: string): string {
  return path.join(configDir, `mcp.${id}.json`);
}

function readConfigFile(configDir: string, id: string): unknown | null {
  const filePath = configFilePath(configDir, id);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

// ── handlers ─────────────────────────────────────────────────────────

export async function handleCreateConfig(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const idError = validateBaseId(args.id);
  if (idError) {
    return { success: false, data: { error: idError } };
  }
  const id = args.id as string;

  const connector = args.connector as Record<string, unknown> | undefined;
  const connectorType = (connector?.type as string | undefined) ?? "";

  if (!connectorType || !CONNECTOR_TYPES.includes(connectorType as ConnectorTypeSuffix)) {
    return {
      success: false,
      data: {
        error: `connector.type is required and must be one of: ${CONNECTOR_TYPES.join(", ")}`,
      },
    };
  }

  const cId      = compoundId(id, connectorType);
  const filePath = configFilePath(ctx.configDir, cId);

  if (fs.existsSync(filePath) && !args.force) {
    return {
      success: false,
      data: {
        // D9 error message format
        error: `Config '${id}' (${connectorType}) already exists as mcp.${cId}.json. Pass force: true to overwrite.`,
      },
    };
  }

  // D2: id field in the stored JSON is the compound form
  const rawConfig: Record<string, unknown> = {
    id:        cId,
    name:      args.name ?? id,
    connector: args.connector ?? {},
    tools:     args.tools ?? [],
  };
  if (args.description) rawConfig.description = args.description;
  if (args.overlays)    rawConfig.overlays    = args.overlays;

  // Dry-run validation before writing
  try {
    validateConfig(rawConfig, `mcp.${cId}.json`);
  } catch (err) {
    return { success: false, data: { error: `Validation failed: ${(err as Error).message}` } };
  }

  // Write to disk — the watcher picks it up automatically
  fs.mkdirSync(ctx.configDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(rawConfig, null, 2) + "\n", "utf-8");

  return {
    success: true,
    data: {
      id:        cId,
      file_path: filePath,
      message:   `Config "${cId}" created. The server will hot-reload it automatically.`,
    },
  };
}

export async function handleGetConfig(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const configId = args.config_id as string | undefined;
  if (!configId) {
    return { success: false, data: { error: "config_id is required" } };
  }

  const raw = readConfigFile(ctx.configDir, configId);
  if (raw === null) {
    return { success: false, data: { error: `Config "${configId}" not found in ${ctx.configDir}` } };
  }

  return { success: true, data: raw };
}

export async function handleListConfigs(
  ctx: InternalContext,
  _args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const configs = [...new Set(ctx.registry.list().map((rt) => rt.configId))].sort();
  return { success: true, data: { configs } };
}

export async function handleUpdateConfig(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const configId = args.config_id as string | undefined;
  if (!configId) {
    return { success: false, data: { error: "config_id is required" } };
  }

  const raw = readConfigFile(ctx.configDir, configId);
  if (raw === null) {
    return { success: false, data: { error: `Config "${configId}" not found` } };
  }

  const existing = raw as Record<string, unknown>;

  // Merge updates — connector type change on self is blocked
  if (configId === SELF_ID && args.connector) {
    const newConnector = args.connector as Record<string, unknown>;
    if (newConnector.type && newConnector.type !== "internal") {
      return { success: false, data: { error: `Cannot change connector type of the self-management config` } };
    }
  }

  const updated: Record<string, unknown> = { ...existing };
  if (args.name        !== undefined) updated.name        = args.name;
  if (args.description !== undefined) updated.description = args.description;
  if (args.connector   !== undefined) {
    updated.connector = { ...(existing.connector as object), ...(args.connector as object) };
  }

  // Validate before writing
  try {
    validateConfig(updated, `mcp.${configId}.json`);
  } catch (err) {
    return { success: false, data: { error: `Validation failed: ${(err as Error).message}` } };
  }

  const filePath = configFilePath(ctx.configDir, configId);
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2) + "\n", "utf-8");

  return {
    success: true,
    data: { id: configId, message: `Config "${configId}" updated. Hot-reload will apply changes.` },
  };
}

export async function handleDeleteConfig(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const configId = args.config_id as string | undefined;
  if (!configId) {
    return { success: false, data: { error: "config_id is required" } };
  }

  if (configId === SELF_ID) {
    return {
      success: false,
      data: { error: `Cannot delete the self-management config. Set self_config: false in mcp-one.config.json to disable it.` },
    };
  }

  const filePath = configFilePath(ctx.configDir, configId);
  if (!fs.existsSync(filePath)) {
    return { success: false, data: { error: `Config "${configId}" not found at ${filePath}` } };
  }

  fs.unlinkSync(filePath);

  return {
    success: true,
    data: { id: configId, message: `Config "${configId}" deleted. The server will unregister its tools automatically.` },
  };
}

export async function handleValidateConfig(
  _ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const config = args.config;
  if (!config || typeof config !== "object") {
    return { success: false, data: { error: "config must be an object" } };
  }

  try {
    const result = validateConfig(config, "validate_config");
    return {
      success: true,
      data: {
        valid: true,
        id:   result.id,
        name: result.name,
        connector_type: result.connector.type,
        tool_count: result.tools.length,
      },
    };
  } catch (err) {
    return {
      success: false,
      data: { valid: false, error: (err as Error).message },
    };
  }
}
