import fs from "node:fs";
import path from "node:path";
import { log } from "./lib/logger.js";
import type {
  McpConfig,
  AuthConfig,
  ToolDef,
  ParamDef,
  ConnectorConfig,
  ConnectorType,
  HttpConnectorConfig,
  McpConnectorConfig,
  GraphqlConnectorConfig,
  GrpcConnectorConfig,
  SqlConnectorConfig,
  MongoConnectorConfig,
  SqlDialect,
} from "./types.js";
import { extractPlaceholderNames } from "./connectors/sql/lib/rewrite-placeholders.js";

// ── Validation Helpers ─────────────────────────────────────────────

function assertString(val: unknown, field: string, file: string): asserts val is string {
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`[${file}] "${field}" must be a non-empty string, got: ${JSON.stringify(val)}`);
  }
}

function assertArray(val: unknown, field: string, file: string): asserts val is unknown[] {
  if (!Array.isArray(val)) {
    throw new Error(`[${file}] "${field}" must be an array, got: ${typeof val}`);
  }
}

const VALID_AUTH_TYPES = ["bearer", "basic", "api_key", "oauth2_static"] as const;
const VALID_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const VALID_PARAM_TYPES = ["string", "number", "boolean", "object", "array"] as const;
const VALID_PARAM_LOCATIONS = ["body", "path", "query", "header"] as const;
const VALID_CONNECTOR_TYPES: ConnectorType[] = ["http", "cli", "file", "grpc", "graphql", "mcp", "internal", "sql", "mongodb"];
const VALID_SQL_DIALECTS: SqlDialect[] = ["postgres", "mysql", "sqlite"];
const VALID_MONGO_OPERATIONS = [
  "find", "findOne", "aggregate",
  "insertOne", "insertMany",
  "updateOne", "updateMany",
  "deleteOne", "deleteMany",
  "countDocuments", "distinct",
] as const;

function validateAuth(auth: unknown, file: string): AuthConfig {
  if (!auth || typeof auth !== "object") {
    throw new Error(`[${file}] "auth" must be an object`);
  }
  const a = auth as Record<string, unknown>;

  if (!VALID_AUTH_TYPES.includes(a.type as typeof VALID_AUTH_TYPES[number])) {
    throw new Error(`[${file}] auth.type must be one of: ${VALID_AUTH_TYPES.join(", ")}. Got: ${JSON.stringify(a.type)}`);
  }

  // Optional auth_url (shown to user during `mcp-one auth setup`)
  const auth_url = typeof a.auth_url === "string" && a.auth_url.length > 0
    ? a.auth_url
    : undefined;

  // Optional description — service-specific hint shown during `mcp-one auth setup`
  const description = typeof a.description === "string" && a.description.length > 0
    ? a.description
    : undefined;

  switch (a.type) {
    case "bearer":
      assertString(a.token_env, "auth.token_env", file);
      return { type: "bearer", token_env: a.token_env, ...(auth_url ? { auth_url } : {}), ...(description ? { description } : {}) };

    case "basic":
      assertString(a.username_env, "auth.username_env", file);
      assertString(a.token_env, "auth.token_env", file);
      return { type: "basic", username_env: a.username_env, token_env: a.token_env, ...(auth_url ? { auth_url } : {}), ...(description ? { description } : {}) };

    case "api_key":
      assertString(a.key_env, "auth.key_env", file);
      assertString(a.header_name, "auth.header_name", file);
      return { type: "api_key", key_env: a.key_env, header_name: a.header_name, ...(auth_url ? { auth_url } : {}), ...(description ? { description } : {}) };

    case "oauth2_static":
      assertString(a.token_env, "auth.token_env", file);
      return { type: "oauth2_static", token_env: a.token_env, ...(auth_url ? { auth_url } : {}), ...(description ? { description } : {}) };

    default:
      throw new Error(`[${file}] Unknown auth type: ${a.type}`);
  }
}

// ── Param Validation ───────────────────────────────────────────────

