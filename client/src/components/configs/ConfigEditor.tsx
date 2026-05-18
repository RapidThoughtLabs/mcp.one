import { useState, useCallback, useMemo } from 'react'
import {
  X, Save, Trash2, RotateCcw, Loader2, AlertTriangle, Info,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { AuthFormSection, type AuthFields, DEFAULT_AUTH_FIELDS } from './AuthFormSection'
import { ToolBuilder, type ToolRow } from './ToolBuilder'
import { JsonPreview } from './JsonPreview'
import { DiffPopup } from './DiffPopup'
import type { ParamRow } from './ParamBuilder'
import { toast } from '@/components/ui/Toast'
import { ApiRequestError } from '@/lib/api'
import type { ConfigSummary } from '@/types/server'

// ── State shape (mirrors ConfigDesigner's) ──────────────────────────

type ConnectorType = 'http' | 'cli' | 'file' | 'grpc' | 'graphql' | 'mcp' | 'sql'

interface EditorState {
  name: string
  description: string
  connectorType: ConnectorType
  httpBaseUrl: string
  cliShell: string
  cliCwd: string
  cliTimeoutMs: string
  fileBasePath: string
  grpcEndpoint: string
  grpcProtoPath: string
  grpcTls: boolean
  graphqlEndpoint: string
  mcpTransport: 'stdio' | 'sse'
  mcpCommand: string
  mcpArgs: string
  mcpUrl: string
  sqlDialect: 'postgres' | 'mysql' | 'sqlite'
  sqlConnMode: 'dsn' | 'fields'
  sqlConnectionStringEnv: string
  sqlHost: string
  sqlPort: string
  sqlDatabase: string
  sqlSsl: boolean
  sqlPoolMax: string
  sqlIdleMs: string
  sqlConnectionTimeoutMs: string
  sqlDefaultTimeoutMs: string
  sqlDefaultMaxRows: string
  auth: AuthFields
  tools: ToolRow[]
}

// ── Raw config parser ───────────────────────────────────────────────

function parseAuthFields(auth: Record<string, unknown> | undefined): AuthFields {
  if (!auth || typeof auth !== 'object') return { ...DEFAULT_AUTH_FIELDS }
  const type = auth.type as string

  if (type === 'bearer') {
    return {
      ...DEFAULT_AUTH_FIELDS,
      authType: 'bearer',
      bearerTokenEnv: (auth.token_env as string) || '',
      bearerAuthUrl: (auth.auth_url as string) || '',
    }
  }
  if (type === 'basic') {
    return {
      ...DEFAULT_AUTH_FIELDS,
      authType: 'basic',
      basicUsernameEnv: (auth.username_env as string) || '',
      basicTokenEnv: (auth.token_env as string) || '',
    }
  }
  if (type === 'api_key') {
    return {
      ...DEFAULT_AUTH_FIELDS,
      authType: 'api_key',
      apiKeyEnv: (auth.key_env as string) || '',
      apiKeyHeader: (auth.header_name as string) || 'X-API-Key',
    }
  }
  if (type === 'oauth2_static') {
    return {
      ...DEFAULT_AUTH_FIELDS,
      authType: 'oauth2_static',
      oauth2TokenEnv: (auth.token_env as string) || '',
    }
  }
  return { ...DEFAULT_AUTH_FIELDS }
}

function parseToolRow(t: Record<string, unknown>): ToolRow {
  const rawParams = Array.isArray(t.params) ? t.params as Record<string, unknown>[] : []
  const params: ParamRow[] = rawParams.map((p) => ({
    id: Math.random().toString(36).slice(2),
    name: (p.name as string) || '',
    type: (p.type as ParamRow['type']) || 'string',
    required: Boolean(p.required),
    location: (p.location as ParamRow['location']) || '',
    description: (p.description as string) || '',
  }))

  return {
    id: Math.random().toString(36).slice(2),
    name: (t.name as string) || '',
    description: (t.description as string) || '',
    method: (t.method as ToolRow['method']) || 'GET',
    path: (t.path as string) || '',
    command: (t.command as string) || '',
    output_as: (t.output_as as 'text' | 'json') || 'json',
    operation: (t.operation as ToolRow['operation']) || 'read',
    path_template: (t.path_template as string) || '',
    service: (t.service as string) || '',
    rpc_method: (t.rpc_method as string) || '',
    query: (t.query as string) || '',
    sql: (t.sql as string) || '',
    maxRowsStr: t.max_rows != null ? String(t.max_rows) : '',
    timeoutMsStr: t.timeout_ms != null ? String(t.timeout_ms) : '',
    params,
  }
}

function parseRawConfig(raw: Record<string, unknown>): EditorState {
  const connector = (raw.connector ?? {}) as Record<string, unknown>
  const connectorType = (connector.type as ConnectorType) || 'http'
  const auth = connector.auth as Record<string, unknown> | undefined

  const tools: ToolRow[] = Array.isArray(raw.tools)
    ? (raw.tools as Record<string, unknown>[]).map(parseToolRow)
    : []

  const sqlPool = (connector.pool as Record<string, unknown> | undefined) ?? {}
  return {
    name: (raw.name as string) || '',
    description: (raw.description as string) || '',
    connectorType,
    httpBaseUrl: (connector.base_url as string) || '',
    cliShell: (connector.shell as string) || '',
    cliCwd: (connector.cwd as string) || '',
    cliTimeoutMs: connector.timeout_ms != null ? String(connector.timeout_ms) : '',
    fileBasePath: (connector.base_path as string) || '',
    grpcEndpoint: (connector.endpoint as string) || '',
    grpcProtoPath: (connector.proto_path as string) || '',
    grpcTls: Boolean(connector.tls),
    graphqlEndpoint: (connector.endpoint as string) || '',
    mcpTransport: (connector.transport as 'stdio' | 'sse') || 'stdio',
    mcpCommand: (connector.command as string) || '',
    mcpArgs: Array.isArray(connector.args) ? (connector.args as string[]).join(' ') : '',
    mcpUrl: (connector.url as string) || '',
    sqlDialect: (connector.dialect as 'postgres' | 'mysql' | 'sqlite') ?? 'postgres',
    sqlConnMode: connector.connection_string_env ? 'dsn' : 'fields',
    sqlConnectionStringEnv: (connector.connection_string_env as string) || '',
    sqlHost: (connector.host as string) || '',
    sqlPort: connector.port != null ? String(connector.port) : '',
    sqlDatabase: (connector.database as string) || '',
    sqlSsl: Boolean(connector.ssl),
    sqlPoolMax: sqlPool.max != null ? String(sqlPool.max) : '',
    sqlIdleMs: sqlPool.idle_ms != null ? String(sqlPool.idle_ms) : '',
    sqlConnectionTimeoutMs: sqlPool.connection_timeout_ms != null ? String(sqlPool.connection_timeout_ms) : '',
    sqlDefaultTimeoutMs: connector.default_timeout_ms != null ? String(connector.default_timeout_ms) : '',
    sqlDefaultMaxRows: connector.default_max_rows != null ? String(connector.default_max_rows) : '',
    auth: parseAuthFields(auth),
    tools,
  }
}

// ── Config builder (matches ConfigDesigner's) ──────────────────────

function buildAuth(a: AuthFields): Record<string, unknown> {
  switch (a.authType) {
    case 'bearer': {
      const auth: Record<string, unknown> = { type: 'bearer', token_env: a.bearerTokenEnv }
      if (a.bearerAuthUrl) auth.auth_url = a.bearerAuthUrl
      return auth
    }
    case 'basic':
      return { type: 'basic', username_env: a.basicUsernameEnv, token_env: a.basicTokenEnv }
    case 'api_key':
      return { type: 'api_key', key_env: a.apiKeyEnv, header_name: a.apiKeyHeader || 'X-API-Key' }
    case 'oauth2_static':
      return { type: 'oauth2_static', token_env: a.oauth2TokenEnv }
    default:
      return {}
  }
}

function buildConnector(s: EditorState): Record<string, unknown> {
  switch (s.connectorType) {
    case 'http': {
      const conn: Record<string, unknown> = { type: 'http', base_url: s.httpBaseUrl }
      if (s.auth.authType !== 'none') conn.auth = buildAuth(s.auth)
      return conn
    }
    case 'graphql': {
      const conn: Record<string, unknown> = { type: 'graphql', endpoint: s.graphqlEndpoint }
      if (s.auth.authType !== 'none') conn.auth = buildAuth(s.auth)
      return conn
    }
    case 'cli': {
      const conn: Record<string, unknown> = { type: 'cli' }
      if (s.cliShell) conn.shell = s.cliShell
      if (s.cliCwd) conn.cwd = s.cliCwd
      if (s.cliTimeoutMs) conn.timeout_ms = parseInt(s.cliTimeoutMs, 10)
      return conn
    }
    case 'file': {
      const conn: Record<string, unknown> = { type: 'file' }
      if (s.fileBasePath) conn.base_path = s.fileBasePath
      return conn
    }
    case 'grpc': {
      const conn: Record<string, unknown> = { type: 'grpc', endpoint: s.grpcEndpoint, proto_path: s.grpcProtoPath }
      if (s.grpcTls) conn.tls = true
      return conn
    }
    case 'mcp': {
      const conn: Record<string, unknown> = { type: 'mcp', transport: s.mcpTransport }
      if (s.mcpTransport === 'stdio') {
        conn.command = s.mcpCommand
        if (s.mcpArgs.trim()) conn.args = s.mcpArgs.trim().split(/\s+/)
      } else {
        conn.url = s.mcpUrl
      }
      return conn
    }
    case 'sql': {
      const conn: Record<string, unknown> = { type: 'sql', dialect: s.sqlDialect }
      if (s.sqlDialect === 'sqlite') {
        conn.database = s.sqlDatabase
      } else if (s.sqlConnMode === 'dsn') {
        conn.connection_string_env = s.sqlConnectionStringEnv
      } else {
        conn.host = s.sqlHost
        conn.port = parseInt(s.sqlPort, 10) || undefined
        conn.database = s.sqlDatabase
        if (s.auth.authType === 'basic') conn.auth = buildAuth(s.auth)
      }
      if (s.sqlSsl && s.sqlDialect !== 'sqlite') conn.ssl = true
      const pool: Record<string, unknown> = {}
      if (s.sqlPoolMax) pool.max = parseInt(s.sqlPoolMax, 10)
      if (s.sqlIdleMs) pool.idle_ms = parseInt(s.sqlIdleMs, 10)
      if (s.sqlConnectionTimeoutMs) pool.connection_timeout_ms = parseInt(s.sqlConnectionTimeoutMs, 10)
      if (Object.keys(pool).length > 0) conn.pool = pool
      if (s.sqlDefaultTimeoutMs) conn.default_timeout_ms = parseInt(s.sqlDefaultTimeoutMs, 10)
      if (s.sqlDefaultMaxRows) conn.default_max_rows = parseInt(s.sqlDefaultMaxRows, 10)
      return conn
    }
  }
}

function buildTool(t: ToolRow): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    name: t.name,
    description: t.description,
    params: t.params.filter((p) => p.name).map((p) => {
      const param: Record<string, unknown> = {
        name: p.name, type: p.type, required: p.required, description: p.description,
      }
      if (p.location) param.location = p.location
      return param
    }),
  }
  if (t.method) tool.method = t.method
  if (t.path) tool.path = t.path
  if (t.command) tool.command = t.command
  if (t.output_as && t.output_as !== 'json') tool.output_as = t.output_as
  if (t.operation) tool.operation = t.operation
  if (t.path_template) tool.path_template = t.path_template
  if (t.service) tool.service = t.service
  if (t.rpc_method) tool.rpc_method = t.rpc_method
  if (t.query) tool.query = t.query
  if (t.sql) tool.sql = t.sql
  if (t.maxRowsStr) tool.max_rows = parseInt(t.maxRowsStr, 10)
  if (t.timeoutMsStr) tool.timeout_ms = parseInt(t.timeoutMsStr, 10)
  return tool
}

