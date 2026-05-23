import type { IConnector, ConnectorResult } from "./base.js";
import type { MongoConnectorConfig, RegisteredTool, ToolDef } from "../types.js";
import { AuthNotConfiguredError } from "../auth/errors.js";
import { resolveEnv } from "../lib/env-store.js";
import type { Collection, Document } from "mongodb";

interface MongoChild {
  configId: string;
  config: MongoConnectorConfig;
  client: import("mongodb").MongoClient;
  db: import("mongodb").Db;
}

type Coll = Collection<Document>;
type Opts = { maxTimeMS?: number; [k: string]: unknown };

export class MongoConnector implements IConnector {
  readonly type = "mongodb" as const;
  private children = new Map<string, MongoChild>();
  private pendingConfigs: Array<{ configId: string; config: MongoConnectorConfig }> = [];

  addConfig(configId: string, config: MongoConnectorConfig): void {
    this.pendingConfigs.push({ configId, config });
  }

  async init(): Promise<void> {
    const pending = this.pendingConfigs.splice(0);
    for (const { configId, config } of pending) {
      await this.#openClient(configId, config);
    }
  }

  async reinitConfig(configId: string, config: MongoConnectorConfig): Promise<void> {
    const existing = this.children.get(configId);
    if (existing) {
      await existing.client.close().catch(() => {});
      this.children.delete(configId);
    }
    await this.#openClient(configId, config);
  }

  async teardown(): Promise<void> {
    for (const child of this.children.values()) {
      await child.client.close().catch(() => {});
    }
    this.children.clear();
  }

  async execute(tool: RegisteredTool, args: Record<string, unknown>): Promise<ConnectorResult> {
    const child = this.children.get(tool.configId);
    if (!child) {
      return { success: false, data: { error: `MongoDB client not initialized for "${tool.configId}"` } };
    }

    const t = tool.tool;
    if (!t.collection) {
      return { success: false, data: { error: `Tool "${t.name}" missing "collection" field` } };
    }
    if (!t.operation) {
      return { success: false, data: { error: `Tool "${t.name}" missing "operation" field` } };
    }

    const params = collectParams(tool, args);
    const timeoutMs = Math.min(t.timeout_ms ?? child.config.default_timeout_ms ?? 30_000, 120_000);
    const maxRows = Math.min(t.limit ?? child.config.default_max_rows ?? 1_000, 10_000);
    const coll = child.db.collection(t.collection) as Coll;

    try {
      switch (t.operation) {
        case "find":           return await execFind(coll, t, params, timeoutMs, maxRows);
        case "findOne":        return await execFindOne(coll, t, params, timeoutMs);
        case "aggregate":      return await execAggregate(coll, t, params, timeoutMs, maxRows);
        case "insertOne":      return await execInsertOne(coll, t, params, timeoutMs);
        case "insertMany":     return await execInsertMany(coll, t, params, timeoutMs);
        case "updateOne":      return await execUpdateOne(coll, t, params, timeoutMs);
        case "updateMany":     return await execUpdateMany(coll, t, params, timeoutMs);
        case "deleteOne":      return await execDeleteOne(coll, t, params, timeoutMs);
        case "deleteMany":     return await execDeleteMany(coll, t, params, timeoutMs);
        case "countDocuments": return await execCountDocuments(coll, t, params, timeoutMs);
        case "distinct":       return await execDistinct(coll, t, params, timeoutMs);
        default:
          return { success: false, data: { error: `Unknown MongoDB operation: "${t.operation}"` } };
      }
    } catch (err) {
      return { success: false, data: { error: (err as Error).message } };
    }
  }

