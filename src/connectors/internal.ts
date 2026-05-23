/**
 * InternalConnector — exposes mcp.one's own management capabilities as MCP tools.
 *
 * Unlike all other connectors (HTTP/CLI/gRPC/etc.) which call external systems,
 * the internal connector calls TypeScript functions directly. It holds live
 * references to the ToolRegistry and notifyToolsChanged injected at startup.
 *
 * Tools are declared explicitly in mcp-configs/mcp.one.json (id: "one").
 * Tool names are dispatched via a handler map in execute().
 *
 * Safety: the self_config setting in mcp-one.config.json controls which tools
 * are exposed. Enforcement happens in start.ts before registration.
 */

import type { RegisteredTool } from "../types.js";
import type { IConnector, ConnectorResult } from "./base.js";
import type { ToolRegistry } from "../server.js";

// ── Context ──────────────────────────────────────────────────────────

export interface InternalContext {
  /** The live ToolRegistry — reflects all currently registered tools. */
  registry: ToolRegistry;
  /** Broadcasts tool-list-changed to all connected LLM transports. */
  notifyToolsChanged: () => Promise<void>;
  /** Absolute path to the mcp-configs/ directory. */
  configDir: string;
}

// ── Handler type ─────────────────────────────────────────────────────

type Handler = (ctx: InternalContext, args: Record<string, unknown>) => Promise<ConnectorResult>;

// ── InternalConnector ────────────────────────────────────────────────

export class InternalConnector implements IConnector {
  readonly type = "internal" as const;

  private ctx: InternalContext | null = null;

  /**
   * Inject live server context. Called in start.ts after startServer() returns
   * the registry and notifyToolsChanged function.
   */
  bind(ctx: InternalContext): void {
    this.ctx = ctx;
  }

  async execute(tool: RegisteredTool, args: Record<string, unknown>): Promise<ConnectorResult> {
    if (!this.ctx) {
      return { success: false, data: { error: "Internal connector not initialized — bind() was not called" } };
    }

    const handler = HANDLERS[tool.tool.name];
    if (!handler) {
      return { success: false, data: { error: `Unknown internal tool: "${tool.tool.name}"` } };
    }

    try {
      return await handler(this.ctx, args);
    } catch (err) {
      return { success: false, data: { error: (err as Error).message } };
    }
  }
}

// ── Handler registry ─────────────────────────────────────────────────
// Lazily imported to avoid circular deps and keep startup fast.

import {
  handleCreateConfig,
  handleGetConfig,
  handleListConfigs,
  handleUpdateConfig,
  handleDeleteConfig,
  handleValidateConfig,
} from "./internal-handlers/config-crud.js";

import {
  handleAddTool,
  handleRemoveTool,
  handleUpdateTool,
  handleListTools,
  handleGetTool,
} from "./internal-handlers/tool-crud.js";

import {
  handleRegistrySearch,
  handleRegistryBrowse,
  handleRegistryInstall,
  handleRegistryCheckUpdates,
} from "./internal-handlers/registry-ops.js";

import {
  handleAuthStatus,
  handleAuthSet,
} from "./internal-handlers/auth-ops.js";

import {
  handleServerStatus,
} from "./internal-handlers/server-ops.js";

import {
  handleSearch,
} from "./internal-handlers/search-ops.js";

import {
  handleInvoke,
} from "./internal-handlers/invoke-ops.js";

const HANDLERS: Record<string, Handler> = {
  // Config CRUD
  create_config:   handleCreateConfig,
  get_config:      handleGetConfig,
  list_configs:    handleListConfigs,
  update_config:   handleUpdateConfig,
  delete_config:   handleDeleteConfig,
  validate_config: handleValidateConfig,

  // Tool CRUD
  add_tool:    handleAddTool,
  remove_tool: handleRemoveTool,
  update_tool: handleUpdateTool,
  list_tools:  handleListTools,
  get_tool:    handleGetTool,

  // Registry
  registry_search:        handleRegistrySearch,
  registry_browse:        handleRegistryBrowse,
  registry_install:       handleRegistryInstall,
  registry_check_updates: handleRegistryCheckUpdates,

  // Auth
  auth_status: handleAuthStatus,
  auth_set:    handleAuthSet,

  // Server
  server_status: handleServerStatus,

  // Discovery
  search: handleSearch,
  invoke: handleInvoke,
};
