import { useState } from 'react'
import { Plus, Settings2, AlertCircle, CheckCircle, RefreshCw, Loader2, ChevronDown, Pencil, KeyRound, ExternalLink, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useConfigs } from '@/hooks/useConfigs'
import { ConfigDesigner } from './ConfigDesigner'
import { ConfigEditor } from './ConfigEditor'
import { ConfigDetailView } from './ConfigDetailView'
import { PublishModal } from './PublishModal'
import { api } from '@/lib/api'
import type { ConfigSummary } from '@/types/server'

// ── Helpers ────────────────────────────────────────────────────────

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

// ── CredentialForm ─────────────────────────────────────────────────

function CredentialForm({ configId, missingVars, onSaved }: {
  configId: string
  missingVars: string[]
  onSaved: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(missingVars.map((v) => [v, '']))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    const entries = missingVars.map((key) => ({ key, value: values[key] ?? '' }))
    if (entries.some((e) => !e.value.trim())) {
      setError('All fields are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.post('/credentials', { configId, entries, overwrite: true })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      marginBottom: 10, padding: '10px 12px',
      background: 'rgba(255,95,87,0.05)', border: '1px solid rgba(255,95,87,0.2)',
      borderRadius: 5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <KeyRound size={10} style={{ color: 'var(--red)' }} />
        <span style={{ fontSize: 10, color: 'var(--red)', letterSpacing: '0.04em' }}>Missing credentials</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {missingVars.map((varName) => (
          <div key={varName} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.06em' }}>{varName}</label>
            <input
              type="password"
              value={values[varName] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [varName]: e.target.value }))}
              placeholder="Paste your secret here…"
              style={{
                background: 'var(--surface2)', border: '1px solid var(--border2)',
                borderRadius: 4, padding: '6px 8px', fontSize: 11,
                color: 'var(--text)', fontFamily: 'inherit', outline: 'none', width: '100%',
              }}
            />
          </div>
        ))}
      </div>
      {error && (
        <div style={{ marginTop: 6, fontSize: 9, color: 'var(--red)', letterSpacing: '0.03em' }}>{error}</div>
      )}
      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        <Button size="sm" variant="primary" onClick={() => void handleSave()} disabled={saving}>
          {saving ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite', marginRight: 4 }} /> : null}
          Save to .env
        </Button>
      </div>
    </div>
  )
}

// ── ConfigCard ─────────────────────────────────────────────────────

function ConfigCard({ cfg, onEdit, onOpen, onRefetch }: { cfg: ConfigSummary; onEdit: () => void; onOpen: () => void; onRefetch: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const { deleteConfig } = useConfigs()
  const hasAuth = !!cfg.auth
  const authOk = cfg.auth?.ok ?? true
  const missingVars = cfg.auth?.missingVars ?? []
  const url = connectorUrl(cfg)

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${cfg.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await deleteConfig(cfg.id)
      onRefetch()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: `1px solid ${authOk ? 'var(--border)' : 'rgba(255,95,87,0.3)'}`,
        borderRadius: 6,
        overflow: 'hidden',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        flexShrink: 0,
      }}
    >
      <div style={{ height: 2, background: authOk ? 'var(--accent)' : 'var(--red)', opacity: authOk ? 0.7 : 1 }} />

      {/* Clickable header row — toggles expand/collapse */}
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          width: '100%',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--surface2)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <Settings2 size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', letterSpacing: '0.04em' }}>
            {cfg.name}
          </div>
          <div
            title={url}
            style={{
              fontSize: 10, color: 'var(--text-dim)', marginTop: 3, letterSpacing: '0.02em',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {url}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
            {cfg.toolCount} tools
          </span>
          <span style={{
            fontSize: 9, padding: '2px 8px', borderRadius: 99,
            letterSpacing: '0.06em', background: 'var(--surface2)', color: 'var(--text-dim)',
          }}>
            {connectorLabel(cfg.connector.type)}
          </span>
          {hasAuth && (
            <span style={{
              fontSize: 9, padding: '2px 8px', borderRadius: 99, letterSpacing: '0.06em',
              background: authOk ? 'var(--accent-dim)' : 'rgba(255,95,87,0.1)',
              color: authOk ? 'var(--accent)' : 'var(--red)',
            }}>
              {cfg.auth!.type}
            </span>
          )}
          {hasAuth && (
            authOk
              ? <CheckCircle size={13} style={{ color: 'var(--accent)' }} />
              : <AlertCircle size={13} style={{ color: 'var(--red)' }} />
          )}
          <ChevronDown
            size={12}
            style={{
              color: 'var(--text-dim)',
              transition: 'transform 0.2s',
              transform: expanded ? 'rotate(180deg)' : 'none',
              flexShrink: 0,
            }}
          />
        </div>
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px 12px' }}>
          {cfg.description && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5, letterSpacing: '0.02em', marginBottom: 10 }}>
              {cfg.description}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6, letterSpacing: '0.02em', wordBreak: 'break-all', marginBottom: 10 }}>
            <span style={{ color: 'var(--text-mid)' }}>URL: </span>{url}
          </div>
          {!authOk && missingVars.length > 0 && (
            <CredentialForm
              configId={cfg.id}
              missingVars={missingVars}
              onSaved={() => { setExpanded(false); onRefetch() }}
            />
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <Button size="sm" variant="ghost" onClick={onOpen}>
              <ExternalLink size={10} style={{ marginRight: 5 }} />
              Open
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Pencil size={10} style={{ marginRight: 5 }} />
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPublishOpen(true)}>
              <Upload size={10} style={{ marginRight: 5 }} />
              Publish
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void handleDelete()} disabled={deleting}
              style={{ color: 'var(--red)', marginLeft: 'auto' }}
            >
              {deleting
                ? <Loader2 size={10} style={{ marginRight: 5, animation: 'spin 1s linear infinite' }} />
                : <Trash2 size={10} style={{ marginRight: 5 }} />
              }
              Delete
            </Button>
          </div>
          <PublishModal open={publishOpen} onClose={() => setPublishOpen(false)} cfg={cfg} />
        </div>
      )}
    </div>
  )
}

