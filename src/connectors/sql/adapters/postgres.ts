import type { Pool, PoolConfig } from "pg";
import type { SqlAdapter, SqlPool, QueryOptions, QueryResult } from "./types.js";
import type { SqlConnectorConfig } from "../../../types.js";
import { rewriteToPositional } from "../lib/rewrite-placeholders.js";
import { normalizeRow } from "../lib/normalize-row.js";
import { applyRowCap } from "../lib/apply-row-cap.js";
import { resolveCredentials } from "../lib/resolve-credentials.js";

export const adapter: SqlAdapter = {
  async createPool(config: SqlConnectorConfig): Promise<SqlPool> {
    const pg = await loadDriver();
    const creds = resolveCredentials(config.type, config);

    const pool: Pool = new pg.Pool({
      connectionString: creds.connectionString,
      host: creds.host,
      port: creds.port,
      database: creds.database,
      user: creds.user,
      password: creds.password,
      ssl: creds.ssl as PoolConfig["ssl"],
      max: config.pool?.max ?? 10,
      idleTimeoutMillis: config.pool?.idle_ms ?? 30_000,
      connectionTimeoutMillis: config.pool?.connection_timeout_ms ?? 10_000,
    });

    return {
      async query(sql: string, params: Record<string, unknown>, opts: QueryOptions): Promise<QueryResult> {
        const { sql: capped, mutated } = applyRowCap(sql, opts.max_rows);
        const { sql: rewritten, values } = rewriteToPositional(capped, params, "$N");

        const client = await pool.connect();
        try {
          await client.query(`SET LOCAL statement_timeout = ${opts.timeout_ms}`);
          const r = await client.query(rewritten, values);
          const rows = (r.rows as Record<string, unknown>[]).map(normalizeRow);
          const truncated = mutated && rows.length > opts.max_rows;
          return {
            rows: truncated ? rows.slice(0, opts.max_rows) : rows,
            rowCount: r.rowCount ?? rows.length,
            truncated,
          };
        } finally {
          client.release();
        }
      },
      async close(): Promise<void> {
        await pool.end();
      },
    };
  },
};

async function loadDriver(): Promise<typeof import("pg")["default"]> {
  try {
    const m = await import("pg");
    return m.default ?? m;
  } catch {
    throw new Error("`pg` driver not installed. Run: npm install pg");
  }
}