  async #openClient(configId: string, config: MongoConnectorConfig): Promise<void> {
    try {
      const { MongoClient } = await import("mongodb");
      const uri = resolveUri(configId, config);
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
      await client.connect();
      const db = client.db(config.database);
      this.children.set(configId, { configId, config, client, db });
      console.error(
        `[mongo-connector] Connected: ${configId}${config.database ? ` (db: ${config.database})` : ""}`,
      );
    } catch (err) {
      console.error(`[mongo-connector] Failed to init "${configId}":`, (err as Error).message);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function resolveUri(configId: string, config: MongoConnectorConfig): string {
  if (config.connection_string_env) {
    const val = resolveEnv(configId, config.connection_string_env);
    if (!val) throw new AuthNotConfiguredError(configId, "connection_string", [config.connection_string_env]);
    return val;
  }

  const missingVars: string[] = [];
  let user: string | undefined;
  let password: string | undefined;

  if (config.auth) {
    user = resolveEnv(configId, config.auth.username_env);
    password = resolveEnv(configId, config.auth.token_env);
    if (!user) missingVars.push(config.auth.username_env);
    if (!password) missingVars.push(config.auth.token_env);
  }

  if (missingVars.length > 0) {
    throw new AuthNotConfiguredError(configId, "basic", missingVars);
  }

  const host = config.host ?? "localhost";
  const port = config.port ?? 27017;
  const db = config.database ?? "";
  const userPart =
    user && password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@` : "";
  return `mongodb://${userPart}${host}:${port}/${db}`;
}

function collectParams(tool: RegisteredTool, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of tool.tool.params) {
    const v = args[p.name] ?? p.default;
    if (v !== undefined) out[p.name] = v;
  }
  return out;
}

// Substitutes {{param}} at VALUE positions only — never at key positions.
// Full-match ("{{name}}") preserves the original type; partial embeds as string.
function interpolate(value: unknown, params: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const m = value.match(/^\{\{(\w+)\}\}$/);
    if (m) return params[m[1]!] ?? null;
    return value.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(params[k] ?? ""));
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, params));
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = interpolate(v, params); // key is NEVER interpolated — prevents operator injection
    }
    return result;
  }
  return value;
}

// Normalize MongoDB driver types to JSON-serializable primitives.
function normalizeDoc(doc: unknown): unknown {
  if (doc === null || doc === undefined) return doc;
  if (typeof doc === "bigint") return doc.toString();
  if (doc instanceof Date) return doc;
  if (Buffer.isBuffer(doc)) return doc.toString("base64");
  if (Array.isArray(doc)) return doc.map(normalizeDoc);
  if (typeof doc === "object") {
    const obj = doc as Record<string, unknown>;
    const ctor = (obj.constructor as { name?: string } | undefined)?.name;
    if (typeof (obj as { toHexString?: unknown }).toHexString === "function") {
      return (obj as { toHexString(): string }).toHexString(); // ObjectId
    }
    if (ctor === "Decimal128" || ctor === "Long" || ctor === "Int32") {
      return (obj as { toString(): string }).toString();
    }
    if (ctor === "Binary") {
      const b = obj as { value?(): string; buffer?: Buffer };
      return b.value ? b.value() : (b.buffer ? b.buffer.toString("base64") : null);
    }
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = normalizeDoc(v);
    }
    return result;
  }
  return doc;
}

// ── Operations ────────────────────────────────────────────────────────────

async function execFind(
  coll: Coll,
  t: ToolDef,
  params: Record<string, unknown>,
  timeoutMs: number,
  maxRows: number,
): Promise<ConnectorResult> {
  const filter = (t.filter_template ? interpolate(t.filter_template, params) : {}) as Document;
  const opts: Opts = { maxTimeMS: timeoutMs };
  if (t.projection) opts.projection = t.projection;
  if (t.sort) opts.sort = t.sort;
  const cursor = coll.find(filter, opts as Parameters<Coll["find"]>[1]);
  const rows = await cursor.limit(maxRows + 1).toArray();
  const truncated = rows.length > maxRows;
  return {
    success: true,
    data: {
      rows: rows.slice(0, maxRows).map(normalizeDoc),
      rowCount: truncated ? maxRows : rows.length,
      truncated,
    },
  };
}

