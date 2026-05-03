import { useState, useEffect } from 'react'
import { diffLines } from 'diff'
import { Upload, CheckCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { api, ApiRequestError } from '@/lib/api'
import type { ConfigSummary } from '@/types/server'

// Connector types that publish overlay-only (tools: [], connection details stripped)
const OVERLAY_ONLY = ['mcp', 'graphql', 'grpc']

function buildPublishPayload(cfg: ConfigSummary): Record<string, unknown> {
  const raw = cfg.raw as Record<string, unknown>
  if (!OVERLAY_ONLY.includes(cfg.connector.type)) {
    return { ...raw }
  }

  // Introspected types: keep the full connector block (registry validator requires
  // transport/command/host/endpoint), but enforce tools:[] and rename overlays →
  // registry_overlays.
  const { overlays, registry_overlays, tools: _drop, ...rest } = raw
  return {
    ...rest,
    registry_overlays: (registry_overlays ?? overlays ?? {}) as Record<string, unknown>,
    tools: [],
  }
}


// ── Inline diff renderer ──────────────────────────────────────────

function InlineDiff({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  const changes = diffLines(JSON.stringify(before, null, 2), JSON.stringify(after, null, 2))
  const added   = changes.filter((c) => c.added).reduce((n, c) => n + (c.count ?? 0), 0)
  const removed = changes.filter((c) => c.removed).reduce((n, c) => n + (c.count ?? 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
        {added > 0 && (
          <span style={{ fontSize: 10, color: 'var(--green)', letterSpacing: '0.04em' }}>+{added} line{added !== 1 ? 's' : ''}</span>
        )}
        {removed > 0 && (
          <span style={{ fontSize: 10, color: 'var(--red)', letterSpacing: '0.04em' }}>−{removed} line{removed !== 1 ? 's' : ''}</span>
        )}
        {added === 0 && removed === 0 && (
          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic' }}>No changes detected</span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 4 }}>REGISTRY</div>
          <pre style={{
            background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5,
            padding: '8px 10px', fontSize: 9, lineHeight: 1.7, overflow: 'auto',
            maxHeight: 220, margin: 0,
          }}>
            {changes.map((part, i) =>
              part.added ? null : (
                <span key={i} style={{
                  color: part.removed ? 'var(--red)' : 'var(--text)',
                  background: part.removed ? 'rgba(255,95,87,0.10)' : 'transparent',
                  display: 'block',
                  borderLeft: part.removed ? '2px solid rgba(255,95,87,0.5)' : '2px solid transparent',
                  paddingLeft: 4,
                }}>{part.value}</span>
              )
            )}
          </pre>
        </div>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 4 }}>LOCAL</div>
          <pre style={{
            background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5,
            padding: '8px 10px', fontSize: 9, lineHeight: 1.7, overflow: 'auto',
            maxHeight: 220, margin: 0,
          }}>
            {changes.map((part, i) =>
              part.removed ? null : (
                <span key={i} style={{
                  color: part.added ? 'var(--green)' : 'var(--text)',
                  background: part.added ? 'rgba(40,200,64,0.08)' : 'transparent',
                  display: 'block',
                  borderLeft: part.added ? '2px solid rgba(40,200,64,0.5)' : '2px solid transparent',
                  paddingLeft: 4,
                }}>{part.value}</span>
              )
            )}
          </pre>
        </div>
      </div>
    </div>
  )
}

// ── Field ─────────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, type = 'text', hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  hint?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background: 'var(--surface2)', border: '1px solid var(--border2)',
          borderRadius: 4, padding: '7px 9px', fontSize: 11,
          color: 'var(--text)', fontFamily: 'inherit', outline: 'none', width: '100%',
        }}
      />
      {hint && <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.03em' }}>{hint}</span>}
    </div>
  )
}

// ── State machine types ───────────────────────────────────────────

type Phase = 'form' | 'submitting' | 'version_bump' | 'bumping' | 'success'

interface VersionBumpState {
  namespace: string
  slug: string
  qualifiedSlug: string
  connectorType: string
  localPayload: Record<string, unknown>
  remotePayload: Record<string, unknown> | null
}

// ── Main component ────────────────────────────────────────────────

export interface PublishModalProps {
  open: boolean
  onClose: () => void
  cfg: ConfigSummary
}

