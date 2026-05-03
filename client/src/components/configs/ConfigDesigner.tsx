import { useState, useCallback } from 'react'
import {
  ArrowLeft, ArrowRight, Check, X, Loader2,
  Globe, Terminal, FileText, Cpu, GitBranch, Plug, Info, Database,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { AuthFormSection, type AuthFields, DEFAULT_AUTH_FIELDS } from './AuthFormSection'
import { ToolBuilder, type ToolRow } from './ToolBuilder'
import { JsonPreview } from './JsonPreview'
import { ApiRequestError } from '@/lib/api'
import { toast } from '@/components/ui/Toast'

// ── Types ─────────────────────────────────────────────────────────

type ConnectorType = 'http' | 'cli' | 'file' | 'grpc' | 'graphql' | 'mcp' | 'sql'

interface DesignerState {
  // Step 1 — Service Basics
  name: string
  id: string
  idEdited: boolean
  description: string
  connectorType: ConnectorType
  // http
  httpBaseUrl: string
  // cli
  cliShell: string
  cliCwd: string
  cliTimeoutMs: string
  // file
  fileBasePath: string
  // grpc
  grpcEndpoint: string
  grpcProtoPath: string
  grpcTls: boolean
  // graphql
  graphqlEndpoint: string
  // mcp
  mcpTransport: 'stdio' | 'sse'
  mcpCommand: string
  mcpArgs: string
  mcpUrl: string
  // sql
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
  // Step 2 — Auth
  auth: AuthFields
  // Step 3 — Tools
  tools: ToolRow[]
}

const INITIAL_STATE: DesignerState = {
  name: '', id: '', idEdited: false, description: '',
  connectorType: 'http',
  httpBaseUrl: '',
  cliShell: '', cliCwd: '', cliTimeoutMs: '',
  fileBasePath: '',
  grpcEndpoint: '', grpcProtoPath: '', grpcTls: false,
  graphqlEndpoint: '',
  mcpTransport: 'stdio', mcpCommand: '', mcpArgs: '', mcpUrl: '',
  sqlDialect: 'postgres', sqlConnMode: 'dsn',
  sqlConnectionStringEnv: '', sqlHost: '', sqlPort: '', sqlDatabase: '', sqlSsl: false,
  sqlPoolMax: '', sqlIdleMs: '', sqlConnectionTimeoutMs: '',
  sqlDefaultTimeoutMs: '', sqlDefaultMaxRows: '',
  auth: { ...DEFAULT_AUTH_FIELDS },
  tools: [],
}

// ── Config builder ─────────────────────────────────────────────────

function buildConnector(s: DesignerState): Record<string, unknown> {
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
      const conn: Record<string, unknown> = {
        type: 'grpc', endpoint: s.grpcEndpoint, proto_path: s.grpcProtoPath,
      }
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

function buildTool(t: ToolRow): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    name: t.name,
    description: t.description,
    params: t.params
      .filter((p) => p.name)
      .map((p) => {
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

function buildConfig(s: DesignerState): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    id: s.id,
    name: s.name,
    connector: buildConnector(s),
    tools: s.connectorType === 'mcp' ? [] : s.tools.filter((t) => t.name).map(buildTool),
  }
  if (s.description) cfg.description = s.description
  return cfg
}

// ── Validation ─────────────────────────────────────────────────────

type Errors = Record<string, string>

function validateStep1(s: DesignerState): Errors {
  const errs: Errors = {}
  if (!s.name.trim()) errs.name = 'Name is required'
  if (!s.id.trim()) errs.id = 'ID is required'
  else if (!/^[a-z0-9-]+$/.test(s.id)) errs.id = 'Only lowercase letters, numbers, and hyphens'

  if (s.connectorType === 'http' && !s.httpBaseUrl.trim())
    errs.httpBaseUrl = 'Base URL is required'
  if (s.connectorType === 'graphql' && !s.graphqlEndpoint.trim())
    errs.graphqlEndpoint = 'Endpoint URL is required'
  if (s.connectorType === 'grpc') {
    if (!s.grpcEndpoint.trim()) errs.grpcEndpoint = 'Endpoint is required'
    if (!s.grpcProtoPath.trim()) errs.grpcProtoPath = 'Proto path is required'
  }
  if (s.connectorType === 'mcp' && s.mcpTransport === 'stdio' && !s.mcpCommand.trim())
    errs.mcpCommand = 'Command is required'
  if (s.connectorType === 'mcp' && s.mcpTransport === 'sse' && !s.mcpUrl.trim())
    errs.mcpUrl = 'URL is required'
  if (s.connectorType === 'sql') {
    if (s.sqlDialect === 'sqlite') {
      if (!s.sqlDatabase.trim()) errs.sqlDatabase = 'Database file path is required'
    } else if (s.sqlConnMode === 'dsn') {
      if (!s.sqlConnectionStringEnv.trim()) errs.sqlConnectionStringEnv = 'Connection string env var is required'
    } else {
      if (!s.sqlHost.trim()) errs.sqlHost = 'Host is required'
      if (!s.sqlPort.trim()) errs.sqlPort = 'Port is required'
      if (!s.sqlDatabase.trim()) errs.sqlDatabase = 'Database is required'
    }
  }

  return errs
}

function validateStep2(s: DesignerState): Errors {
  const errs: Errors = {}
  const a = s.auth
  if (a.authType === 'bearer' && !a.bearerTokenEnv.trim())
    errs['auth.token_env'] = 'Token env var is required'
  if (a.authType === 'basic') {
    if (!a.basicUsernameEnv.trim()) errs['auth.username_env'] = 'Username env var is required'
    if (!a.basicTokenEnv.trim()) errs['auth.token_env'] = 'Password env var is required'
  }
  if (a.authType === 'api_key' && !a.apiKeyEnv.trim())
    errs['auth.key_env'] = 'API key env var is required'
  if (a.authType === 'oauth2_static' && !a.oauth2TokenEnv.trim())
    errs['auth.token_env'] = 'Token env var is required'
  return errs
}

// ── Connector type selector ────────────────────────────────────────

const CONNECTOR_TYPES: { value: ConnectorType; label: string; desc: string; Icon: React.FC<{ size?: number; style?: React.CSSProperties }> }[] = [
  { value: 'http',    label: 'HTTP',    desc: 'REST API over HTTP/S',       Icon: Globe },
  { value: 'cli',     label: 'CLI',     desc: 'Shell commands',             Icon: Terminal },
  { value: 'file',    label: 'File',    desc: 'Local filesystem access',    Icon: FileText },
  { value: 'grpc',    label: 'gRPC',    desc: 'gRPC service via .proto',    Icon: Cpu },
  { value: 'graphql', label: 'GraphQL', desc: 'GraphQL endpoint',           Icon: GitBranch },
  { value: 'sql',     label: 'SQL',     desc: 'PostgreSQL / MySQL / SQLite', Icon: Database },
  { value: 'mcp',     label: 'MCP',     desc: 'MCP server (auto-discover)', Icon: Plug },
]

// ── Step definitions ───────────────────────────────────────────────

const STEP_LABELS = ['Service Basics', 'Auth Setup', 'Tool Builder', 'Review & Save']

function stepApplies(step: number, connectorType: ConnectorType): boolean {
  if (step === 0 || step === 3) return true
  if (step === 1) return connectorType === 'http' || connectorType === 'graphql' || connectorType === 'sql'
  if (step === 2) return connectorType !== 'mcp'
  return true
}

function nextStep(current: number, connectorType: ConnectorType): number {
  for (let i = current + 1; i < 4; i++) {
    if (stepApplies(i, connectorType)) return i
  }
  return current
}

function prevStep(current: number, connectorType: ConnectorType): number {
  for (let i = current - 1; i >= 0; i--) {
    if (stepApplies(i, connectorType)) return i
  }
  return current
}

// ── Shared form field helpers ──────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.07em',
}

function inputCss(hasError?: boolean): React.CSSProperties {
  return {
    background: 'var(--surface2)',
    border: `1px solid ${hasError ? 'rgba(255,95,87,0.5)' : 'var(--border2)'}`,
    borderRadius: 5,
    padding: '7px 10px',
    fontSize: 11,
    color: 'var(--text)',
    fontFamily: 'inherit',
    letterSpacing: '0.02em',
    outline: 'none',
    width: '100%',
    transition: 'border-color 0.12s',
  }
}

function FieldGroup({ label, error, hint, children }: {
  label: string; error?: string; hint?: string; children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && !error && <span style={{ fontSize: 9, color: 'var(--text-dim)', opacity: 0.7, lineHeight: 1.4 }}>{hint}</span>}
      {error && <span style={{ fontSize: 9, color: 'var(--red)', letterSpacing: '0.03em' }}>{error}</span>}
    </div>
  )
}

