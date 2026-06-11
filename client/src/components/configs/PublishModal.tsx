import { useState, useEffect } from 'react'
import { Upload, GitFork, CheckCircle, Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { api, ApiRequestError } from '@/lib/api'
import type { ConfigSummary } from '@/types/server'

function patchBump(v: string): string {
  const parts = v.split('.')
  if (parts.length !== 3) return v
  const patch = parseInt(parts[2] ?? '0', 10)
  return `${parts[0]}.${parts[1]}.${isNaN(patch) ? 1 : patch + 1}`
}

function buildPublishPayload(cfg: ConfigSummary): Record<string, unknown> {
  const raw = cfg.raw as Record<string, unknown>
  // Drop registry_overlays — legacy accidental field replaced by overlays
  const { registry_overlays: _legacy, ...rest } = raw
  return rest
}

function Field({
  label, value, onChange, placeholder, hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: '0.69rem', color: 'var(--text-dim)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background: 'var(--surface2)', border: '1px solid var(--border2)',
          borderRadius: 4, padding: '7px 9px', fontSize: '0.85rem',
          color: 'var(--text)', fontFamily: 'inherit', outline: 'none', width: '100%',
        }}
      />
      {hint && <span style={{ fontSize: '0.69rem', color: 'var(--text-dim)', letterSpacing: '0.03em' }}>{hint}</span>}
    </div>
  )
}

type Phase = 'form' | 'submitting' | 'success'

interface PublishResult {
  action: 'created' | 'versioned' | 'forked'
  version: { version: string }
  config: { qualified_slug: string }
}

export interface PublishModalProps {
  open: boolean
  onClose: () => void
  cfg: ConfigSummary
  mode?: 'publish' | 'fork'
}