export function PublishModal({ open, onClose, cfg }: PublishModalProps) {
  const [phase, setPhase]           = useState<Phase>('form')
  const [namespace, setNamespace]   = useState('')
  const [authUsername, setAuthUsername] = useState<string | null>(null)
  const [description, setDescription] = useState(cfg.description ?? '')
  const [category, setCategory]     = useState('')
  const [tagsRaw, setTagsRaw]       = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [message, setMessage]       = useState('')
  const [error, setError]           = useState<string | null>(null)

  const [versionBump, setVersionBump] = useState<VersionBumpState | null>(null)
  const [bumpMessage, setBumpMessage] = useState('')
  const [diffOpen, setDiffOpen]       = useState(false)

  // Pre-fill namespace from auth status and track auth username for mismatch warning
  useEffect(() => {
    if (!open) return
    api.get<{ loggedIn: boolean; user?: { username: string } }>('/registry/auth/status')
      .then((data) => {
        if (data.loggedIn && data.user?.username) {
          setAuthUsername(data.user.username)
          setNamespace(data.user.username)
        }
      })
      .catch(() => {})
  }, [open])

  // Reset form on open
  useEffect(() => {
    if (open) {
      setPhase('form')
      setDescription(cfg.description ?? '')
      setCategory('')
      setTagsRaw('')
      setVisibility('public')
      setMessage('')
      setError(null)
      setVersionBump(null)
      setBumpMessage('')
      setDiffOpen(false)
    }
  }, [open, cfg])

  const handlePublish = async () => {
    if (!namespace.trim()) { setError('Namespace is required'); return }
    setError(null)
    setPhase('submitting')

    const localPayload = buildPublishPayload(cfg)
    const tags         = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)

    try {
      await api.post('/registry/publish', {
        config_id:   String(cfg.raw['id'] ?? cfg.id),
        namespace:   namespace.trim(),
        name:        cfg.name,
        description: description.trim(),
        category:    category.trim(),
        tags,
        visibility,
        message:     message.trim(),
        payload:     localPayload,
      })
      setPhase('success')
      setTimeout(onClose, 1500)
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        // 409 body is { code, message } — no config object. Derive ns/slug from form.
        const ns    = namespace.trim().replace(/^@/, '')
        const rawId = String(cfg.raw['id'] ?? cfg.id)
        const ct    = cfg.connector.type
        const baseId = rawId.endsWith(`-${ct}`)
          ? rawId.slice(0, -(ct.length + 1))
          : rawId
        const slug = baseId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')

        let remotePayload: Record<string, unknown> | null = null
        try {
          remotePayload = await api.get<Record<string, unknown>>(
            `/registry/payload/${ns}/${slug}?connector_type=${ct}`
          )
        } catch { /* diff unavailable — not a blocker */ }

        setVersionBump({
          namespace: ns,
          slug,
          qualifiedSlug: `@${ns}/${slug}:${ct}`,
          connectorType: ct,
          localPayload,
          remotePayload,
        })
        setPhase('version_bump')
      } else if (err instanceof ApiRequestError && err.status === 422) {
        const code = String((err.data as unknown as Record<string, unknown>)['code'] ?? '')
        if (code === 'no_changes_to_publish') {
          setError('No changes to publish — your local overlay matches the registry.')
          setPhase('form')
          return
        }
        setError((err as Error).message)
        setPhase('form')
      } else {
        setError((err as Error).message)
        setPhase('form')
      }
    }
  }

  const handlePublishVersion = async () => {
    if (!versionBump) return
    setError(null)
    setPhase('bumping')

    try {
      await api.post(`/registry/publish-version/${versionBump.namespace}/${versionBump.slug}`, {
        payload:        versionBump.localPayload,
        message:        bumpMessage.trim(),
        qualified_slug: versionBump.qualifiedSlug,
        connector_type: versionBump.connectorType,
      })
      setPhase('success')
      setTimeout(onClose, 1500)
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 422) {
        const code = String((err.data as unknown as Record<string, unknown>)['code'] ?? '')
        if (code === 'no_changes_to_publish') {
          setError('No changes to publish — your local overlay matches the registry.')
          setPhase('version_bump')
          return
        }
      }
      setError((err as Error).message)
      setPhase('version_bump')
    }
  }

  const isOverlayOnly  = OVERLAY_ONLY.includes(cfg.connector.type)
  const isVersionBump  = phase === 'version_bump' || phase === 'bumping'
  const modalTitle     = isVersionBump
    ? `New Version — ${cfg.name}`
    : `Publish — ${cfg.name}`

  return (
    <Modal open={open} onClose={onClose} title={modalTitle} width={600}>
      {/* ── Success ── */}
      {phase === 'success' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 20px' }}>
          <CheckCircle size={32} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 13, color: 'var(--text)', letterSpacing: '0.04em' }}>Published successfully</span>
        </div>
      )}

      {/* ── Initial form ── */}
      {(phase === 'form' || phase === 'submitting') && (
        <>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {isOverlayOnly && (
              <div style={{
                fontSize: 10, color: 'var(--accent)', background: 'var(--accent-dim)',
                border: '1px solid var(--accent)', borderRadius: 4, padding: '6px 10px',
                letterSpacing: '0.03em', lineHeight: 1.5,
              }}>
                Overlay-only publish — tool descriptions and customizations only. Connection details and tool list are not shared.
              </div>
            )}
            <Field label="Namespace" value={namespace} onChange={setNamespace} placeholder="your-username" />
            {authUsername && namespace.trim() && namespace.trim() !== authUsername && (
              <div style={{
                fontSize: 9, color: 'var(--orange, #ff9f43)',
                background: 'rgba(255,159,67,0.08)', border: '1px solid rgba(255,159,67,0.3)',
                borderRadius: 4, padding: '5px 8px', letterSpacing: '0.03em', lineHeight: 1.5,
              }}>
                Publishing to <code>{namespace.trim()}</code> — different from your account (<code>{authUsername}</code>). Double-check this is intentional.
              </div>
            )}
            <Field label="Description" value={description} onChange={setDescription} placeholder="What does this config do?" />
            <Field label="Category" value={category} onChange={setCategory} placeholder="e.g. development, productivity, data" />
            <Field label="Tags" value={tagsRaw} onChange={setTagsRaw} placeholder="Comma-separated (optional)" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Visibility</label>
              <div style={{ display: 'flex', gap: 12 }}>
                {(['public', 'private'] as const).map((v) => (
                  <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: 'var(--text)' }}>
                    <input type="radio" name="visibility" value={v} checked={visibility === v} onChange={() => setVisibility(v)} />
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Changelog note" value={message} onChange={setMessage} placeholder="Optional note for this release" />
            {error && <div style={{ fontSize: 10, color: 'var(--red)', letterSpacing: '0.03em' }}>{error}</div>}
          </div>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={phase === 'submitting'}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void handlePublish()} disabled={phase === 'submitting'}>
              {phase === 'submitting'
                ? <><Loader2 size={10} style={{ marginRight: 5, animation: 'spin 1s linear infinite' }} />Publishing…</>
                : <><Upload size={10} style={{ marginRight: 5 }} />Publish</>
              }
            </Button>
          </div>
        </>
      )}

      {/* ── Version bump ── */}
      {isVersionBump && versionBump && (
        <>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.03em', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>{versionBump.namespace}/{versionBump.slug}</span>
              {' '}already exists in the registry. Enter a new version to publish an update.
            </div>

            {/* Diff section */}
            {versionBump.remotePayload && (
              <div>
                <button
                  onClick={() => setDiffOpen((v) => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, marginBottom: diffOpen ? 10 : 0 }}
                >
                  {diffOpen
                    ? <ChevronDown size={10} style={{ color: 'var(--text-dim)' }} />
                    : <ChevronRight size={10} style={{ color: 'var(--text-dim)' }} />
                  }
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
                    {diffOpen ? 'Hide diff' : 'Show diff vs registry'}
                  </span>
                </button>
                {diffOpen && (
                  <InlineDiff before={versionBump.remotePayload} after={versionBump.localPayload} />
                )}
              </div>
            )}

            <div style={{
              fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.03em',
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 4, padding: '6px 10px', lineHeight: 1.5,
            }}>
              Version will be auto-assigned by the registry based on what changed (major / minor / patch).
            </div>
            <Field label="Changelog note" value={bumpMessage} onChange={setBumpMessage} placeholder="What changed in this version?" />
            {error && <div style={{ fontSize: 10, color: 'var(--red)', letterSpacing: '0.03em' }}>{error}</div>}
          </div>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={phase === 'bumping'}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void handlePublishVersion()} disabled={phase === 'bumping'}>
              {phase === 'bumping'
                ? <><Loader2 size={10} style={{ marginRight: 5, animation: 'spin 1s linear infinite' }} />Publishing…</>
                : <><Upload size={10} style={{ marginRight: 5 }} />Publish Version</>
              }
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