function validateParam(param: unknown, toolName: string, file: string, requireLocation = false): ParamDef {
  if (!param || typeof param !== "object") {
    throw new Error(`[${file}] tool "${toolName}" has an invalid param — must be an object`);
  }
  const p = param as Record<string, unknown>;

  assertString(p.name, `param.name (tool: ${toolName})`, file);
  assertString(p.description, `param "${p.name}".description (tool: ${toolName})`, file);

  if (!VALID_PARAM_TYPES.includes(p.type as typeof VALID_PARAM_TYPES[number])) {
    throw new Error(`[${file}] param "${p.name}" (tool: ${toolName}) — type must be one of: ${VALID_PARAM_TYPES.join(", ")}. Got: ${JSON.stringify(p.type)}`);
  }

  // location: required for HTTP params, optional for others
  if (requireLocation || p.location !== undefined) {
    if (!VALID_PARAM_LOCATIONS.includes(p.location as typeof VALID_PARAM_LOCATIONS[number])) {
      throw new Error(`[${file}] param "${p.name}" (tool: ${toolName}) — location must be one of: ${VALID_PARAM_LOCATIONS.join(", ")}. Got: ${JSON.stringify(p.location)}`);
    }
  }

  return {
    name: p.name,
    type: p.type as ParamDef["type"],
    required: p.required === true,
    default: p.default,
    location: p.location as ParamDef["location"] | undefined,
    description: p.description,
  };
}

// ── Tool Validation (per connector type) ──────────────────────────

function validateHttpTool(tool: unknown, file: string): ToolDef {
  if (!tool || typeof tool !== "object") {
    throw new Error(`[${file}] Each tool must be an object`);
  }
  const t = tool as Record<string, unknown>;

  assertString(t.name, "tool.name", file);
  assertString(t.description, `tool "${t.name}".description`, file);
  assertString(t.path, `tool "${t.name}".path`, file);

  if (!VALID_METHODS.includes(t.method as typeof VALID_METHODS[number])) {
    throw new Error(`[${file}] tool "${t.name}" — method must be one of: ${VALID_METHODS.join(", ")}. Got: ${JSON.stringify(t.method)}`);
  }

  assertArray(t.params, `tool "${t.name}".params`, file);
  const params = (t.params as unknown[]).map((p) => validateParam(p, t.name as string, file, true));

  const result: ToolDef = {
    name: t.name,
    description: t.description,
    method: t.method as ToolDef["method"],
    path: t.path,
    params,
  };

  if (t.body_template !== undefined) {
    if (typeof t.body_template !== "object" || t.body_template === null) {
      throw new Error(`[${file}] tool "${t.name}".body_template must be a JSON object`);
    }
    result.body_template = t.body_template as Record<string, unknown>;
  }

  if (t.response_map !== undefined) {
    if (typeof t.response_map !== "object" || t.response_map === null) {
      throw new Error(`[${file}] tool "${t.name}".response_map must be an object`);
    }
    result.response_map = t.response_map as Record<string, string>;
  }

  if (t.error_map !== undefined) {
    if (typeof t.error_map !== "object" || t.error_map === null) {
      throw new Error(`[${file}] tool "${t.name}".error_map must be an object`);
    }
    result.error_map = t.error_map as Record<string, string>;
  }

  return result;
}

function validateBaseTool(tool: unknown, file: string): { name: string; description: string; params: ReturnType<typeof validateParam>[] } {
  if (!tool || typeof tool !== "object") {
    throw new Error(`[${file}] Each tool must be an object`);
  }
  const t = tool as Record<string, unknown>;

  assertString(t.name, "tool.name", file);
  assertString(t.description, `tool "${t.name}".description`, file);
  assertArray(t.params, `tool "${t.name}".params`, file);

  const params = (t.params as unknown[]).map((p) => validateParam(p, t.name as string, file, false));
  return { name: t.name as string, description: t.description as string, params };
}

function validateCliTool(tool: unknown, file: string): ToolDef {
  const base = validateBaseTool(tool, file);
  const t = tool as Record<string, unknown>;

  const hasCommand = typeof t.command === "string" && t.command.length > 0;
  const hasArgsTemplate = Array.isArray(t.args_template) && t.args_template.length > 0;

  if (!hasCommand && !hasArgsTemplate) {
    throw new Error(
      `[${file}] CLI tool "${base.name}" must have "command" (string) or "args_template" (array)`,
    );
  }

  const result: ToolDef = { ...base };

  if (hasCommand) result.command = t.command as string;
  if (hasArgsTemplate) result.args_template = t.args_template as string[];
  if (typeof t.stdin_template === "string") result.stdin_template = t.stdin_template;
  if (t.output_as === "json" || t.output_as === "text") result.output_as = t.output_as;

  return result;
}

