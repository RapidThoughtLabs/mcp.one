export interface RowCapResult {
  sql: string;
  mutated: boolean;
}

/**
 * Wrap SELECT statements with a LIMIT to cap row count.
 * Requests maxRows+1 rows so the adapter can detect truncation.
 * Non-SELECT statements (INSERT, UPDATE, DELETE, etc.) pass through unchanged.
 */
export function applyRowCap(sql: string, maxRows: number): RowCapResult {
  const upper = sql.trimStart().slice(0, 6).toUpperCase();
  if (upper !== "SELECT") {
    return { sql, mutated: false };
  }
  return {
    sql: `SELECT * FROM (${sql}) AS __mcp_outer LIMIT ${maxRows + 1}`,
    mutated: true,
  };
}