// ── Slugify helper ─────────────────────────────────────────────────

function slugify(str: string): string {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

// ── Step components ────────────────────────────────────────────────

function Step1({ state, set, errors }: { state: DesignerState; set: (p: Partial<DesignerState>) => void; errors: Errors }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Name + ID */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FieldGroup label="SERVICE NAME *" error={errors.name}>
          <input
            style={inputCss(!!errors.name)}
            value={state.name}
            onChange={(e) => {
              const name = e.target.value
              set({ name, ...(!state.idEdited ? { id: slugify(name) } : {}) })
            }}
            placeholder="e.g. Weather API"
          />
        </FieldGroup>
        <FieldGroup label="CONFIG ID *" error={errors.id} hint="Unique lowercase slug — auto-generated from name">
          <input
            style={inputCss(!!errors.id)}
            value={state.id}
            onChange={(e) => set({ id: e.target.value, idEdited: true })}
            placeholder="e.g. weather-api"
          />
        </FieldGroup>
      </div>

      <FieldGroup label="DESCRIPTION">
        <textarea
          style={{ ...inputCss(), resize: 'vertical', minHeight: 60, lineHeight: 1.6 }}
          value={state.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="e.g. Fetches weather forecasts and current conditions by city"
        />
      </FieldGroup>

      {/* Connector type */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={labelStyle}>CONNECTOR TYPE *</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {CONNECTOR_TYPES.map(({ value, label, desc, Icon }) => {
            const active = state.connectorType === value
            return (
              <button
                key={value}
                onClick={() => set({ connectorType: value })}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  gap: 6, padding: '10px 12px', cursor: 'pointer',
                  background: active ? 'var(--accent-dim)' : 'var(--surface2)',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 6, transition: 'all 0.12s', fontFamily: 'inherit',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    ;(e.currentTarget).style.borderColor = 'var(--border2)'
                    ;(e.currentTarget).style.background = 'var(--surface3)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    ;(e.currentTarget).style.borderColor = 'var(--border)'
                    ;(e.currentTarget).style.background = 'var(--surface2)'
                  }
                }}
              >
                <Icon size={14} style={{ color: active ? 'var(--accent)' : 'var(--text-dim)' }} />
                <div>
                  <div style={{ fontSize: 11, color: active ? 'var(--accent)' : 'var(--text)', fontWeight: 600, letterSpacing: '0.02em' }}>{label}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.3 }}>{desc}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Connector-specific fields */}
      {state.connectorType === 'http' && (
        <FieldGroup label="BASE URL *" error={errors.httpBaseUrl}>
          <input style={inputCss(!!errors.httpBaseUrl)} value={state.httpBaseUrl} onChange={(e) => set({ httpBaseUrl: e.target.value })} placeholder="e.g. https://api.example.com" />
        </FieldGroup>
      )}

      {state.connectorType === 'cli' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FieldGroup label="SHELL" hint="Default: /bin/sh">
              <input style={inputCss()} value={state.cliShell} onChange={(e) => set({ cliShell: e.target.value })} placeholder="e.g. /bin/bash" />
            </FieldGroup>
            <FieldGroup label="WORKING DIRECTORY">
              <input style={inputCss()} value={state.cliCwd} onChange={(e) => set({ cliCwd: e.target.value })} placeholder="e.g. /path/to/project" />
            </FieldGroup>
          </div>
          <FieldGroup label="TIMEOUT (ms)" hint="Default: 30000">
            <input style={inputCss()} value={state.cliTimeoutMs} type="number" onChange={(e) => set({ cliTimeoutMs: e.target.value })} placeholder="30000" />
          </FieldGroup>
        </div>
      )}

      {state.connectorType === 'file' && (
        <FieldGroup label="BASE PATH" hint="Jail root for relative paths">
          <input style={inputCss()} value={state.fileBasePath} onChange={(e) => set({ fileBasePath: e.target.value })} placeholder="e.g. /home/user/documents" />
        </FieldGroup>
      )}

      {state.connectorType === 'grpc' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FieldGroup label="ENDPOINT *" error={errors.grpcEndpoint} hint="host:port">
              <input style={inputCss(!!errors.grpcEndpoint)} value={state.grpcEndpoint} onChange={(e) => set({ grpcEndpoint: e.target.value })} placeholder="e.g. api.example.com:443" />
            </FieldGroup>
            <FieldGroup label="PROTO PATH *" error={errors.grpcProtoPath} hint="Path to .proto file">
              <input style={inputCss(!!errors.grpcProtoPath)} value={state.grpcProtoPath} onChange={(e) => set({ grpcProtoPath: e.target.value })} placeholder="e.g. ./protos/service.proto" />
            </FieldGroup>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={state.grpcTls} onChange={(e) => set({ grpcTls: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
            <span style={{ fontSize: 11, color: 'var(--text)' }}>Enable TLS</span>
          </label>
        </div>
      )}

      {state.connectorType === 'graphql' && (
        <FieldGroup label="ENDPOINT *" error={errors.graphqlEndpoint}>
          <input style={inputCss(!!errors.graphqlEndpoint)} value={state.graphqlEndpoint} onChange={(e) => set({ graphqlEndpoint: e.target.value })} placeholder="e.g. https://api.example.com/graphql" />
        </FieldGroup>
      )}

      {state.connectorType === 'mcp' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Transport */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label style={labelStyle}>TRANSPORT *</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['stdio', 'sse'] as const).map((t) => (
                <label key={t} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px',
                  borderRadius: 5, cursor: 'pointer',
                  background: state.mcpTransport === t ? 'var(--accent-dim)' : 'var(--surface2)',
                  border: `1px solid ${state.mcpTransport === t ? 'var(--accent)' : 'var(--border)'}`,
                  transition: 'all 0.12s',
                }}>
                  <input type="radio" name="mcpTransport" value={t} checked={state.mcpTransport === t} onChange={() => set({ mcpTransport: t })} style={{ accentColor: 'var(--accent)' }} />
                  <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>{t}</span>
                </label>
              ))}
            </div>
          </div>
          {state.mcpTransport === 'stdio' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FieldGroup label="COMMAND *" error={errors.mcpCommand} hint="e.g. npx">
                <input style={inputCss(!!errors.mcpCommand)} value={state.mcpCommand} onChange={(e) => set({ mcpCommand: e.target.value })} placeholder="e.g. npx" />
              </FieldGroup>
              <FieldGroup label="ARGS" hint="Space-separated arguments">
                <input style={inputCss()} value={state.mcpArgs} onChange={(e) => set({ mcpArgs: e.target.value })} placeholder="e.g. -y @modelcontextprotocol/server-fetch" />
              </FieldGroup>
            </div>
          ) : (
            <FieldGroup label="URL *" error={errors.mcpUrl}>
              <input style={inputCss(!!errors.mcpUrl)} value={state.mcpUrl} onChange={(e) => set({ mcpUrl: e.target.value })} placeholder="e.g. http://localhost:3001/sse" />
            </FieldGroup>
          )}
        </div>
      )}

      {state.connectorType === 'sql' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Dialect */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label style={labelStyle}>DIALECT *</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['postgres', 'mysql', 'sqlite'] as const).map((d) => (
                <label key={d} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px',
                  borderRadius: 5, cursor: 'pointer',
                  background: state.sqlDialect === d ? 'var(--accent-dim)' : 'var(--surface2)',
                  border: `1px solid ${state.sqlDialect === d ? 'var(--accent)' : 'var(--border)'}`,
                  transition: 'all 0.12s',
                }}>
                  <input type="radio" name="sqlDialect" value={d} checked={state.sqlDialect === d}
                    onChange={() => set({ sqlDialect: d, sqlConnMode: 'dsn' })} style={{ accentColor: 'var(--accent)' }} />
                  <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>{d}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Connection mode (hidden for sqlite) */}
          {state.sqlDialect !== 'sqlite' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={labelStyle}>CONNECTION MODE *</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {([['dsn', 'Connection string'], ['fields', 'Host & port']] as const).map(([v, lbl]) => (
                  <label key={v} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px',
                    borderRadius: 5, cursor: 'pointer',
                    background: state.sqlConnMode === v ? 'var(--accent-dim)' : 'var(--surface2)',
                    border: `1px solid ${state.sqlConnMode === v ? 'var(--accent)' : 'var(--border)'}`,
                    transition: 'all 0.12s',
                  }}>
                    <input type="radio" name="sqlConnMode" value={v} checked={state.sqlConnMode === v}
                      onChange={() => set({ sqlConnMode: v })} style={{ accentColor: 'var(--accent)' }} />
                    <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>{lbl}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Mode-conditional fields */}
          {state.sqlDialect === 'sqlite' && (
            <FieldGroup label="DATABASE FILE PATH *" error={errors.sqlDatabase}>
              <input style={inputCss(!!errors.sqlDatabase)} value={state.sqlDatabase}
                onChange={(e) => set({ sqlDatabase: e.target.value })} placeholder="/path/to/db.sqlite" />
            </FieldGroup>
          )}
          {state.sqlDialect !== 'sqlite' && state.sqlConnMode === 'dsn' && (
            <FieldGroup label="CONNECTION STRING ENV *" error={errors.sqlConnectionStringEnv} hint="Name of the env var holding the full DSN (e.g. DATABASE_URL)">
              <input style={inputCss(!!errors.sqlConnectionStringEnv)} value={state.sqlConnectionStringEnv}
                onChange={(e) => set({ sqlConnectionStringEnv: e.target.value })} placeholder="DATABASE_URL" />
            </FieldGroup>
          )}
          {state.sqlDialect !== 'sqlite' && state.sqlConnMode === 'fields' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 12 }}>
                <FieldGroup label="HOST *" error={errors.sqlHost}>
                  <input style={inputCss(!!errors.sqlHost)} value={state.sqlHost}
                    onChange={(e) => set({ sqlHost: e.target.value })} placeholder="localhost" />
                </FieldGroup>
                <FieldGroup label="PORT *" error={errors.sqlPort}>
                  <input type="number" style={inputCss(!!errors.sqlPort)} value={state.sqlPort}
                    onChange={(e) => set({ sqlPort: e.target.value })}
                    placeholder={state.sqlDialect === 'mysql' ? '3306' : '5432'} />
                </FieldGroup>
              </div>
              <FieldGroup label="DATABASE *" error={errors.sqlDatabase}>
                <input style={inputCss(!!errors.sqlDatabase)} value={state.sqlDatabase}
                  onChange={(e) => set({ sqlDatabase: e.target.value })} placeholder="myapp" />
              </FieldGroup>
            </div>
          )}

          {/* SSL (hidden for sqlite) */}
          {state.sqlDialect !== 'sqlite' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={state.sqlSsl} onChange={(e) => set({ sqlSsl: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
              <span style={{ fontSize: 11, color: 'var(--text)' }}>Enable SSL</span>
            </label>
          )}

          {/* Advanced */}
          <details style={{ border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
            <summary style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.05em', background: 'var(--surface2)', userSelect: 'none' }}>
              Advanced (pool & timeouts)
            </summary>
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <FieldGroup label="POOL MAX">
                  <input type="number" style={inputCss()} value={state.sqlPoolMax}
                    onChange={(e) => set({ sqlPoolMax: e.target.value })} placeholder="10" />
                </FieldGroup>
                <FieldGroup label="IDLE (ms)">
                  <input type="number" style={inputCss()} value={state.sqlIdleMs}
                    onChange={(e) => set({ sqlIdleMs: e.target.value })} placeholder="30000" />
                </FieldGroup>
                <FieldGroup label="CONN TIMEOUT (ms)">
                  <input type="number" style={inputCss()} value={state.sqlConnectionTimeoutMs}
                    onChange={(e) => set({ sqlConnectionTimeoutMs: e.target.value })} placeholder="10000" />
                </FieldGroup>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <FieldGroup label="DEFAULT TIMEOUT (ms)">
                  <input type="number" style={inputCss()} value={state.sqlDefaultTimeoutMs}
                    onChange={(e) => set({ sqlDefaultTimeoutMs: e.target.value })} placeholder="30000" />
                </FieldGroup>
                <FieldGroup label="DEFAULT MAX ROWS">
                  <input type="number" style={inputCss()} value={state.sqlDefaultMaxRows}
                    onChange={(e) => set({ sqlDefaultMaxRows: e.target.value })} placeholder="1000" />
                </FieldGroup>
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

function Step2({ state, set, errors }: { state: DesignerState; set: (p: Partial<DesignerState>) => void; errors: Errors }) {
  const ct = state.connectorType

  if (ct === 'sql') {
    if (state.sqlDialect === 'sqlite') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '50px 0', color: 'var(--text-dim)' }}>
          <Info size={28} style={{ opacity: 0.3 }} />
          <div style={{ fontSize: 12, letterSpacing: '0.04em' }}>Auth not applicable</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.7, maxWidth: 320 }}>
            SQLite uses a local file — no credentials needed. Click Next to continue.
          </div>
        </div>
      )
    }
    if (state.sqlConnMode === 'dsn') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '50px 0', color: 'var(--text-dim)' }}>
          <Info size={28} style={{ opacity: 0.3 }} />
          <div style={{ fontSize: 12, letterSpacing: '0.04em' }}>Credentials in DSN</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.7, maxWidth: 340 }}>
            The connection string env var already contains your credentials. No separate auth setup needed. Click Next to continue.
          </div>
        </div>
      )
    }
    // fields mode — lock to basic, show DB-appropriate labels
    return (
      <AuthFormSection
        fields={{ ...state.auth, authType: 'basic' }}
        onChange={(auth) => set({ auth })}
        errors={errors}
        lockedType="basic"
        labels={{ usernameEnv: 'DB USERNAME ENV VAR *', tokenEnv: 'DB PASSWORD ENV VAR *' }}
      />
    )
  }

  if (ct !== 'http' && ct !== 'graphql') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '50px 0', color: 'var(--text-dim)' }}>
        <Info size={28} style={{ opacity: 0.3 }} />
        <div style={{ fontSize: 12, letterSpacing: '0.04em' }}>Auth not applicable</div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.7, maxWidth: 320 }}>
          The <strong style={{ color: 'var(--text)' }}>{ct.toUpperCase()}</strong> connector does not support authentication configuration. Click Next to continue.
        </div>
      </div>
    )
  }
  return (
    <AuthFormSection
      fields={state.auth}
      onChange={(auth) => set({ auth })}
      errors={errors}
    />
  )
}