function validateFileTool(tool: unknown, file: string): ToolDef {
  const base = validateBaseTool(tool, file);
  const t = tool as Record<string, unknown>;

  const VALID_OPERATIONS = ["read", "write", "append", "delete", "list"] as const;
  type FileOperation = typeof VALID_OPERATIONS[number];

  if (!VALID_OPERATIONS.includes(t.operation as FileOperation)) {
    throw new Error(
      `[${file}] File tool "${base.name}" — operation must be one of: ${VALID_OPERATIONS.join(", ")}. Got: ${JSON.stringify(t.operation)}`,
    );
  }

  assertString(t.path_template, `tool "${base.name}".path_template`, file);

  const result: ToolDef = {
    ...base,
    operation: t.operation as FileOperation,
    path_template: t.path_template as string,
  };

  const needsContent = t.operation === "write" || t.operation === "append";
  if (needsContent) {
    if (typeof t.content_template !== "string") {
      throw new Error(
        `[${file}] File tool "${base.name}" — "${t.operation}" operation requires "content_template" (string)`,
      );
    }
    result.content_template = t.content_template;
  }

  return result;
}

function validateSqlTool(tool: unknown, file: string): ToolDef {
  const base = validateBaseTool(tool, file);
  const t = tool as Record<string, unknown>;

  assertString(t.sql, `tool "${base.name}".sql`, file);
  const sql = t.sql as string;

  if (sql.includes("{{")) {
    throw new Error(
      `[${file}] SQL tool "${base.name}": template interpolation ({{...}}) is not allowed in SQL — use :name placeholders`,
    );
  }
  if (/\$\d+/.test(sql)) {
    throw new Error(
      `[${file}] SQL tool "${base.name}": positional $N placeholders are not allowed — use :name placeholders`,
    );
  }
  if (/(?<![a-zA-Z0-9_])\?(?![a-zA-Z0-9_])/.test(sql)) {
    throw new Error(
      `[${file}] SQL tool "${base.name}": bare ? placeholders are not allowed — use :name placeholders`,
    );
  }

  const sqlNames = new Set(extractPlaceholderNames(sql));
  const paramNames = new Set(base.params.map((p) => p.name));

  for (const name of sqlNames) {
    if (!paramNames.has(name)) {
      throw new Error(
        `[${file}] SQL tool "${base.name}": placeholder :${name} is not declared in params`,
      );
    }
  }

  if (t.max_rows !== undefined) {
    if (typeof t.max_rows !== "number" || t.max_rows < 1 || t.max_rows > 10_000) {
      throw new Error(`[${file}] SQL tool "${base.name}".max_rows must be a number between 1 and 10000`);
    }
  }
  if (t.timeout_ms !== undefined) {
    if (typeof t.timeout_ms !== "number" || t.timeout_ms < 1 || t.timeout_ms > 120_000) {
      throw new Error(`[${file}] SQL tool "${base.name}".timeout_ms must be a number between 1 and 120000`);
    }
  }

  const result: ToolDef = { ...base, sql };
  if (t.max_rows !== undefined) result.max_rows = t.max_rows as number;
  if (t.timeout_ms !== undefined) result.timeout_ms = t.timeout_ms as number;
  return result;
}

