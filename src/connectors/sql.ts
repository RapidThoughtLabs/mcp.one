import type { IConnector, ConnectorResult } from "./base.js";
import type { SqlConnectorConfig, RegisteredTool } from "../types.js";
import { getAdapter } from "./sql/adapters/index.js";
import type { SqlPool } from "./sql/adapters/types.js";

interface SqlChild {
  configId: string;
  config: SqlConnectorConfig;
  pool: SqlPool;
}

export class SqlConnector implements IConnector {
  readonly type = "sql" as const;
  private children = new Map<string, SqlChild>();
  private pendingConfigs: Array<{ configId: string; config: SqlConnectorConfig }> = [];

  addConfig(configId: string, config: SqlConnectorConfig): void {
    this.pendingConfigs.push({ configId, config });
  }

  async init(): Promise<void> {
    const pending = this.pendingConfigs.splice(0);
    for (const { configId, config } of pending) {
      await this.#openPool(configId, config);
    }
  }

  async reinitConfig(configId: string, config: SqlConnectorConfig): Promise<void> {
    const existing = this.children.get(configId);
    if (existing) {
      await existing.pool.close().catch(() => {/* best-effort */});
      this.children.delete(configId);
    }
    await this.#openPool(configId, config);
  }

  async teardown(): Promise<void> {
    for (const child of this.children.values()) {
      await child.pool.close().catch(() => {/* best-effort */});
    }
    this.children.clear();
  }

  async execute(tool: RegisteredTool, args: Record<string, unknown>): Promise<ConnectorResult> {
    const child = this.children.get(tool.configId);
    if (!child) {
      return { success: false, data: { error: `SQL pool not initialized for "${tool.configId}"` } };
    }

    const sql = tool.tool.sql;
    if (!sql) {
      return { success: false, data: { error: `Tool "${tool.tool.name}" has no "sql" field` } };
    }

    const params = collectParams(tool, args);
    const opts = {
      timeout_ms: Math.min(tool.tool.timeout_ms ?? child.config.default_timeout_ms ?? 30_000, 120_000),
      max_rows: Math.min(tool.tool.max_rows ?? child.config.default_max_rows ?? 1_000, 10_000),
    };

    try {
      const result = await child.pool.query(sql, params, opts);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, data: { error: (err as Error).message } };
    }
  }

  async #openPool(configId: string, config: SqlConnectorConfig): Promise<void> {
    try {
      const adapter = await getAdapter(config.dialect);
      const pool = await adapter.createPool(config);
      this.children.set(configId, { configId, config, pool });
    } catch (err) {
      console.error(
        `[sql-connector] init "${configId}" (${config.dialect}):`,
        (err as Error).message,
      );
    }
  }
}

function collectParams(tool: RegisteredTool, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of tool.tool.params) {
    const v = args[p.name] ?? p.default;
    if (v !== undefined) out[p.name] = v;
  }
  return out;
}