function Step3({ state, set }: { state: DesignerState; set: (p: Partial<DesignerState>) => void }) {
  if (state.connectorType === 'mcp') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '50px 0', color: 'var(--text-dim)' }}>
        <Plug size={28} style={{ opacity: 0.3 }} />
        <div style={{ fontSize: 12, letterSpacing: '0.04em' }}>Tools auto-discovered</div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.7, maxWidth: 340 }}>
          MCP connectors expose tools dynamically from the remote server. No tool definitions needed — they will be discovered automatically at runtime.
        </div>
      </div>
    )
  }
  return (
    <ToolBuilder
      tools={state.tools}
      onChange={(tools) => set({ tools })}
      connectorType={state.connectorType}
    />
  )
}

function Step4({ state }: { state: DesignerState }) {
  const config = buildConfig(state)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', background: 'var(--surface2)',
        border: '1px solid var(--border)', borderRadius: 6,
        fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6,
      }}>
        <Info size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        Review the generated config. Click <strong style={{ color: 'var(--text)' }}>Create Config</strong> to write it to disk and register the tools with the MCP server.
      </div>
      <JsonPreview json={config} maxHeight={460} />
    </div>
  )
}

// ── Step indicator ─────────────────────────────────────────────────

function StepIndicator({ current, connectorType }: { current: number; connectorType: ConnectorType }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '0 24px', flexShrink: 0 }}>
      {STEP_LABELS.map((label, i) => {
        const applies = stepApplies(i, connectorType)
        const isDone = i < current
        const isActive = i === current
        const isSkipped = !applies

        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < 3 ? 1 : undefined }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                background: isDone ? 'var(--accent)' : isActive ? 'var(--accent-dim)' : 'var(--surface2)',
                border: `1px solid ${isDone || isActive ? 'var(--accent)' : 'var(--border)'}`,
                color: isDone ? 'var(--accent-txt)' : isActive ? 'var(--accent)' : isSkipped ? 'var(--border2)' : 'var(--text-dim)',
                transition: 'all 0.2s',
              }}>
                {isDone ? <Check size={10} /> : i + 1}
              </div>
              <span style={{
                fontSize: 8, letterSpacing: '0.06em', whiteSpace: 'nowrap',
                color: isDone ? 'var(--accent)' : isActive ? 'var(--text)' : isSkipped ? 'var(--border2)' : 'var(--text-dim)',
              }}>
                {label}
              </span>
            </div>
            {i < 3 && (
              <div style={{
                height: 1, flex: 1, margin: '0 8px', marginBottom: 16,
                background: isDone ? 'var(--accent)' : 'var(--border)',
                transition: 'background 0.2s',
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── ConfigDesigner ─────────────────────────────────────────────────

interface ConfigDesignerProps {
  createConfig: (data: unknown) => Promise<void>
  onClose: () => void
}

export function ConfigDesigner({ createConfig, onClose }: ConfigDesignerProps) {
  const [state, setState] = useState<DesignerState>(INITIAL_STATE)
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)

  const set = useCallback((partial: Partial<DesignerState>) => setState((s) => ({ ...s, ...partial })), [])

  const handleNext = () => {
    let errs: Errors = {}
    if (step === 0) errs = validateStep1(state)
    // Auth step: warn but don't block — incomplete auth shows on the config card
    if (step === 1) {
      errs = validateStep2(state)
      if (Object.keys(errs).length > 0) {
        toast.info('Auth fields incomplete — you can fill them in later')
        setErrors({})
        setStep(nextStep(step, state.connectorType))
        return
      }
    }

    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})
    setStep(nextStep(step, state.connectorType))
  }

  const handleBack = () => {
    setErrors({})
    setStep(prevStep(step, state.connectorType))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await createConfig(buildConfig(state))
      toast.success(`Config "${state.name}" created successfully`)
      onClose()
    } catch (err) {
      if (err instanceof ApiRequestError && err.data.errors) {
        const serverErrors: Errors = {}
        for (const e of err.data.errors) serverErrors[e.field] = e.message
        setErrors(serverErrors)
        if (err.status === 409) toast.error(`Config ID "${state.id}" already exists`)
        else toast.error('Validation failed — check the fields')
        setStep(0)
      } else {
        toast.error((err as Error).message ?? 'Failed to create config')
      }
    } finally {
      setSaving(false)
    }
  }

  const isLastStep = step === 3
  const isFirstStep = prevStep(step, state.connectorType) === step

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Topbar */}
      <div style={{
        height: 42, background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 16px', flexShrink: 0, gap: 10,
      }}>
        <span style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)' }}>
          <span style={{ color: 'var(--accent)' }}>configs</span> / new
        </span>
        <div style={{ flex: 1 }} />
        <Button variant="icon" size="xs" onClick={onClose} aria-label="Close">
          <X size={12} />
        </Button>
      </div>

      {/* Step indicator */}
      <div style={{
        padding: '20px 24px 16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0, background: 'var(--surface)',
      }}>
        <StepIndicator current={step} connectorType={state.connectorType} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {step === 0 && <Step1 state={state} set={set} errors={errors} />}
        {step === 1 && <Step2 state={state} set={set} errors={errors} />}
        {step === 2 && <Step3 state={state} set={set} />}
        {step === 3 && <Step4 state={state} />}
      </div>

      {/* Footer nav */}
      <div style={{
        padding: '12px 20px', borderTop: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0, background: 'var(--surface)',
      }}>
        <Button variant="ghost" size="sm" onClick={handleBack} disabled={isFirstStep}>
          <ArrowLeft size={11} style={{ marginRight: 4 }} />
          Back
        </Button>
        <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
          Step {step + 1} of 4
        </span>
        {isLastStep ? (
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={11} style={{ marginRight: 4, animation: 'spin 1s linear infinite' }} /> : <Check size={11} style={{ marginRight: 4 }} />}
            {saving ? 'Creating…' : 'Create Config'}
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={handleNext}>
            Next
            <ArrowRight size={11} style={{ marginLeft: 4 }} />
          </Button>
        )}
      </div>
    </div>
  )
}