function validateMongoTool(tool: unknown, file: string): ToolDef {
  const base = validateBaseTool(tool, file);
  const t = tool as Record<string, unknown>;

  assertString(t.collection, `tool "${base.name}".collection`, file);

  const op = t.operation as string;
  if (!VALID_MONGO_OPERATIONS.includes(op as typeof VALID_MONGO_OPERATIONS[number])) {
    throw new Error(
      `[${file}] MongoDB tool "${base.name}".operation must be one of: ${VALID_MONGO_OPERATIONS.join(", ")}. Got: ${JSON.stringify(op)}`,
    );
  }

  if ((op === "insertOne") && !t.document_template) {
    throw new Error(`[${file}] MongoDB tool "${base.name}": insertOne requires document_template`);
  }
  if ((op === "insertMany") && !t.documents_template) {
    throw new Error(`[${file}] MongoDB tool "${base.name}": insertMany requires documents_template`);
  }
  if ((op === "updateOne" || op === "updateMany") && (!t.filter_template || !t.update_template)) {
    throw new Error(`[${file}] MongoDB tool "${base.name}": ${op} requires filter_template and update_template`);
  }
  if (op === "aggregate" && !t.pipeline_template) {
    throw new Error(`[${file}] MongoDB tool "${base.name}": aggregate requires pipeline_template`);
  }

  const result: ToolDef = {
    ...base,
    collection: t.collection as string,
    operation: op as ToolDef["operation"],
  };
  if (t.filter_template) result.filter_template = t.filter_template as Record<string, unknown>;
  if (t.update_template) result.update_template = t.update_template as Record<string, unknown>;
  if (t.document_template) result.document_template = t.document_template as Record<string, unknown>;
  if (t.documents_template) result.documents_template = t.documents_template as Array<Record<string, unknown>>;
  if (t.pipeline_template) result.pipeline_template = t.pipeline_template as Array<Record<string, unknown>>;
  if (t.projection) result.projection = t.projection as Record<string, 0 | 1>;
  if (t.sort) result.sort = t.sort as Record<string, 1 | -1>;
  if (t.max_rows !== undefined) result.max_rows = t.max_rows as number;
  if (t.timeout_ms !== undefined) result.timeout_ms = t.timeout_ms as number;
  if (t.limit !== undefined) result.limit = t.limit as number;
  return result;
}

function validateToolForConnector(tool: unknown, connectorType: ConnectorType, file: string): ToolDef {
  switch (connectorType) {
    case "http":
      return validateHttpTool(tool, file);
    case "cli":
      return validateCliTool(tool, file);
    case "file":
      return validateFileTool(tool, file);
    case "grpc":
    case "graphql":
      return validateBaseTool(tool, file) as ToolDef;
    case "internal":
      return validateBaseTool(tool, file) as ToolDef;
    case "sql":
      return validateSqlTool(tool, file);
    case "mongodb":
      return validateMongoTool(tool, file);
    default:
      throw new Error(`[${file}] Unknown connector type: ${connectorType}`);
  }
}

// ── Connector Config Validation ────────────────────────────────────

function validateHttpConnectorConfig(raw: Record<string, unknown>, file: string): HttpConnectorConfig {
  assertString(raw.base_url, "connector.base_url", file);
  const result: HttpConnectorConfig = { type: "http", base_url: raw.base_url as string };
  if (raw.auth !== undefined) result.auth = validateAuth(raw.auth, file);
  return result;
}

