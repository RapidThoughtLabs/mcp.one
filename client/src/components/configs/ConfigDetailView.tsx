import { useState, useEffect } from 'react'
import {
  ArrowLeft, Globe, Terminal, FileText, Cpu, Network, Server, Database,
  ShieldCheck, ShieldAlert, Package, Tag, Calendar, Code2,
  ChevronDown, ChevronRight, Loader2, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import type { ConfigSummary, ConfigDetail, McpTool } from '@/types/server'

// ── Helpers ─────────────────────────────────────────────────────────

function connectorIcon(type: string) {
  const size = 13
  const style = { color: 'var(--text-dim)', flexShrink: 0 as const }
  switch (type) {
    case 'http': return <Globe size={size} style={style} />
    case 'cli': return <Terminal size={size} style={style} />
    case 'file': return <FileText size={size} style={style} />
    case 'grpc': return <Cpu size={size} style={style} />
    case 'graphql': return <Network size={size} style={style} />
    case 'mcp': return <Server size={size} style={style} />
    case 'sql': return <Database size={size} style={style} />
    default: return <Globe size={size} style={style} />
  }
}

function connectorLabel(type: string): string {
  const map: Record<string, string> = {
    http: 'HTTP', cli: 'CLI', file: 'File', grpc: 'gRPC', graphql: 'GraphQL', mcp: 'MCP', sql: 'SQL',
  }
  return map[type] ?? type
}

function connectorUrl(cfg: ConfigSummary): string {
  const c = cfg.connector
  if (c.type === 'sql') {
    if (c.connection_string_env) return `env:${String(c.connection_string_env)}`
    if (c.host) return `${String(c.dialect)}://${String(c.host)}:${String(c.port ?? '?')}/${String(c.database ?? '')}`
    if (c.database) return `${String(c.dialect)}:${String(c.database)}`
    return String(c.type)
  }
  return (c.base_url ?? c.endpoint ?? c.transport ?? c.type) as string
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

// ── Section wrapper ──────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-dim)',
        textTransform: 'uppercase', marginBottom: 8, paddingBottom: 5,
        borderBottom: '1px solid var(--border)',
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

// ── Badge ────────────────────────────────────────────────────────────

function Badge({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span style={{
      fontSize: 9, padding: '2px 8px', borderRadius: 99,
      letterSpacing: '0.06em',
      background: accent ? 'var(--accent-dim)' : 'var(--surface2)',
      color: accent ? 'var(--accent)' : 'var(--text-dim)',
    }}>
      {label}
    </span>
  )
}

// ── Tool row ─────────────────────────────────────────────────────────

function ToolRow({ tool }: { tool: McpTool }) {
  const [open, setOpen] = useState(false)
  const shortName = tool.name.includes('.') ? tool.name.split('.').slice(1).join('.') : tool.name
  const schema = tool.inputSchema
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = (schema.required ?? []) as string[]
  const hasParams = Object.keys(props).length > 0

  return (
    <div style={{
      background: 'var(--surface2)', borderRadius: 5,
      border: '1px solid var(--border)', overflow: 'hidden',
    }}>
      <button
        onClick={() => hasParams && setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
          width: '100%', background: 'transparent', border: 'none',
          cursor: hasParams ? 'pointer' : 'default', textAlign: 'left',
        }}
        onMouseEnter={(e) => { if (hasParams) e.currentTarget.style.background = 'var(--surface3, rgba(255,255,255,0.03))' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {hasParams ? (
          open
            ? <ChevronDown size={10} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
            : <ChevronRight size={10} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        ) : (
          <span style={{ width: 10, flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace', letterSpacing: '0.02em' }}>
            {shortName}
          </div>
          {tool.description && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.4 }}>
              {tool.description}
            </div>
          )}
        </div>
        {hasParams && (
          <span style={{ fontSize: 9, color: 'var(--text-dim)', flexShrink: 0 }}>
            {Object.keys(props).length} param{Object.keys(props).length !== 1 ? 's' : ''}
          </span>
        )}
      </button>

      {open && hasParams && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '6px 10px 8px 28px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Object.entries(props).map(([name, def]) => {
              const isRequired = required.includes(name)
              return (
                <div key={name} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text)', minWidth: 120 }}>
                    {name}
                    {isRequired && <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--accent)', letterSpacing: '0.04em' }}>
                    {String(def.type ?? 'any')}
                  </span>
                  {!!def.description && (
                    <span style={{ fontSize: 9, color: 'var(--text-dim)', flex: 1 }}>
                      — {String(def.description)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────

export function ConfigDetailView({ cfg, onClose }: { cfg: ConfigSummary; onClose: () => void }) {
  const [detail, setDetail] = useState<ConfigDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rawOpen, setRawOpen] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.get<ConfigDetail>(`/configs/${cfg.id}/detail`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [cfg.id])

  const authOk = cfg.auth?.ok ?? true
  const url = connectorUrl(cfg)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{
        height: 42, background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 16px', flexShrink: 0, gap: 10,
      }}>
        <Button size="sm" variant="ghost" onClick={onClose} style={{ padding: '4px 6px' }}>
          <ArrowLeft size={11} />
        </Button>
        <span style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)' }}>
          <span style={{ color: 'var(--accent)' }}>configs</span>
          {' / '}
          <span style={{ color: 'var(--text)' }}>{cfg.id}</span>
        </span>
        <div style={{ flex: 1 }} />
        <Badge label={connectorLabel(cfg.connector.type)} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 40px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '60px 0', color: 'var(--text-dim)' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 11 }}>Loading…</span>
          </div>
        ) : error ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '60px 0', color: 'var(--red)' }}>
            <AlertCircle size={16} />
            <span style={{ fontSize: 11 }}>{error}</span>
          </div>
        ) : detail && (
          <>
            {/* Name / description */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                {connectorIcon(cfg.connector.type)}
                <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0, letterSpacing: '0.02em' }}>
                  {cfg.name}
                </h2>
                {cfg.auth && (
                  authOk
                    ? <ShieldCheck size={13} style={{ color: 'var(--accent)' }} />
                    : <ShieldAlert size={13} style={{ color: 'var(--red)' }} />
                )}
              </div>
              {cfg.description && (
                <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0, lineHeight: 1.6, letterSpacing: '0.02em' }}>
                  {cfg.description}
                </p>
              )}
            </div>

            {/* Connector */}
            <Section title="Connector">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Row label="Type" value={connectorLabel(cfg.connector.type)} />
                <Row label="URL / Endpoint" value={url} mono />
                {cfg.auth && (
                  <>
                    <Row label="Auth" value={cfg.auth.type} />
                    <Row
                      label="Status"
                      value={authOk ? 'Credentials OK' : `Missing: ${(cfg.auth.missingVars ?? []).join(', ')}`}
                      valueColor={authOk ? 'var(--accent)' : 'var(--red)'}
                    />
                  </>
                )}
              </div>
            </Section>

            {/* Origin */}
            <Section title="Origin">
              {detail.registry ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Row label="Source" value="Registry" icon={<Package size={10} style={{ color: 'var(--accent)' }} />} valueColor="var(--accent)" />
                  {detail.registry.registryUrl && (
                    <Row label="Registry" value={detail.registry.registryUrl} mono />
                  )}
                  <Row label="Slug" value={detail.registry.slug} icon={<Tag size={10} style={{ color: 'var(--text-dim)' }} />} mono />
                  <Row label="Version" value={`v${detail.registry.version}`} />
                  <Row
                    label="Installed"
                    value={fmtDate(detail.registry.installed_at)}
                    icon={<Calendar size={10} style={{ color: 'var(--text-dim)' }} />}
                  />
                </div>
              ) : (
                <Row label="Source" value="Local (manually created)" />
              )}
            </Section>

            {/* Tools */}
            <Section title={`Tools (${detail.tools.length})`}>
              {detail.tools.length === 0 ? (
                <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.03em' }}>
                  No tools registered yet — the server may still be connecting.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {detail.tools.map((tool) => (
                    <ToolRow key={tool.name} tool={tool} />
                  ))}
                </div>
              )}
            </Section>

            {/* Raw JSON */}
            <Section title="Raw Config">
              <button
                onClick={() => setRawOpen((v) => !v)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  borderRadius: 5, cursor: 'pointer', padding: '5px 10px',
                  marginBottom: rawOpen ? 8 : 0, transition: 'background 0.1s, border-color 0.1s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--surface3, rgba(255,255,255,0.06))'
                  e.currentTarget.style.borderColor = 'var(--border-mid, var(--accent))'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--surface2)'
                  e.currentTarget.style.borderColor = 'var(--border)'
                }}
              >
                <Code2 size={11} style={{ color: 'var(--text-dim)' }} />
                <span style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
                  {rawOpen ? 'Hide' : 'Show'} mcp.{cfg.id}.json
                </span>
                {rawOpen
                  ? <ChevronDown size={10} style={{ color: 'var(--text-dim)' }} />
                  : <ChevronRight size={10} style={{ color: 'var(--text-dim)' }} />
                }
              </button>
              {rawOpen && (
                <pre style={{
                  margin: 0, padding: '10px 12px', borderRadius: 5,
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  fontSize: 10, color: 'var(--text-dim)', overflowX: 'auto',
                  lineHeight: 1.6, fontFamily: 'monospace',
                }}>
                  {JSON.stringify(cfg.raw, null, 2)}
                </pre>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

// ── Row helper ───────────────────────────────────────────────────────

function Row({
  label, value, mono, valueColor, icon,
}: {
  label: string
  value: string
  mono?: boolean
  valueColor?: string
  icon?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.06em', minWidth: 90, flexShrink: 0 }}>
        {label}
      </span>
      {icon}
      <span style={{
        fontSize: 10, color: valueColor ?? 'var(--text)',
        fontFamily: mono ? 'monospace' : 'inherit',
        letterSpacing: mono ? '0.02em' : undefined,
        wordBreak: 'break-all',
      }}>
        {value}
      </span>
    </div>
  )
}
