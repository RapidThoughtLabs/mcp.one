// ── Auth Config Types ──────────────────────────────────────────────

export interface BearerAuth {
  type: "bearer";
  token_env: string;
  /** Optional URL where the user can obtain/manage this token. Shown during `heku auth setup`. */
  auth_url?: string;
  /** Optional service-specific hint (e.g. required scopes). Shown during `heku auth setup`. */
  description?: string;
}

export interface BasicAuth {
  type: "basic";
  username_env: string;
  token_env: string;
  /** Optional URL where the user can obtain/manage these credentials. Shown during `heku auth setup`. */
  auth_url?: string;
  /** Optional service-specific hint. Shown during `heku auth setup`. */
  description?: string;
}

export interface ApiKeyAuth {
  type: "api_key";
  key_env: string;
  header_name: string;
  /** Optional URL where the user can obtain/manage this API key. Shown during `heku auth setup`. */
  auth_url?: string;
  /** Optional service-specific hint. Shown during `heku auth setup`. */
  description?: string;
}

export interface OAuth2StaticAuth {
  type: "oauth2_static";
  token_env: string;
  /** Optional URL where the user can obtain/manage this token. Shown during `heku auth setup`. */
  auth_url?: string;
  /** Optional service-specific hint. Shown during `heku auth setup`. */
  description?: string;
}

export type AuthConfig = BearerAuth | BasicAuth | ApiKeyAuth | OAuth2StaticAuth;

// ── Connector Types ────────────────────────────────────────────────

export type ConnectorType =
  | "http" | "cli" | "file" | "grpc" | "graphql" | "mcp" | "internal"
  | "sql" | "mongodb";

// ── Per-Connector Config Shapes ────────────────────────────────────

export interface HttpConnectorConfig {
  type: "http";
  base_url: string;
  auth?: AuthConfig;
}

export interface CliConnectorConfig {
  type: "cli";
  shell?: string;          // default: /bin/sh (darwin/linux), cmd.exe (win)
  cwd?: string;            // working directory
  env?: Record<string, string>;
  timeout_ms?: number;     // default: 30_000
}

export interface FileConnectorConfig {
  type: "file";
  base_path?: string;      // jail root for relative paths
}

export interface GrpcTlsMutual {
  ca_cert_path?: string;
  client_cert_path?: string;
  client_key_path?: string;
}

export interface GrpcConnectorConfig {
  type: "grpc";
  endpoint: string;                        // host:port
  proto_path?: string;                     // path to .proto file (mode 1)
  proto_include_dirs?: string[];           // additional include dirs for imports
  reflection?: boolean;                    // use server reflection (mode 2)
  tls?: boolean | GrpcTlsMutual;
  auth?: AuthConfig;                       // resolved to gRPC metadata
  metadata?: Record<string, string>;       // extra static metadata
  service_filter?: string;                 // restrict discovery to one service
  timeout_ms?: number;                     // default: 30_000
}

export interface GraphqlConnectorConfig {
  type: "graphql";
  endpoint: string;
  auth?: AuthConfig;
  introspect?: boolean;            // default: true when tools is empty
  include_mutations?: boolean;     // default: true
  include_queries?: boolean;       // default: true
  headers?: Record<string, string>; // extra static headers
  timeout_ms?: number;             // default: 30_000
}

export interface McpConnectorConfig {
  type: "mcp";
  transport: "stdio" | "sse";
  // stdio fields
  command?: string;        // e.g. "npx"
  args?: string[];         // e.g. ["-y", "@modelcontextprotocol/server-github"]
  env?: Record<string, string>;
  // sse fields
  url?: string;            // e.g. "http://localhost:3001/sse"

  // ── install (stdio only, all optional) ────────────────────────────
  install_command?: string;         // run once before first spawn
  install_args?: string[];          // when present, exec'd directly (no shell) — required for registry configs
  install_cwd?: string;
  install_env?: Record<string, string>;
  install_timeout_ms?: number;      // default 600_000, max 1_800_000
  install_check_command?: string;   // probe: exit 0 = already installed, skip install_command

  // lifecycle
  /** When false, the pipeline does not auto-install or auto-start.
   *  Default: true. Persists to the config file so it survives restarts. */
  active?: boolean;
}

export interface InternalConnectorConfig {
  type: "internal";
}

// ── SQL connector ─────────────────────────────────────────────────

export type SqlDialect = "postgres" | "mysql" | "sqlite";

export interface SqlPoolConfig {
  max?: number;
  idle_ms?: number;
  connection_timeout_ms?: number;
}

export interface SqlConnectorConfig {
  type: "sql";
  dialect: SqlDialect;
  connection_string_env?: string;
  host?: string;
  port?: number;
  database?: string;
  ssl?: boolean | { rejectUnauthorized?: boolean; ca_path?: string };
  auth?: BasicAuth;
  pool?: SqlPoolConfig;
  default_timeout_ms?: number;
  default_max_rows?: number;
}