function buildConfig(id: string, s: EditorState): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    id,
    name: s.name,
    connector: buildConnector(s),
    tools: s.connectorType === 'mcp' ? [] : s.tools.filter((t) => t.name).map(buildTool),
  }
  if (s.description) cfg.description = s.description
  return cfg
}

// ── Shared form helpers ────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.07em',
}

function inputCss(dirty = false, hasError = false): React.CSSProperties {
  return {
    background: 'var(--surface2)',
    border: `1px solid ${hasError ? 'rgba(255,95,87,0.5)' : dirty ? 'var(--accent)' : 'var(--border2)'}`,
    borderLeft: dirty ? '3px solid var(--accent)' : undefined,
    borderRadius: 5,
    padding: '7px 10px',
    fontSize: 11,
    color: 'var(--text)',
    fontFamily: 'inherit',
    letterSpacing: '0.02em',
    outline: 'none',
    width: '100%',
    transition: 'border-color 0.15s',
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-dim)',
        borderBottom: '1px solid var(--border)', paddingBottom: 7,
        textTransform: 'uppercase',
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function FieldGroup({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 9, color: 'var(--text-dim)', opacity: 0.7, lineHeight: 1.4 }}>{hint}</span>}
    </div>
  )
}

// ── ConfigEditor ───────────────────────────────────────────────────