function validateMcpConnectorConfig(raw: Record<string, unknown>, file: string): McpConnectorConfig {
  const validTransports = ["stdio", "sse"];
  if (!validTransports.includes(raw.transport as string)) {
    throw new Error(`[${file}] connector.transport must be "stdio" or "sse". Got: ${JSON.stringify(raw.transport)}`);
  }

  if (raw.transport === "stdio") {
    assertString(raw.command, "connector.command", file);
  }
  if (raw.transport === "sse") {
    assertString(raw.url, "connector.url", file);
  }

  // ── install_command validation ─────────────────────────────────────
  if (raw.install_command !== undefined) {
    if (raw.transport !== "stdio") {
      throw new Error(`[${file}] install_command is only supported for stdio transport`);
    }
    assertString(raw.install_command, "connector.install_command", file);
  }

  if (raw.install_args !== undefined) {
    if (!raw.install_command) {
      throw new Error(`[${file}] connector.install_args requires install_command to be set`);
    }
    if (!Array.isArray(raw.install_args) || !raw.install_args.every((a) => typeof a === "string")) {
      throw new Error(`[${file}] connector.install_args must be a string array`);
    }
  }

  if (raw.install_timeout_ms !== undefined) {
    if (typeof raw.install_timeout_ms !== "number" || !Number.isInteger(raw.install_timeout_ms) || raw.install_timeout_ms < 1) {
      throw new Error(`[${file}] connector.install_timeout_ms must be a positive integer`);
    }
    if (raw.install_timeout_ms > 1_800_000) {
      throw new Error(`[${file}] connector.install_timeout_ms must not exceed 1800000 (30 min)`);
    }
  }

  if (raw.install_env !== undefined) {
    if (typeof raw.install_env !== "object" || raw.install_env === null || Array.isArray(raw.install_env)) {
      throw new Error(`[${file}] connector.install_env must be a string-keyed object`);
    }
    for (const [k, v] of Object.entries(raw.install_env as Record<string, unknown>)) {
      if (typeof v !== "string") {
        throw new Error(`[${file}] connector.install_env["${k}"] must be a string`);
      }
    }
  }

  if (raw.install_cwd !== undefined) {
    assertString(raw.install_cwd, "connector.install_cwd", file);
  }

  if (raw.install_check_command !== undefined) {
    assertString(raw.install_check_command, "connector.install_check_command", file);
  }

  return {
    type: "mcp",
    transport: raw.transport as "stdio" | "sse",
    ...(raw.command ? { command: raw.command as string } : {}),
    ...(raw.args ? { args: raw.args as string[] } : {}),
    ...(raw.env ? { env: raw.env as Record<string, string> } : {}),
    ...(raw.url ? { url: raw.url as string } : {}),
    ...(raw.install_command ? { install_command: raw.install_command as string } : {}),
    ...(raw.install_args ? { install_args: raw.install_args as string[] } : {}),
    ...(raw.install_cwd ? { install_cwd: raw.install_cwd as string } : {}),
    ...(raw.install_env ? { install_env: raw.install_env as Record<string, string> } : {}),
    ...(raw.install_timeout_ms ? { install_timeout_ms: raw.install_timeout_ms as number } : {}),
    ...(raw.install_check_command ? { install_check_command: raw.install_check_command as string } : {}),
  };
}

function validateGraphqlConnectorConfig(raw: Record<string, unknown>, file: string): GraphqlConnectorConfig {
  assertString(raw.endpoint, "connector.endpoint", file);
  const result: GraphqlConnectorConfig = { type: "graphql", endpoint: raw.endpoint as string };
  if (raw.auth !== undefined) result.auth = validateAuth(raw.auth, file);
  if (raw.introspect !== undefined && typeof raw.introspect !== "boolean") {
    throw new Error(`[${file}] connector.introspect must be a boolean`);
  }
  if (raw.introspect !== undefined) result.introspect = raw.introspect as boolean;
  if (raw.include_mutations !== undefined && typeof raw.include_mutations !== "boolean") {
    throw new Error(`[${file}] connector.include_mutations must be a boolean`);
  }
  if (raw.include_mutations !== undefined) result.include_mutations = raw.include_mutations as boolean;
  if (raw.include_queries !== undefined && typeof raw.include_queries !== "boolean") {
    throw new Error(`[${file}] connector.include_queries must be a boolean`);
  }
  if (raw.include_queries !== undefined) result.include_queries = raw.include_queries as boolean;
  if (raw.headers !== undefined) {
    if (typeof raw.headers !== "object" || raw.headers === null || Array.isArray(raw.headers)) {
      throw new Error(`[${file}] connector.headers must be an object`);
    }
    result.headers = raw.headers as Record<string, string>;
  }
  if (raw.timeout_ms !== undefined) {
    if (typeof raw.timeout_ms !== "number") {
      throw new Error(`[${file}] connector.timeout_ms must be a number`);
    }
    result.timeout_ms = raw.timeout_ms;
  }
  return result;
}

