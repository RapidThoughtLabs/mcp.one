/**
 * Tool CRUD handlers for the internal connector.
 *
 * These handlers read/write mcp.{id}.json files, modifying the tools[] array.
 * The hot-reload watcher detects changes and re-registers tools automatically.
 */

import fs from "node:fs";
import path from "node:path";
import { validateConfig } from "../../loader.js";
import type { ConnectorResult } from "../base.js";
import type { InternalContext } from "../internal.js";

// ── helpers ──────────────────────────────────────────────────────────

function configFilePath(configDir: string, id: string): string {
  return path.join(configDir, `mcp.${id}.json`);
}

function readRawConfig(configDir: string, id: string): Record<string, unknown> | null {
  const filePath = configFilePath(configDir, id);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeConfig(configDir: string, id: string, raw: Record<string, unknown>): void {
  const filePath = configFilePath(configDir, id);
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
}

// ── handlers ─────────────────────────────────────────────────────────

export async function handleAddTool(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const configId = args.config_id as string | undefined;
  const toolDef  = args.tool;

  if (!configId) return { success: false, data: { error: "config_id is required" } };
  if (!toolDef || typeof toolDef !== "object") {
    return { success: false, data: { error: "tool must be an object" } };
  }

  const raw = readRawConfig(ctx.configDir, configId);
  if (!raw) return { success: false, data: { error: `Config "${configId}" not found` } };

  const tools = Array.isArray(raw.tools) ? [...(raw.tools as unknown[])] : [];
  const tool = toolDef as Record<string, unknown>;

  // Check for duplicate name
  if (tools.some((t) => (t as Record<string, unknown>).name === tool.name)) {
    return {
      success: false,
      data: { error: `Tool "${tool.name}" already exists in config "${configId}". Use update_tool to modify it.` },
    };
  }

  tools.push(toolDef);
  const updated = { ...raw, tools };

  // Validate the whole config with the new tool
  try {
    validateConfig(updated, `mcp.${configId}.json`);
  } catch (err) {
    return { success: false, data: { error: `Validation failed: ${(err as Error).message}` } };
  }

  writeConfig(ctx.configDir, configId, updated);

  return {
    success: true,
    data: {
      config_id: configId,
      tool_name: tool.name,
      message: `Tool "${tool.name}" added to "${configId}". Hot-reload will register it.`,
    },
  };
}

export async function handleRemoveTool(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const configId  = args.config_id as string | undefined;
  const toolName  = args.tool_name as string | undefined;

  if (!configId)  return { success: false, data: { error: "config_id is required" } };
  if (!toolName)  return { success: false, data: { error: "tool_name is required" } };

  const raw = readRawConfig(ctx.configDir, configId);
  if (!raw) return { success: false, data: { error: `Config "${configId}" not found` } };

  const tools = Array.isArray(raw.tools) ? (raw.tools as unknown[]) : [];
  const before = tools.length;
  const after  = tools.filter((t) => (t as Record<string, unknown>).name !== toolName);

  if (after.length === before) {
    return { success: false, data: { error: `Tool "${toolName}" not found in config "${configId}"` } };
  }

  const updated = { ...raw, tools: after };

  // Validate — will fail if tools becomes empty for non-discoverable connector
  try {
    validateConfig(updated, `mcp.${configId}.json`);
  } catch (err) {
    return { success: false, data: { error: `Cannot remove: ${(err as Error).message}` } };
  }

  writeConfig(ctx.configDir, configId, updated);

  return {
    success: true,
    data: { config_id: configId, tool_name: toolName, message: `Tool "${toolName}" removed from "${configId}".` },
  };
}

export async function handleUpdateTool(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const configId  = args.config_id as string | undefined;
  const toolName  = args.tool_name as string | undefined;
  const updates   = args.updates;

  if (!configId) return { success: false, data: { error: "config_id is required" } };
  if (!toolName) return { success: false, data: { error: "tool_name is required" } };
  if (!updates || typeof updates !== "object") {
    return { success: false, data: { error: "updates must be an object" } };
  }

  const raw = readRawConfig(ctx.configDir, configId);
  if (!raw) return { success: false, data: { error: `Config "${configId}" not found` } };

  const tools = Array.isArray(raw.tools) ? [...(raw.tools as unknown[])] : [];
  const idx   = tools.findIndex((t) => (t as Record<string, unknown>).name === toolName);

  if (idx === -1) {
    return { success: false, data: { error: `Tool "${toolName}" not found in config "${configId}"` } };
  }

  const merged = { ...(tools[idx] as object), ...(updates as object) };
  tools[idx]   = merged;
  const updated = { ...raw, tools };

  try {
    validateConfig(updated, `mcp.${configId}.json`);
  } catch (err) {
    return { success: false, data: { error: `Validation failed: ${(err as Error).message}` } };
  }

  writeConfig(ctx.configDir, configId, updated);

  return {
    success: true,
    data: { config_id: configId, tool_name: toolName, message: `Tool "${toolName}" updated.` },
  };
}

export async function handleListTools(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const filterById = args.config_id as string | undefined;

  const scopeId = filterById ?? "one";
  const tools = ctx.registry.list()
    .filter((rt) => rt.configId === scopeId)
    .map((rt) => ({
      qualified_name: `${rt.configId}.${rt.tool.name}`,
      config_id:      rt.configId,
      tool:           rt.tool,
    }));

  return { success: true, data: { tools, total: tools.length } };
}

export async function handleGetTool(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const qualifiedName = args.qualified_name as string | undefined;
  if (!qualifiedName) {
    return { success: false, data: { error: "qualified_name is required (format: config_id.tool_name)" } };
  }

  const rt = ctx.registry.get(qualifiedName);
  if (!rt) {
    return { success: false, data: { error: `Tool "${qualifiedName}" not found` } };
  }

  return { success: true, data: { qualified_name: qualifiedName, config_id: rt.configId, tool: rt.tool } };
}