interface ConfigEditorProps {
  config: ConfigSummary
  updateConfig: (id: string, data: unknown) => Promise<void>
  deleteConfig: (id: string) => Promise<void>
  onClose: () => void
}

export function ConfigEditor({ config, updateConfig, deleteConfig, onClose }: ConfigEditorProps) {
  const initial = useMemo(() => parseRawConfig(config.raw), [config.raw])
  const [state, setState] = useState<EditorState>(initial)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showUnsavedGuard, setShowUnsavedGuard] = useState(false)
  const [pendingClose, setPendingClose] = useState(false)

  const set = useCallback((partial: Partial<EditorState>) => setState((s) => ({ ...s, ...partial })), [])

  // Dirty check — compare serialized JSON
  const initialJson = useMemo(() => buildConfig(config.id, initial), [config.id, initial])
  const currentJson = useMemo(() => buildConfig(config.id, state), [config.id, state])
  const isDirty = JSON.stringify(initialJson) !== JSON.stringify(currentJson)

  const handleClose = () => {
    if (isDirty) {
      setShowUnsavedGuard(true)
      setPendingClose(true)
    } else {
      onClose()
    }
  }

  const handleSaveConfirm = async () => {
    setSaving(true)
    try {
      await updateConfig(config.id, currentJson)
      toast.success(`Config "${state.name}" updated`)
      setShowDiff(false)
      onClose()
    } catch (err) {
      if (err instanceof ApiRequestError) {
        toast.error(err.data.error || 'Failed to update config')
      } else {
        toast.error((err as Error).message ?? 'Failed to update config')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteConfig(config.id)
      toast.success(`Config "${config.name}" deleted`)
      setShowDeleteConfirm(false)
      onClose()
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to delete config')
    } finally {
      setDeleting(false)
    }
  }

  const ct = state.connectorType
  const sqlNeedsAuth = ct === 'sql' && state.sqlDialect !== 'sqlite' && state.sqlConnMode === 'fields'
  const hasAuth = ct === 'http' || ct === 'graphql' || sqlNeedsAuth
  const hasTools = ct !== 'mcp'

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Topbar */}
      <div style={{
        height: 42, background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 16px', flexShrink: 0, gap: 10,
      }}>
        <span style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)' }}>
          <span style={{ color: 'var(--accent)' }}>configs</span> / {config.id}
        </span>
        {isDirty && (
          <span style={{
            fontSize: 8, padding: '2px 7px', borderRadius: 99,
            background: 'rgba(254,188,46,0.12)', color: 'var(--yellow)',
            border: '1px solid rgba(254,188,46,0.3)', letterSpacing: '0.07em',
          }}>
            UNSAVED
          </span>
        )}
        <div style={{ flex: 1 }} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setState(initial)}
          disabled={!isDirty}
          title="Reset to saved state"
        >
          <RotateCcw size={10} style={{ marginRight: 4 }} />
          Reset
        </Button>
        <Button
          variant="cancel"
          size="sm"
          onClick={() => setShowDeleteConfirm(true)}
          title="Delete this config"
        >
          <Trash2 size={10} style={{ marginRight: 4 }} />
          Delete
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowDiff(true)}
          disabled={!isDirty || saving}
        >
          <Save size={10} style={{ marginRight: 4 }} />
          Save changes
        </Button>
        <Button variant="icon" size="xs" onClick={handleClose} aria-label="Close editor">
          <X size={12} />
        </Button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 48px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* ── Service Basics ── */}
        <Section title="Service Basics">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
            <FieldGroup label="SERVICE NAME">
              <input
                style={inputCss(state.name !== initial.name)}
                value={state.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="GitHub API"
              />
            </FieldGroup>
            <FieldGroup label="CONFIG ID">
              <div style={{
                display: 'flex', alignItems: 'center', height: 33,
                padding: '0 12px', background: 'var(--surface3)',
                border: '1px solid var(--border)', borderRadius: 5,
                fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
              }}>
                {config.id}
              </div>
            </FieldGroup>
          </div>
          <FieldGroup label="DESCRIPTION">
            <textarea
              style={{ ...inputCss(state.description !== initial.description), resize: 'vertical', minHeight: 55, lineHeight: 1.6 }}
              value={state.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="Short description shown to the LLM…"
            />
          </FieldGroup>
        </Section>

        {/* ── Connector ── */}
        <Section title={`Connector — ${ct.toUpperCase()}`}>
          {ct === 'http' && (
            <FieldGroup label="BASE URL">
              <input style={inputCss(state.httpBaseUrl !== initial.httpBaseUrl)} value={state.httpBaseUrl} onChange={(e) => set({ httpBaseUrl: e.target.value })} placeholder="https://api.example.com" />
            </FieldGroup>
          )}
          {ct === 'graphql' && (
            <FieldGroup label="ENDPOINT">
              <input style={inputCss(state.graphqlEndpoint !== initial.graphqlEndpoint)} value={state.graphqlEndpoint} onChange={(e) => set({ graphqlEndpoint: e.target.value })} placeholder="https://api.example.com/graphql" />
            </FieldGroup>
          )}
          {ct === 'cli' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <FieldGroup label="SHELL">
                  <input style={inputCss(state.cliShell !== initial.cliShell)} value={state.cliShell} onChange={(e) => set({ cliShell: e.target.value })} placeholder="/bin/sh" />
                </FieldGroup>
                <FieldGroup label="WORKING DIRECTORY">
                  <input style={inputCss(state.cliCwd !== initial.cliCwd)} value={state.cliCwd} onChange={(e) => set({ cliCwd: e.target.value })} placeholder="/path/to/project" />
                </FieldGroup>
              </div>
              <FieldGroup label="TIMEOUT (ms)">
                <input type="number" style={inputCss(state.cliTimeoutMs !== initial.cliTimeoutMs)} value={state.cliTimeoutMs} onChange={(e) => set({ cliTimeoutMs: e.target.value })} placeholder="30000" />
              </FieldGroup>
            </div>
          )}
          {ct === 'file' && (
            <FieldGroup label="BASE PATH">
              <input style={inputCss(state.fileBasePath !== initial.fileBasePath)} value={state.fileBasePath} onChange={(e) => set({ fileBasePath: e.target.value })} placeholder="/home/user/documents" />
            </FieldGroup>
          )}
          {ct === 'grpc' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <FieldGroup label="ENDPOINT">
                  <input style={inputCss(state.grpcEndpoint !== initial.grpcEndpoint)} value={state.grpcEndpoint} onChange={(e) => set({ grpcEndpoint: e.target.value })} placeholder="api.example.com:443" />
                </FieldGroup>
                <FieldGroup label="PROTO PATH">
                  <input style={inputCss(state.grpcProtoPath !== initial.grpcProtoPath)} value={state.grpcProtoPath} onChange={(e) => set({ grpcProtoPath: e.target.value })} placeholder="./protos/service.proto" />
                </FieldGroup>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={state.grpcTls} onChange={(e) => set({ grpcTls: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: 11, color: state.grpcTls !== initial.grpcTls ? 'var(--accent)' : 'var(--text)' }}>Enable TLS</span>
              </label>
            </div>
          )}
          {ct === 'mcp' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FieldGroup label="TRANSPORT">
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['stdio', 'sse'] as const).map((t) => (
                    <label key={t} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                      borderRadius: 5, cursor: 'pointer',
                      background: state.mcpTransport === t ? 'var(--accent-dim)' : 'var(--surface2)',
                      border: `1px solid ${state.mcpTransport === t ? 'var(--accent)' : 'var(--border)'}`,
                    }}>
                      <input type="radio" name="mcpTransport" value={t} checked={state.mcpTransport === t} onChange={() => set({ mcpTransport: t })} style={{ accentColor: 'var(--accent)' }} />
                      <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>{t}</span>
                    </label>
                  ))}
                </div>
              </FieldGroup>
              {state.mcpTransport === 'stdio' ? (
                <>
                  <FieldGroup label="COMMAND">
                    <input style={inputCss(state.mcpCommand !== initial.mcpCommand)} value={state.mcpCommand} onChange={(e) => set({ mcpCommand: e.target.value })} placeholder="npx" />
                  </FieldGroup>
                  <FieldGroup label="ARGS" hint="Space-separated">
                    <input style={inputCss(state.mcpArgs !== initial.mcpArgs)} value={state.mcpArgs} onChange={(e) => set({ mcpArgs: e.target.value })} placeholder="-y @modelcontextprotocol/server-github" />
                  </FieldGroup>
                </>
              ) : (
                <FieldGroup label="URL">
                  <input style={inputCss(state.mcpUrl !== initial.mcpUrl)} value={state.mcpUrl} onChange={(e) => set({ mcpUrl: e.target.value })} placeholder="http://localhost:3001/sse" />
                </FieldGroup>
              )}
            </div>
          )}
          {ct === 'sql' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FieldGroup label="DIALECT">
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['postgres', 'mysql', 'sqlite'] as const).map((d) => (
                    <label key={d} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                      borderRadius: 5, cursor: 'pointer',
                      background: state.sqlDialect === d ? 'var(--accent-dim)' : 'var(--surface2)',
                      border: `1px solid ${state.sqlDialect === d ? 'var(--accent)' : 'var(--border)'}`,
                    }}>
                      <input type="radio" name="sqlDialect" value={d} checked={state.sqlDialect === d}
                        onChange={() => set({ sqlDialect: d, sqlConnMode: 'dsn' })} style={{ accentColor: 'var(--accent)' }} />
                      <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>{d}</span>
                    </label>
                  ))}
                </div>
              </FieldGroup>
              {state.sqlDialect !== 'sqlite' && (
                <FieldGroup label="CONNECTION MODE">
                  <div style={{ display: 'flex', gap: 8 }}>
                    {([['dsn', 'Connection string'], ['fields', 'Host & port']] as const).map(([v, lbl]) => (
                      <label key={v} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                        borderRadius: 5, cursor: 'pointer',
                        background: state.sqlConnMode === v ? 'var(--accent-dim)' : 'var(--surface2)',
                        border: `1px solid ${state.sqlConnMode === v ? 'var(--accent)' : 'var(--border)'}`,
                      }}>
                        <input type="radio" name="sqlConnMode" value={v} checked={state.sqlConnMode === v}
                          onChange={() => set({ sqlConnMode: v })} style={{ accentColor: 'var(--accent)' }} />
                        <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>{lbl}</span>
                      </label>
                    ))}
                  </div>
                </FieldGroup>
              )}
              {state.sqlDialect === 'sqlite' && (
                <FieldGroup label="DATABASE FILE PATH">
                  <input style={inputCss(state.sqlDatabase !== initial.sqlDatabase)} value={state.sqlDatabase}
                    onChange={(e) => set({ sqlDatabase: e.target.value })} placeholder="/path/to/db.sqlite" />
                </FieldGroup>
              )}
              {state.sqlDialect !== 'sqlite' && state.sqlConnMode === 'dsn' && (
                <FieldGroup label="CONNECTION STRING ENV" hint="Name of the env var holding the full DSN">
                  <input style={inputCss(state.sqlConnectionStringEnv !== initial.sqlConnectionStringEnv)}
                    value={state.sqlConnectionStringEnv}
                    onChange={(e) => set({ sqlConnectionStringEnv: e.target.value })} placeholder="DATABASE_URL" />
                </FieldGroup>
              )}
              {state.sqlDialect !== 'sqlite' && state.sqlConnMode === 'fields' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10 }}>
                    <FieldGroup label="HOST">
                      <input style={inputCss(state.sqlHost !== initial.sqlHost)} value={state.sqlHost}
                        onChange={(e) => set({ sqlHost: e.target.value })} placeholder="localhost" />
                    </FieldGroup>
                    <FieldGroup label="PORT">
                      <input type="number" style={inputCss(state.sqlPort !== initial.sqlPort)} value={state.sqlPort}
                        onChange={(e) => set({ sqlPort: e.target.value })}
                        placeholder={state.sqlDialect === 'mysql' ? '3306' : '5432'} />
                    </FieldGroup>
                  </div>
                  <FieldGroup label="DATABASE">
                    <input style={inputCss(state.sqlDatabase !== initial.sqlDatabase)} value={state.sqlDatabase}
                      onChange={(e) => set({ sqlDatabase: e.target.value })} placeholder="myapp" />
                  </FieldGroup>
                </div>
              )}
              {state.sqlDialect !== 'sqlite' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={state.sqlSsl} onChange={(e) => set({ sqlSsl: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
                  <span style={{ fontSize: 11, color: state.sqlSsl !== initial.sqlSsl ? 'var(--accent)' : 'var(--text)' }}>Enable SSL</span>
                </label>
              )}
              <details style={{ border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
                <summary style={{ padding: '7px 12px', cursor: 'pointer', fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.05em', background: 'var(--surface2)', userSelect: 'none' }}>
                  Advanced (pool & timeouts)
                </summary>
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    <FieldGroup label="POOL MAX">
                      <input type="number" style={inputCss(state.sqlPoolMax !== initial.sqlPoolMax)} value={state.sqlPoolMax}
                        onChange={(e) => set({ sqlPoolMax: e.target.value })} placeholder="10" />
                    </FieldGroup>
                    <FieldGroup label="IDLE (ms)">
                      <input type="number" style={inputCss(state.sqlIdleMs !== initial.sqlIdleMs)} value={state.sqlIdleMs}
                        onChange={(e) => set({ sqlIdleMs: e.target.value })} placeholder="30000" />
                    </FieldGroup>
                    <FieldGroup label="CONN TIMEOUT (ms)">
                      <input type="number" style={inputCss(state.sqlConnectionTimeoutMs !== initial.sqlConnectionTimeoutMs)} value={state.sqlConnectionTimeoutMs}
                        onChange={(e) => set({ sqlConnectionTimeoutMs: e.target.value })} placeholder="10000" />
                    </FieldGroup>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <FieldGroup label="DEFAULT TIMEOUT (ms)">
                      <input type="number" style={inputCss(state.sqlDefaultTimeoutMs !== initial.sqlDefaultTimeoutMs)} value={state.sqlDefaultTimeoutMs}
                        onChange={(e) => set({ sqlDefaultTimeoutMs: e.target.value })} placeholder="30000" />
                    </FieldGroup>
                    <FieldGroup label="DEFAULT MAX ROWS">
                      <input type="number" style={inputCss(state.sqlDefaultMaxRows !== initial.sqlDefaultMaxRows)} value={state.sqlDefaultMaxRows}
                        onChange={(e) => set({ sqlDefaultMaxRows: e.target.value })} placeholder="1000" />
                    </FieldGroup>
                  </div>
                </div>
              </details>
            </div>
          )}
        </Section>

        {/* ── Auth ── */}
        {(hasAuth || (ct === 'sql' && !sqlNeedsAuth)) && (
          <Section title="Auth Setup">
            {ct === 'sql' && state.sqlDialect === 'sqlite' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }}>
                <Info size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>SQLite uses a local file — no credentials needed.</span>
              </div>
            ) : ct === 'sql' && state.sqlConnMode === 'dsn' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }}>
                <Info size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>Credentials are embedded in the connection string env var.</span>
              </div>
            ) : ct === 'sql' ? (
              <AuthFormSection
                fields={{ ...state.auth, authType: 'basic' }}
                onChange={(auth) => set({ auth })}
                lockedType="basic"
                labels={{ usernameEnv: 'DB USERNAME ENV VAR *', tokenEnv: 'DB PASSWORD ENV VAR *' }}
              />
            ) : (
              <AuthFormSection
                fields={state.auth}
                onChange={(auth) => set({ auth })}
              />
            )}
          </Section>
        )}

        {/* ── Tools ── */}
        {hasTools && (
          <Section title="Tools">
            <ToolBuilder
              tools={state.tools}
              onChange={(tools) => set({ tools })}
              connectorType={ct}
            />
          </Section>
        )}

        {/* ── JSON Preview ── */}
        <Section title="Current JSON">
          <JsonPreview json={currentJson} maxHeight={380} />
        </Section>
      </div>

      {/* DiffPopup */}
      <DiffPopup
        open={showDiff}
        onClose={() => setShowDiff(false)}
        onConfirm={handleSaveConfirm}
        oldJson={initialJson}
        newJson={currentJson}
        confirmLabel="Save changes"
        confirming={saving}
      />

      {/* Delete confirm modal */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="Delete config" width={400}>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertTriangle size={18} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
                Delete <strong>{config.name}</strong>?
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.6 }}>
                This will remove <code style={{ background: 'var(--surface3)', padding: '1px 5px', borderRadius: 3, fontSize: 10 }}>mcp.{config.id}.json</code> from disk and unregister all its tools from the MCP server. This action cannot be undone.
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="cancel" size="sm" onClick={handleDelete} disabled={deleting}>
            {deleting ? <Loader2 size={10} style={{ marginRight: 4, animation: 'spin 1s linear infinite' }} /> : <Trash2 size={10} style={{ marginRight: 4 }} />}
            {deleting ? 'Deleting…' : 'Delete config'}
          </Button>
        </div>
      </Modal>

      {/* Unsaved guard modal */}
      <Modal
        open={showUnsavedGuard}
        onClose={() => { setShowUnsavedGuard(false); setPendingClose(false) }}
        title="Unsaved changes"
        width={400}
      >
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertTriangle size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.7 }}>
              You have unsaved changes. If you leave now they will be lost. Do you want to discard them?
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Button variant="ghost" size="sm" onClick={() => { setShowUnsavedGuard(false); setPendingClose(false) }}>
            Keep editing
          </Button>
          <Button
            variant="cancel"
            size="sm"
            onClick={() => {
              setShowUnsavedGuard(false)
              if (pendingClose) onClose()
            }}
          >
            Discard & leave
          </Button>
        </div>
      </Modal>
    </div>
  )
}
