import type { SqlAdapter } from "./types.js";
import type { SqlDialect } from "../../../types.js";

export async function getAdapter(dialect: SqlDialect): Promise<SqlAdapter> {
  switch (dialect) {
    case "postgres": {
      const m = await import("./postgres.js");
      return m.adapter;
    }
    case "mysql": {
      const m = await import("./mysql.js");
      return m.adapter;
    }
    case "sqlite": {
      const m = await import("./sqlite.js");
      return m.adapter;
    }
  }
}