function validateGrpcConnectorConfig(raw: Record<string, unknown>, file: string): GrpcConnectorConfig {
  assertString(raw.endpoint, "connector.endpoint", file);

  const hasProto = typeof raw.proto_path === "string" && raw.proto_path.length > 0;
  const hasReflection = raw.reflection === true;

  if (!hasProto && !hasReflection) {
    throw new Error(
      `[${file}] gRPC connector requires either "proto_path" (string) or "reflection: true"`,
    );
  }

  const result: GrpcConnectorConfig = { type: "grpc", endpoint: raw.endpoint as string };

  if (hasProto) result.proto_path = raw.proto_path as string;
  if (hasReflection) result.reflection = true;

  if (raw.proto_include_dirs !== undefined) {
    if (!Array.isArray(raw.proto_include_dirs)) {
      throw new Error(`[${file}] connector.proto_include_dirs must be an array`);
    }
    result.proto_include_dirs = raw.proto_include_dirs as string[];
  }

  if (raw.tls !== undefined) {
    if (typeof raw.tls === "boolean") {
      result.tls = raw.tls;
    } else if (typeof raw.tls === "object" && raw.tls !== null) {
      const tls = raw.tls as Record<string, unknown>;
      result.tls = {
        ...(typeof tls.ca_cert_path === "string" ? { ca_cert_path: tls.ca_cert_path } : {}),
        ...(typeof tls.client_cert_path === "string" ? { client_cert_path: tls.client_cert_path } : {}),
        ...(typeof tls.client_key_path === "string" ? { client_key_path: tls.client_key_path } : {}),
      };
    } else {
      throw new Error(`[${file}] connector.tls must be a boolean or object`);
    }
  }

  if (raw.auth !== undefined) result.auth = validateAuth(raw.auth, file);

  if (raw.metadata !== undefined) {
    if (typeof raw.metadata !== "object" || raw.metadata === null || Array.isArray(raw.metadata)) {
      throw new Error(`[${file}] connector.metadata must be an object`);
    }
    result.metadata = raw.metadata as Record<string, string>;
  }

  if (raw.service_filter !== undefined) {
    if (typeof raw.service_filter !== "string") {
      throw new Error(`[${file}] connector.service_filter must be a string`);
    }
    result.service_filter = raw.service_filter;
  }

  if (raw.timeout_ms !== undefined) {
    if (typeof raw.timeout_ms !== "number") {
      throw new Error(`[${file}] connector.timeout_ms must be a number`);
    }
    result.timeout_ms = raw.timeout_ms;
  }

  return result;
}

function validateSqlConnectorConfig(raw: Record<string, unknown>, file: string): SqlConnectorConfig {
  if (!VALID_SQL_DIALECTS.includes(raw.dialect as SqlDialect)) {
    throw new Error(
      `[${file}] connector.dialect must be one of: ${VALID_SQL_DIALECTS.join(", ")}. Got: ${JSON.stringify(raw.dialect)}`,
    );
  }

  const hasDsn = typeof raw.connection_string_env === "string" && raw.connection_string_env.length > 0;
  const hasFieldBased = raw.host !== undefined || raw.database !== undefined;

  if (hasDsn && hasFieldBased) {
    throw new Error(
      `[${file}] SQL connector: use either connection_string_env OR field-based (host/database), not both`,
    );
  }
  if (!hasDsn && !hasFieldBased && raw.dialect !== "sqlite") {
    throw new Error(
      `[${file}] SQL connector: must provide connection_string_env or field-based connection fields`,
    );
  }
  if (raw.dialect === "sqlite" && !hasDsn && !raw.database) {
    throw new Error(`[${file}] SQLite connector: "database" (file path) is required`);
  }

  if (raw.default_timeout_ms !== undefined) {
    if (typeof raw.default_timeout_ms !== "number" || raw.default_timeout_ms > 120_000) {
      throw new Error(`[${file}] connector.default_timeout_ms must be a number ≤ 120000`);
    }
  }
  if (raw.default_max_rows !== undefined) {
    if (typeof raw.default_max_rows !== "number" || raw.default_max_rows > 10_000) {
      throw new Error(`[${file}] connector.default_max_rows must be a number ≤ 10000`);
    }
  }
  if (raw.pool !== undefined && typeof raw.pool === "object" && raw.pool !== null) {
    const pool = raw.pool as Record<string, unknown>;
    if (pool.max !== undefined && (typeof pool.max !== "number" || pool.max < 1)) {
      throw new Error(`[${file}] connector.pool.max must be a positive integer`);
    }
    if (pool.idle_ms !== undefined && (typeof pool.idle_ms !== "number" || pool.idle_ms < 0)) {
      throw new Error(`[${file}] connector.pool.idle_ms must be a non-negative number`);
    }
  }

  const result: SqlConnectorConfig = {
    type: "sql",
    dialect: raw.dialect as SqlDialect,
  };
  if (hasDsn) result.connection_string_env = raw.connection_string_env as string;
  if (raw.host) result.host = raw.host as string;
  if (raw.port) result.port = raw.port as number;
  if (raw.database) result.database = raw.database as string;
  if (raw.ssl !== undefined) result.ssl = raw.ssl as SqlConnectorConfig["ssl"];
  if (raw.auth !== undefined) result.auth = validateAuth(raw.auth, file) as SqlConnectorConfig["auth"];
  if (raw.pool) result.pool = raw.pool as SqlConnectorConfig["pool"];
  if (raw.default_timeout_ms) result.default_timeout_ms = raw.default_timeout_ms as number;
  if (raw.default_max_rows) result.default_max_rows = raw.default_max_rows as number;
  return result;
}

