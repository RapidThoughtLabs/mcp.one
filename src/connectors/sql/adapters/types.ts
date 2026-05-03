import type { SqlConnectorConfig } from "../../../types.js";

export interface SqlAdapter {
  createPool(config: SqlConnectorConfig): Promise<SqlPool>;
}

export interface SqlPool {
  query(sql: string, params: Record<string, unknown>, opts: QueryOptions): Promise<QueryResult>;
  close(): Promise<void>;
}

export interface QueryOptions {
  timeout_ms: number;
  max_rows: number;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}