async function execFindOne(
  coll: Coll,
  t: ToolDef,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<ConnectorResult> {
  const filter = (t.filter_template ? interpolate(t.filter_template, params) : {}) as Document;
  const opts: Opts = { maxTimeMS: timeoutMs };
  if (t.projection) opts.projection = t.projection;
  const doc = await coll.findOne(filter, opts as Parameters<Coll["findOne"]>[1]);
  return { success: true, data: doc !== null ? normalizeDoc(doc) : null };
}

async function execAggregate(
  coll: Coll,
  t: ToolDef,
  params: Record<string, unknown>,
  timeoutMs: number,
  maxRows: number,
): Promise<ConnectorResult> {
  if (!t.pipeline_template) {
    return { success: false, data: { error: `Tool "${t.name}" missing "pipeline_template"` } };
  }
  // Append $limit to prevent unbounded cursor; existing $limit in pipeline takes effect first.
  const pipeline = [
    ...(interpolate(t.pipeline_template, params) as Document[]),
    { $limit: maxRows + 1 },
  ];
  const rows = await coll
    .aggregate(pipeline, { maxTimeMS: timeoutMs } as Parameters<Coll["aggregate"]>[1])
    .toArray();
  const truncated = rows.length > maxRows;
  return {
    success: true,
    data: {
      rows: rows.slice(0, maxRows).map(normalizeDoc),
      rowCount: truncated ? maxRows : rows.length,
      truncated,
    },
  };
}

async function execInsertOne(
  coll: Coll,
  t: ToolDef,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<ConnectorResult> {
  if (!t.document_template) {
    return { success: false, data: { error: `Tool "${t.name}" missing "document_template"` } };
  }
  const doc = interpolate(t.document_template, params) as Document;
  const result = await coll.insertOne(doc, { maxTimeMS: timeoutMs } as Parameters<Coll["insertOne"]>[1]);
  return {
    success: true,
    data: { insertedId: String(result.insertedId), acknowledged: result.acknowledged },
  };
}

async function execInsertMany(
  coll: Coll,
  t: ToolDef,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<ConnectorResult> {
  if (!t.documents_template) {
    return { success: false, data: { error: `Tool "${t.name}" missing "documents_template"` } };
  }
  const docs = interpolate(t.documents_template, params) as Document[];
  const result = await coll.insertMany(docs, { maxTimeMS: timeoutMs } as Parameters<Coll["insertMany"]>[1]);
  return {
    success: true,
    data: {
      insertedCount: result.insertedCount,
      acknowledged: result.acknowledged,
      insertedIds: Object.fromEntries(
        Object.entries(result.insertedIds).map(([i, id]) => [i, String(id)]),
      ),
    },
  };
}

async function execUpdateOne(
  coll: Coll,
  t: ToolDef,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<ConnectorResult> {
  if (!t.update_template) {
    return { success: false, data: { error: `Tool "${t.name}" missing "update_template"` } };
  }
  const filter = (t.filter_template ? interpolate(t.filter_template, params) : {}) as Document;
  const update = interpolate(t.update_template, params) as Document;
  const result = await coll.updateOne(
    filter,
    update,
    { maxTimeMS: timeoutMs } as Parameters<Coll["updateOne"]>[2],
  );
  return {
    success: true,
    data: {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      acknowledged: result.acknowledged,
    },
  };
}

async function execUpdateMany(
  coll: Coll,
  t: ToolDef,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<ConnectorResult> {
  if (!t.update_template) {
    return { success: false, data: { error: `Tool "${t.name}" missing "update_template"` } };
  }
  const filter = (t.filter_template ? interpolate(t.filter_template, params) : {}) as Document;
  const update = interpolate(t.update_template, params) as Document;
  const result = await coll.updateMany(
    filter,
    update,
    { maxTimeMS: timeoutMs } as Parameters<Coll["updateMany"]>[2],
  );
  return {
    success: true,
    data: {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      acknowledged: result.acknowledged,
    },
  };
}

async function execDeleteOne(
  coll: Coll,
  t: ToolDef,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<ConnectorResult> {
  const filter = (t.filter_template ? interpolate(t.filter_template, params) : {}) as Document;
  const result = await coll.deleteOne(
    filter,
    { maxTimeMS: timeoutMs } as Parameters<Coll["deleteOne"]>[1],
  );
  return {
    success: true,
    data: { deletedCount: result.deletedCount, acknowledged: result.acknowledged },
  };
}

async function execDeleteMany(
  coll: Coll,
  t: ToolDef,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<ConnectorResult> {
  const filter = (t.filter_template ? interpolate(t.filter_template, params) : {}) as Document;
  const result = await coll.deleteMany(
    filter,
    { maxTimeMS: timeoutMs } as Parameters<Coll["deleteMany"]>[1],
  );
  return {
    success: true,
    data: { deletedCount: result.deletedCount, acknowledged: result.acknowledged },
  };
}

async function execCountDocuments(
  coll: Coll,
  t: ToolDef,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<ConnectorResult> {
  const filter = (t.filter_template ? interpolate(t.filter_template, params) : {}) as Document;
  const count = await coll.countDocuments(
    filter,
    { maxTimeMS: timeoutMs } as Parameters<Coll["countDocuments"]>[1],
  );
  return { success: true, data: { count } };
}

async function execDistinct(
  coll: Coll,
  t: ToolDef,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<ConnectorResult> {
  const field = String(params.field ?? "");
  if (!field) {
    return {
      success: false,
      data: { error: `Tool "${t.name}" "distinct" operation requires a param named "field"` },
    };
  }
  const filter = (t.filter_template ? interpolate(t.filter_template, params) : {}) as Document;
  const values = await coll.distinct(
    field,
    filter,
    { maxTimeMS: timeoutMs } as Parameters<Coll["distinct"]>[2],
  );
  return { success: true, data: { values: values.map(normalizeDoc), count: values.length } };
}