function validateMongoConnectorConfig(raw: Record<string, unknown>, file: string): MongoConnectorConfig {
  const hasDsn = typeof raw.connection_string_env === "string" && raw.connection_string_env.length > 0;
  const hasFieldBased = raw.host !== undefined || raw.database !== undefined;

  if (hasDsn && hasFieldBased) {
    throw new Error(
      `[${file}] MongoDB connector: use either connection_string_env OR field-based (host/database), not both`,
    );
  }
  if (!hasDsn && !hasFieldBased) {
    throw new Error(
      `[${file}] MongoDB connector: must provide connection_string_env or field-based connection fields`,
    );
  }

  const result: MongoConnectorConfig = { type: "mongodb" };
  if (hasDsn) result.connection_string_env = raw.connection_string_env as string;
  if (raw.host) result.host = raw.host as string;
  if (raw.port) result.port = raw.port as number;
  if (raw.database) result.database = raw.database as string;
  if (raw.ssl !== undefined) result.ssl = raw.ssl as boolean;
  if (raw.auth !== undefined) result.auth = validateAuth(raw.auth, file) as MongoConnectorConfig["auth"];
  if (raw.default_timeout_ms) result.default_timeout_ms = raw.default_timeout_ms as number;
  if (raw.default_max_rows) result.default_max_rows = raw.default_max_rows as number;
  return result;
}

function validateConnectorConfig(raw: unknown, file: string): ConnectorConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`[${file}] "connector" must be an object`);
  }
  const c = raw as Record<string, unknown>;

  if (!VALID_CONNECTOR_TYPES.includes(c.type as ConnectorType)) {
    throw new Error(`[${file}] connector.type must be one of: ${VALID_CONNECTOR_TYPES.join(", ")}. Got: ${JSON.stringify(c.type)}`);
  }

  switch (c.type as ConnectorType) {
    case "http":
      return validateHttpConnectorConfig(c, file);
    case "mcp":
      return validateMcpConnectorConfig(c, file);
    case "graphql":
      return validateGraphqlConnectorConfig(c, file);
    case "grpc":
      return validateGrpcConnectorConfig(c, file);
    case "cli":
    case "file":
      return c as unknown as ConnectorConfig;
    case "internal":
      return { type: "internal" } as ConnectorConfig;
    case "sql":
      return validateSqlConnectorConfig(c, file);
    case "mongodb":
      return validateMongoConnectorConfig(c, file);
    default:
      throw new Error(`[${file}] Unknown connector type: ${c.type}`);
  }
}

// ── Connector Summary (for logging) ──────────────────────────────

function connectorSummary(connector: ConnectorConfig): string {
  switch (connector.type) {
    case "http":
      return (connector as HttpConnectorConfig).base_url;
    case "graphql":
      return (connector as { endpoint: string }).endpoint;
    case "grpc":
      return (connector as { endpoint: string }).endpoint;
    case "mcp": {
      const mcp = connector as McpConnectorConfig;
      return mcp.transport === "stdio" ? (mcp.command ?? "stdio") : (mcp.url ?? "sse");
    }
    case "internal":
      return "internal";
    case "sql": {
      const sql = connector as SqlConnectorConfig;
      return `${sql.dialect} → ${sql.database ?? "via DSN"}`;
    }
    case "mongodb": {
      const mongo = connector as MongoConnectorConfig;
      return mongo.database ?? "via DSN";
    }
    default:
      return connector.type;
  }
}

