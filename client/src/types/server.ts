// ── Types mirroring server/config-io.ts and server/mcp-client.ts ──
// These are the shapes returned by the Express API.

export interface AuthStatus {
  type: string
  ok: boolean
  missingVars: string[]
}

export interface ConnectorSummary {
  type: string
  base_url?: string
  endpoint?: string
  transport?: string
  // SQL specific
  dialect?: string
  host?: string
  port?: number
  database?: string
  connection_string_env?: string
}

export interface ConfigSummary {
  id: string
  name: string
  description?: string
  connector: ConnectorSummary
  toolCount: number
  auth?: AuthStatus
  raw: Record<string, unknown>
}

export interface McpTool {
  name: string        // e.g. "github.list_repos"
  description: string
  inputSchema: Record<string, unknown>
  configId: string    // e.g. "github"
}

export interface RegistryOrigin {
  slug: string
  version: string
  registry: string
  installed_at: string
  registryUrl: string | null
}

export interface ConfigDetail {
  config: ConfigSummary
  tools: McpTool[]
  registry: RegistryOrigin | null
}

export interface HealthResponse {
  status: 'ok'
  mcpStatus: 'connecting' | 'connected' | 'disconnected'
  mcpConnected: boolean
  toolCount: number
  endpoint: string | null
  ts: number
}

export interface ConnectResponse {
  ok: boolean
  endpoint: string
}

export interface LogEntry {
  id: number
  ts: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: 'mcp' | 'api' | 'config'
  msg: string
}

export interface ValidationError {
  field: string
  message: string
}

export interface ApiError {
  error: string
  code?: string
  message?: string
  errors?: ValidationError[]
}