// ── MongoDB connector ────────────────────────────────────────────

export interface MongoConnectorConfig {
  type: "mongodb";
  connection_string_env?: string;
  host?: string;
  port?: number;
  database?: string;
  ssl?: boolean;
  auth?: BasicAuth;
  default_timeout_ms?: number;
  default_max_rows?: number;
}

export type ConnectorConfig =
  | HttpConnectorConfig
  | CliConnectorConfig
  | FileConnectorConfig
  | GrpcConnectorConfig
  | GraphqlConnectorConfig
  | McpConnectorConfig
  | InternalConnectorConfig
  | SqlConnectorConfig
  | MongoConnectorConfig;

// ── Param & Tool Definitions ───────────────────────────────────────

export interface ParamDef {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  default?: unknown;
  location?: "body" | "path" | "query" | "header"; // required for HTTP, optional for others
  description: string;

  // nested shape — only meaningful when type === "object" or "array"
  properties?: Record<string, ParamDef>; // when type === "object"
  items?: ParamDef;                       // when type === "array"
  enum?: unknown[];
  format?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  params: ParamDef[];

  // ── HTTP-specific ──────────────────────────────────────────────
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path?: string;
  base_url?: string;       // overrides connector.base_url for this tool (microservices)
  body_template?: Record<string, unknown>;
  response_map?: Record<string, string>;
  error_map?: Record<string, string>;

  // ── CLI-specific ───────────────────────────────────────────────
  command?: string;           // e.g. "npm test -- {{pattern}}"
  args_template?: string[];   // preferred over command for safety
  stdin_template?: string;
  output_as?: "text" | "json";

  // ── File-specific ──────────────────────────────────────────────
  operation?:
    | "read" | "write" | "append" | "delete" | "list"             // file
    | "find" | "findOne" | "aggregate"                             // mongodb
    | "insertOne" | "insertMany"
    | "updateOne" | "updateMany"
    | "deleteOne" | "deleteMany"
    | "countDocuments" | "distinct";
  path_template?: string;     // supports {{param}} interpolation
  content_template?: string;

  // ── gRPC-specific ──────────────────────────────────────────────
  service?: string;           // e.g. "mypackage.MyService"
  rpc_method?: string;

  // ── GraphQL-specific ───────────────────────────────────────────
  query?: string;             // GraphQL query/mutation string
  variables_template?: Record<string, unknown>;

  // ── validation ─────────────────────────────────────────────────
  validate_input?: boolean; // default true; set false to skip pre-flight validation

  // ── MCP — no per-tool fields (tools are auto-discovered) ───────

  // ── SQL-specific ────────────────────────────────────────────────
  sql?: string;               // static SQL with :name placeholders; no {{...}} allowed
  max_rows?: number;
  timeout_ms?: number;

  // ── MongoDB-specific ────────────────────────────────────────────
  collection?: string;
  filter_template?: Record<string, unknown>;
  update_template?: Record<string, unknown>;
  document_template?: Record<string, unknown>;
  documents_template?: Array<Record<string, unknown>>;
  pipeline_template?: Array<Record<string, unknown>>;
  projection?: Record<string, 0 | 1>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
}

// ── Overlay (user-editable semantic layer seeded from auto-discovered tools) ──

export interface ToolOverlay {
  description?: string;
  params?: ParamDef[];
}

// ── Top-Level Config ───────────────────────────────────────────────

export interface McpConfig {
  id: string;
  name: string;
  description?: string;       // shown to LLM for namespace discovery
  api_version?: string;       // informational: upstream API version this config targets (e.g. "v3", "2024-01-01")
  connector: ConnectorConfig;  // one connector per config
  tools: ToolDef[];            // MCP: upstream snapshot refreshed on connect; others: static definitions
  overlays?: Record<string, ToolOverlay>; // curated semantic layer; what LLM and registry see
}

// ── Internal: Registered tool with its parent config context ───────

export interface RegisteredTool {
  configId: string;
  configName?: string;
  configDescription?: string;
  connectorConfig: ConnectorConfig; // data, not an instance
  tool: ToolDef;
}

// ── Caller Context — who made a tool call ──────────────────────────

export interface CallerContext {
  /** Server-generated UUID for every tool call — always present */
  requestId: string;
  /** How the client connected */
  transport: "stdio" | "http";
  /** Client-supplied agent identifier (X-Agent-Id header or _meta.agentId) */
  agentId?: string;
  /** Client-supplied conversation/chat ID (X-Chat-Id header or _meta.chatId) */
  chatId?: string;
  /** Client-supplied session ID (X-Session-Id header or _meta.sessionId) */
  sessionId?: string;
  /** Client-supplied label: "dashboard", "claude-code", "my-swarm", etc. */
  source?: string;
  /** Remote IP address (HTTP only) */
  ip?: string;
}
