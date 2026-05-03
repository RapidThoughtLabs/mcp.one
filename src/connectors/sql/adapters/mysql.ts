import type { SqlAdapter, SqlPool, QueryOptions, QueryResult } from "./types.js";
import type { SqlConnectorConfig } from "../../../types.js";
import { rewriteToPositional } from "../lib/rewrite-placeholders.js";
import { normalizeRow } from "../lib/normalize-row.js";
import { applyRowCap } from "../lib/apply-row-cap.js";
import { resolveCredentials } from "../lib/resolve-credentials.js";

export const adapter: SqlAdapter = {
  async createPool(config: SqlConnectorConfig): Promise<SqlPool> {
    const mysql = await loadDriver();
    const creds = resolveCredentials(config.type, config);

    const pool = mysql.createPool({
      uri: creds.connectionString,
      host: creds.host,
      port: creds.port,
      database: creds.database,
      user: creds.user,
      password: creds.password,
      ssl: creds.ssl ? {} : undefined,
      waitForConnections: true,
      connectionLimit: config.pool?.max ?? 10,
      idleTimeout: config.pool?.idle_ms ?? 30_000,
      connectTimeout: config.pool?.connection_timeout_ms ?? 10_000,
    });

    return {
      async query(sql: string, params: Record<string, unknown>, opts: QueryOptions): Promise<QueryResult> {
        const { sql: capped, mutated } = applyRowCap(sql, opts.max_rows);
        const { sql: rewritten, values } = rewriteToPositional(capped, params, "?");

        const [rawRows] = await pool.query({
          sql: rewritten,
          timeout: opts.timeout_ms,
          values,
        });

        const rows = (rawRows as Record<string, unknown>[]).map(normalizeRow);
        const truncated = mutated && rows.length > opts.max_rows;
        return {
          rows: truncated ? rows.slice(0, opts.max_rows) : rows,
          rowCount: rows.length,
          truncated,
        };
      },
      async close(): Promise<void> {
        await pool.end();
      },
    };
  },
};

async function loadDriver(): Promise<typeof import("mysql2/promise")> {
  try {
    return await import("mysql2/promise");
  } catch {
    throw new Error("`mysql2` driver not installed. Run: npm install mysql2");
  }
}