// ── Top-Level Config Validation ───────────────────────────────────

export function validateConfig(raw: unknown, file: string): McpConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`[${file}] Config must be a JSON object`);
  }
  const c = raw as Record<string, unknown>;

  assertString(c.id, "id", file);
  assertString(c.name, "name", file);

  const connector = validateConnectorConfig(c.connector, file);

  // ── -mcp namespace stamp ──────────────────────────────────────────
  let id = c.id as string;
  if (connector.type === "mcp" && !id.endsWith("-mcp")) {
    console.warn(
      `[loader] [${file}] Auto-appending "-mcp" to id "${id}" (MCP configs use the -mcp namespace)`,
    );
    id = `${id}-mcp`;
  }

  const description = typeof c.description === "string" && c.description.length > 0
    ? c.description
    : undefined;

  const overlays = c.overlays !== undefined && typeof c.overlays === "object" && c.overlays !== null && !Array.isArray(c.overlays)
    ? c.overlays as Record<string, { description?: string }>
    : undefined;

  // ── Discoverable connectors: tools are auto-discovered at runtime ──
  const DISCOVERABLE_TYPES: ConnectorType[] = ["mcp", "graphql", "grpc"];
  if (DISCOVERABLE_TYPES.includes(connector.type)) {
    if (c.tools !== undefined) {
      assertArray(c.tools, "tools", file);
      if ((c.tools as unknown[]).length > 0 && connector.type === "mcp") {
        throw new Error(
          `[${file}] MCP connector configs must not declare tools — tools are auto-discovered at runtime`,
        );
      }
    }
    return {
      id,
      name: c.name as string,
      ...(description ? { description } : {}),
      ...(overlays ? { overlays } : {}),
      connector,
      tools: [],
    };
  }

  assertArray(c.tools, "tools", file);
  if ((c.tools as unknown[]).length === 0) {
    throw new Error(`[${file}] "tools" array must not be empty`);
  }
  const tools = (c.tools as unknown[]).map((t) => validateToolForConnector(t, connector.type, file));

  return {
    id,
    name: c.name as string,
    ...(description ? { description } : {}),
    connector,
    tools,
  };
}

// ── Loader ─────────────────────────────────────────────────────────

export function loadConfigs(configDir: string): McpConfig[] {
  if (!fs.existsSync(configDir)) {
    console.warn(`[loader] Config directory not found: ${configDir}`);
    return [];
  }

  const files = fs.readdirSync(configDir)
    .filter((f) => f.startsWith("mcp.") && f.endsWith(".json"))
    .map((f) => path.join(configDir, f));

  if (files.length === 0) {
    log.warn("loader", `No config files found in ${configDir} (expected mcp.*.json)`);
    return [];
  }

  const configs: McpConfig[] = [];
  const seenIds = new Set<string>();

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
      const config = validateConfig(raw, path.basename(file));

      if (seenIds.has(config.id)) {
        throw new Error(`[${path.basename(file)}] Duplicate config id "${config.id}" — already loaded from another file`);
      }
      seenIds.add(config.id);

      configs.push(config);
      log.info("loader", `Loaded: ${config.id} (${config.tools.length} tools) → ${connectorSummary(config.connector)}`);
    } catch (err) {
      log.error("loader", `Failed to load ${file}: ${(err as Error).message}`);
    }
  }

  return configs;
}

// ── Single-File Loader (for hot reload) ────────────────────────────

export function loadSingleConfig(filePath: string): McpConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const config = validateConfig(raw, path.basename(filePath));
    log.info("loader", `Reloaded: ${config.id} (${config.tools.length} tools) → ${connectorSummary(config.connector)}`);
    return config;
  } catch (err) {
    log.error("loader", `Failed to load ${path.basename(filePath)}: ${(err as Error).message}`);
    return null;
  }
}