export function PublishModal({ open, onClose, cfg, mode = 'publish' }: PublishModalProps) {
  const isFork = mode === 'fork'
  const [phase, setPhase]           = useState<Phase>('form')
  const [authUsername, setAuthUsername] = useState<string | null>(null)
  const [description, setDescription] = useState(cfg.description ?? '')
  const [category, setCategory]     = useState('')
  const [tagsRaw, setTagsRaw]       = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [message, setMessage]       = useState('')
  const [version, setVersion]           = useState('')
  const [versionError, setVersionError] = useState<string | null>(null)
  const [isExistingConfig, setIsExistingConfig] = useState(false)
  const [latestVersion, setLatestVersion]       = useState<string | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [result, setResult]         = useState<PublishResult | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false

    api.get<{ loggedIn: boolean; user?: { username: string } }>('/registry/auth/status')
      .then((data) => {
        if (!cancelled && data.loggedIn && data.user?.username) setAuthUsername(data.user.username)
      })
      .catch(() => {})

    api.get<{ category: string; tags: string[]; latest_version: { version: string } | null }>(
      `/registry/config-meta?config_id=${encodeURIComponent(cfg.id)}`
    ).then((data) => {
      if (cancelled) return
      if (data.category) setCategory(data.category)
      if (data.tags?.length) setTagsRaw(data.tags.join(', '))
      if (data.latest_version) {
        setIsExistingConfig(true)
        setLatestVersion(data.latest_version.version)
        setVersion(patchBump(data.latest_version.version))
      }
    }).catch(() => {}) // non-critical — config may not be from registry

    return () => { cancelled = true }
  }, [open, cfg.id])

  useEffect(() => {
    if (open) {
      setPhase('form')
      setDescription(cfg.description ?? '')
      setCategory('')
      setTagsRaw('')
      setVisibility('public')
      setMessage('')
      setVersion('')
      setVersionError(null)
      setIsExistingConfig(false)
      setLatestVersion(null)
      setError(null)
      setResult(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cfg.id])

  const handlePublish = async () => {
    setError(null)
    setVersionError(null)

    const connector = (cfg.raw as Record<string, unknown>).connector as Record<string, unknown> | undefined
    if (connector?.type === 'mcp' && connector?.transport === 'stdio') {
      if (!connector?.command) {
        setError('MCP configs require a start command (connector.command) before publishing')
        return
      }
    }

    setPhase('submitting')

    const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)

    try {
      const data = await api.post<PublishResult>('/registry/publish', {
        slug:        cfg.id,
        name:        cfg.name,
        description: description.trim(),
        category:    category.trim(),
        tags,
        visibility,
        message:     message.trim() || undefined,
        version:     version.trim() || undefined,
        payload:     buildPublishPayload(cfg),
      })
      setResult(data)
      setPhase('success')
      setTimeout(onClose, 2000)
    } catch (err) {
      setPhase('form')
      if (err instanceof ApiRequestError) {
        const code = err.data?.error
        if (code === 'no_changes') {
          setError('Nothing changed — no publish needed.')
        } else if (code === 'version_required' || code === 'version_not_forward') {
          setVersionError(err.data?.message ?? err.message)
        } else {
          setError(err.data?.error ?? err.message)
        }
      } else {
        setError((err as Error).message)
      }
    }
  }

  const successLabel = result
    ? result.action === 'created'  ? `Published v${result.version.version}`
    : result.action === 'versioned' ? `Updated to v${result.version.version}`
    : `Forked as ${result.config.qualified_slug}`
    : 'Published'

  return (
    <Modal open={open} onClose={onClose} title={`${isFork ? 'Fork' : 'Publish'} — ${cfg.name}`} width={520}>
      {phase === 'success' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 20px' }}>
          <CheckCircle size={32} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: '1rem', color: 'var(--text)', letterSpacing: '0.04em' }}>{successLabel}</span>
        </div>
      )}

      {(phase === 'form' || phase === 'submitting') && (
        <>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            {authUsername && (
              <div style={{ fontSize: '0.77rem', color: 'var(--text-dim)', letterSpacing: '0.03em' }}>
                Publishing as <code style={{ color: 'var(--accent)' }}>@{authUsername}</code>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Field
                label="Version"
                value={version}
                onChange={(v) => { setVersion(v); setVersionError(null) }}
                placeholder={isExistingConfig ? undefined : 'e.g. 1.0.0'}
                hint={latestVersion
                  ? `Published at v${latestVersion} — must be greater to push a new version`
                  : 'Not published yet — enter a starting version'
                }
              />
              {versionError && (
                <span style={{ fontSize: '0.77rem', color: 'var(--red)', letterSpacing: '0.03em' }}>{versionError}</span>
              )}
            </div>
            <Field label="Description" value={description} onChange={setDescription} placeholder="What does this config do?" />
            <Field label="Category" value={category} onChange={setCategory} placeholder="e.g. development, productivity, data" />
            <Field label="Tags" value={tagsRaw} onChange={setTagsRaw} placeholder="Comma-separated (optional)" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.69rem', color: 'var(--text-dim)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Visibility</label>
              <div style={{ display: 'flex', gap: 12 }}>
                {(['public', 'private'] as const).map((v) => (
                  <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text)' }}>
                    <input type="radio" name="visibility" value={v} checked={visibility === v} onChange={() => setVisibility(v)} />
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Changelog note" value={message} onChange={setMessage} placeholder="Optional note for this release" />
            {error && <div style={{ fontSize: '0.77rem', color: 'var(--red)', letterSpacing: '0.03em' }}>{error}</div>}
          </div>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={phase === 'submitting'}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void handlePublish()} disabled={phase === 'submitting'}>
              {phase === 'submitting'
                ? <><Loader2 size={10} style={{ marginRight: 5, animation: 'spin 1s linear infinite' }} />{isFork ? 'Forking…' : 'Publishing…'}</>
                : isFork
                  ? <><GitFork size={10} style={{ marginRight: 5 }} />Fork</>
                  : <><Upload size={10} style={{ marginRight: 5 }} />Publish</>
              }
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