// ── List view ──────────────────────────────────────────────────────

function ConfigsList({
  onNew,
  onEdit,
  onOpen,
}: {
  onNew: () => void
  onEdit: (cfg: ConfigSummary) => void
  onOpen: (cfg: ConfigSummary) => void
}) {
  const { configs, loading, error, refetch } = useConfigs()


  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{
        height: 42, background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 16px', flexShrink: 0, gap: 10,
      }}>
        <span style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)' }}>
          <span style={{ color: 'var(--accent)' }}>configs</span> / all
        </span>
        {loading && <Loader2 size={11} style={{ color: 'var(--text-dim)', animation: 'spin 1s linear infinite' }} />}
        <div style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" onClick={refetch} title="Refresh configs">
          <RefreshCw size={11} />
        </Button>
        <Button size="sm" variant="primary" onClick={onNew}>
          <Plus size={11} style={{ marginRight: 4 }} />
          New Config
        </Button>
      </div>

      {/* Config list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {error ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '60px 20px', color: 'var(--red)' }}>
            <AlertCircle size={28} style={{ opacity: 0.5 }} />
            <span style={{ fontSize: 11, letterSpacing: '0.04em' }}>Failed to load configs</span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'center' }}>{error}</span>
            <Button size="sm" variant="ghost" onClick={refetch}>Retry</Button>
          </div>
        ) : loading && configs.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '60px 20px', color: 'var(--text-dim)' }}>
            <Loader2 size={28} style={{ opacity: 0.3, animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 10, letterSpacing: '0.06em' }}>Loading configs…</span>
          </div>
        ) : configs.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '60px 20px', color: 'var(--text-dim)' }}>
            <Settings2 size={28} style={{ opacity: 0.2 }} />
            <span style={{ fontSize: 11, letterSpacing: '0.04em' }}>No configs found</span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.6 }}>
              Drop an{' '}
              <code style={{ background: 'var(--surface2)', padding: '1px 5px', borderRadius: 3 }}>mcp.*.json</code>
              {' '}file into{' '}
              <code style={{ background: 'var(--surface2)', padding: '1px 5px', borderRadius: 3 }}>mcp-configs/</code>
              {' '}or click{' '}
              <Button variant="link" size="sm" onClick={onNew}>New Config</Button>
              {' '}to get started.
            </span>
          </div>
        ) : (
          configs.map((cfg) => (
            <ConfigCard key={cfg.id} cfg={cfg} onEdit={() => onEdit(cfg)} onOpen={() => onOpen(cfg)} onRefetch={refetch} />
          ))
        )}
      </div>
    </div>
  )
}

// ── ConfigsView (sub-router) ───────────────────────────────────────

type SubPage = 'list' | 'designer' | 'editor' | 'detail'

export function ConfigsView() {
  const [subPage, setSubPage] = useState<SubPage>('list')
  const [activeConfig, setActiveConfig] = useState<ConfigSummary | null>(null)
  const { createConfig, updateConfig, deleteConfig } = useConfigs()

  if (subPage === 'designer') {
    return (
      <ConfigDesigner
        createConfig={createConfig}
        onClose={() => setSubPage('list')}
      />
    )
  }

  if (subPage === 'editor' && activeConfig) {
    return (
      <ConfigEditor
        config={activeConfig}
        updateConfig={updateConfig}
        deleteConfig={deleteConfig}
        onClose={() => {
          setSubPage('list')
          setActiveConfig(null)
        }}
      />
    )
  }

  if (subPage === 'detail' && activeConfig) {
    return (
      <ConfigDetailView
        cfg={activeConfig}
        onClose={() => {
          setSubPage('list')
          setActiveConfig(null)
        }}
      />
    )
  }

  return (
    <ConfigsList
      onNew={() => setSubPage('designer')}
      onEdit={(cfg) => {
        setActiveConfig(cfg)
        setSubPage('editor')
      }}
      onOpen={(cfg) => {
        setActiveConfig(cfg)
        setSubPage('detail')
      }}
    />
  )
}
