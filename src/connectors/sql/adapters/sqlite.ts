import type { SqlAdapter, SqlPool, QueryOptions, QueryResult } from "./types.js";
import type { SqlConnectorConfig } from "../../../types.js";
import { normalizeRow } from "../lib/normalize-row.js";
import { resolveCredentials } from "../lib/resolve-credentials.js";

// SQLite adapter — Phase 1.5. Stubbed so the module resolves at compile time.
// better-sqlite3 is synchronous; no async pool needed.
export const adapter: SqlAdapter = {
  async createPool(config: SqlConnectorConfig): Promise<SqlPool> {
    const Database = await loadDriver();
    const creds = resolveCredentials(config.type, config);

    const dbPath = creds.database ?? ":memory:";
    const db = new Database(dbPath);

    return {
      async query(sql: string, params: Record<string, unknown>, opts: QueryOptions): Promise<QueryResult> {
        // better-sqlite3 supports :name placeholders natively
        const stmt = db.prepare(sql);
        const raw = stmt.all(params) as Record<string, unknown>[];
        const rows = raw.map(normalizeRow);
        const truncated = rows.length > opts.max_rows;
        return {
          rows: truncated ? rows.slice(0, opts.max_rows) : rows,
          rowCount: rows.length,
          truncated,
        };
      },
      async close(): Promise<void> {
        db.close();
      },
    };
  },
};

async function loadDriver(): Promise<typeof import("better-sqlite3")> {
  try {
    const m = await import("better-sqlite3");
    return m.default ?? m;
  } catch {
    throw new Error("`better-sqlite3` driver not installed. Run: npm install better-sqlite3");
  }
}
