import { useState, useEffect } from 'react'
import { ArrowLeft, Star, Download, ShieldCheck, Loader2, Package, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/components/ui/Toast'
import { api, ApiRequestError } from '@/lib/api'
import type { RegistryConfigMeta, RegistryUpdateInfo, ConfigPayload, ConfigPayloadTool } from '@/types/registry'

const CONNECTOR_LABELS: Record<string, string> = {
  http: 'HTTP', cli: 'CLI', file: 'File', grpc: 'gRPC', graphql: 'GraphQL', mcp: 'MCP',
}

const SEVERITY_COLORS: Record<string, string> = {
  patch: 'var(--accent)',
  minor: 'var(--yellow)',
  major: 'var(--red)',
}

interface RegistryDetailProps {
  config: RegistryConfigMeta
  registry: string
  isInstalled: boolean
  updateInfo?: RegistryUpdateInfo
  onInstall: (args: {
    namespace: string
    slug: string
    connector_type: string
    version?: string
    overwrite?: boolean
  }) => Promise<void>
  onUninstall: (qualifiedSlug: string) => Promise<void>
  onBack: () => void
}

export function RegistryDetail({
  config,
  registry,
  isInstalled,
  updateInfo,
  onInstall,
  onUninstall,
  onBack,
}: RegistryDetailProps) {
  const [installing, setInstalling] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)
  const [tools, setTools] = useState<ConfigPayloadTool[]>([])
  const [loadingTools, setLoadingTools] = useState(true)
  const [selectedTool, setSelectedTool] = useState<string | null>(null)

  useEffect(() => {
    setLoadingTools(true)
    setTools([])
    setSelectedTool(null)
    api.get<ConfigPayload>(
      `/registry/payload/${encodeURIComponent(config.namespace)}/${encodeURIComponent(config.slug)}` +
      `?connector_type=${encodeURIComponent(config.connector_type)}&registry=${encodeURIComponent(registry)}`
    ).then((payload) => {
      const overlays = payload.registry_overlays ?? {}
      const resolved = (payload.tools ?? [])
        .filter((t) => overlays[t.name]?.active !== false)
        .map((t) => {
          const ov = overlays[t.name]
          if (!ov) return t
          return {
            ...t,
            description: ov.description ?? t.description,
            params: (t.params ?? []).map((p) => ({
              ...p,
              description: ov.params?.[p.name]?.description ?? p.description,
            })),
          }
        })
      setTools(resolved)
      if (resolved.length > 0) setSelectedTool(resolved[0].name)
    }).catch(() => {
      // non-critical
    }).finally(() => {
      setLoadingTools(false)
    })
  }, [config.namespace, config.slug, config.connector_type, registry])

  const selectedToolData = tools.find((t) => t.name === selectedTool) ?? null

  const handleInstall = async (version?: string, overwrite = false) => {
    setInstalling(true)
    try {
      await onInstall({
        namespace:      config.namespace,
        slug:           config.slug,
        connector_type: config.connector_type,
        version,
        overwrite,
      })
      toast.success(`Installed ${config.name}`)
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409 && !overwrite) {
        if (window.confirm(`${config.qualified_slug} is already installed. Reinstall and overwrite?`)) {
          setInstalling(false)
          return handleInstall(version, true)
        }
        setInstalling(false)
        return
      }
      const msg = err instanceof ApiRequestError ? (err.data?.error ?? err.message) : (err as Error).message
      toast.error(`Install failed: ${msg}`)
    } finally {
      setInstalling(false)
    }
  }

  const handleUninstall = async () => {
    setUninstalling(true)
    try {
      await onUninstall(config.qualified_slug)
      toast.success(`Uninstalled ${config.name}`)
    } catch (err) {
      toast.error(`Uninstall failed: ${(err as Error).message}`)
    } finally {
      setUninstalling(false)
    }
  }

  const connectorLabel = CONNECTOR_LABELS[config.connector_type] ?? config.connector_type

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{
        height: 42, background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 16px', flexShrink: 0, gap: 10,
      }}>
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft size={12} style={{ marginRight: 5 }} />
          Back
        </Button>
        <span style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--text-dim)' }}>
          <span style={{ color: 'var(--accent)' }}>registry</span> / {config.namespace} / {config.slug}
        </span>
      </div>

      {/* Meta section — scrollable, shrinks to content */}
      <div style={{ overflowY: 'auto', padding: '20px 24px 16px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 9,
            background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Package size={20} style={{ color: 'var(--accent)' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 2 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
                {config.name}
              </h2>
              {config.verified && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ShieldCheck size={13} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontSize: 9, color: 'var(--accent)', letterSpacing: '0.06em', fontWeight: 600 }}>VERIFIED</span>
                </span>
              )}
              {config.deprecated && <Badge variant="warn">deprecated</Badge>}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
              {config.namespace}/{config.slug}
            </div>
          </div>

          {/* Action buttons inline with title */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {!isInstalled && (
              <Button variant="primary" size="sm" onClick={() => void handleInstall()} disabled={installing}>
                {installing
                  ? <><Loader2 size={11} style={{ marginRight: 5, animation: 'spin 1s linear infinite' }} />Installing…</>
                  : <>Install {config.latest_version?.version ? `v${config.latest_version.version}` : ''}</>
                }
              </Button>
            )}
            {isInstalled && updateInfo && (
              <Button variant="primary" size="sm" onClick={() => void handleInstall(updateInfo.latest_version, true)} disabled={installing}>
                {installing
                  ? <><Loader2 size={11} style={{ marginRight: 5, animation: 'spin 1s linear infinite' }} />Updating…</>
                  : <>Update to v{updateInfo.latest_version}</>
                }
              </Button>
            )}
            {isInstalled && !updateInfo && (
              <Button variant="ghost" size="sm" disabled style={{ opacity: 0.6, cursor: 'default' }}>
                ✓ Installed
              </Button>
            )}
            {isInstalled && (
              <Button variant="ghost" size="sm" onClick={() => void handleUninstall()} disabled={uninstalling}>
                {uninstalling
                  ? <><Loader2 size={11} style={{ marginRight: 5, animation: 'spin 1s linear infinite' }} />Removing…</>
                  : 'Uninstall'
                }
              </Button>
            )}
          </div>
        </div>

        {config.description && (
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.6, letterSpacing: '0.01em' }}>
            {config.description}
          </p>
        )}

        {/* Stats + meta row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-dim)', fontSize: 10 }}>
            <Star size={10} /> {(config.stars ?? 0).toLocaleString()} stars
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-dim)', fontSize: 10 }}>
            <Download size={10} /> {(config.installs ?? 0).toLocaleString()} installs
          </span>
          <span style={{
            fontSize: 9, padding: '1px 7px', borderRadius: 99,
            background: 'var(--surface2)', color: 'var(--text-dim)', letterSpacing: '0.06em',
          }}>
            {connectorLabel}
          </span>
          {config.category && (
            <span style={{
              fontSize: 9, padding: '1px 7px', borderRadius: 99,
              background: 'var(--surface2)', color: 'var(--text-dim)', letterSpacing: '0.06em',
            }}>
              {config.category}
            </span>
          )}
          {config.latest_version && (
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              v{config.latest_version.version}
              <span style={{ marginLeft: 6, color: 'var(--text-dim)', opacity: 0.6 }}>
                · {new Date(config.latest_version.created_at).toLocaleDateString()}
              </span>
            </span>
          )}
          {(config.tags?.length ?? 0) > 0 && config.tags!.map((tag) => (
            <span key={tag} style={{
              fontSize: 9, padding: '1px 7px', borderRadius: 99,
              background: 'var(--accent-dim)', color: 'var(--accent)', letterSpacing: '0.06em',
            }}>
              {tag}
            </span>
          ))}
        </div>

        {/* Update banner */}
        {updateInfo && (
          <div style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 6,
            background: 'rgba(254,188,46,0.06)', border: '1px solid rgba(254,188,46,0.25)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                color: SEVERITY_COLORS[updateInfo.severity] ?? 'var(--yellow)', textTransform: 'uppercase',
              }}>
                {updateInfo.severity} update available
              </span>
              {updateInfo.breaking && <Badge variant="error">breaking</Badge>}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              {updateInfo.installed_version} → {updateInfo.latest_version}
              {updateInfo.changelog && <span style={{ marginLeft: 8 }}>· {updateInfo.changelog}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Tools master/detail split — fills remaining height */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* Left: tool list */}
        <div style={{
          width: 220, flexShrink: 0,
          overflowY: 'auto',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            padding: '10px 14px 8px',
            fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-dim)',
            textTransform: 'uppercase', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 5,
            borderBottom: '1px solid var(--border)',
          }}>
            <Wrench size={9} />
            Tools
            {!loadingTools && (
              <span style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 99,
                background: 'var(--surface2)', color: 'var(--text-dim)',
                letterSpacing: '0.04em', marginLeft: 3,
              }}>
                {tools.length}
              </span>
            )}
          </div>

          {loadingTools && (
            <div style={{ padding: '16px 14px', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-dim)', fontSize: 11 }}>
              <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
              Loading…
            </div>
          )}

          {!loadingTools && tools.length === 0 && (
            <div style={{ padding: '16px 14px', fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
              No tools defined.
            </div>
          )}

          {!loadingTools && tools.map((tool) => {
            const active = selectedTool === tool.name
            const paramCount = tool.params?.length ?? 0
            return (
              <button
                key={tool.name}
                onClick={() => setSelectedTool(tool.name)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '7px 14px',
                  background: active ? 'var(--accent-dim)' : 'transparent',
                  border: 'none',
                  borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  cursor: 'pointer', textAlign: 'left', flexShrink: 0,
                }}
              >
                <span style={{
                  fontSize: 10, fontFamily: 'var(--font-mono, monospace)',
                  color: active ? 'var(--accent)' : 'var(--text)',
                  fontWeight: active ? 600 : 400,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {tool.name}
                </span>
                {paramCount > 0 && (
                  <span style={{
                    fontSize: 9, color: 'var(--text-dim)', flexShrink: 0, marginLeft: 6,
                  }}>
                    {paramCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Right: tool detail */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
          {!selectedToolData && !loadingTools && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
              Select a tool from the list.
            </div>
          )}

          {selectedToolData && (
            <>
              <div style={{
                fontSize: 14, fontWeight: 700,
                fontFamily: 'var(--font-mono, monospace)',
                color: 'var(--accent)', marginBottom: 8, letterSpacing: '0.02em',
              }}>
                {selectedToolData.name}
              </div>

              {selectedToolData.description && (
                <p style={{ margin: '0 0 20px', fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.65 }}>
                  {selectedToolData.description}
                </p>
              )}

              {(selectedToolData.params?.length ?? 0) > 0 ? (
                <>
                  <div style={{
                    fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-dim)',
                    textTransform: 'uppercase', marginBottom: 14,
                  }}>
                    Parameters
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {selectedToolData.params!.map((param) => (
                      <div key={param.name} style={{
                        paddingBottom: 14,
                        borderBottom: '1px solid var(--border)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{
                            fontSize: 11, fontFamily: 'var(--font-mono, monospace)',
                            fontWeight: 600, color: 'var(--text)',
                          }}>
                            {param.name}
                          </span>
                          {param.type && (
                            <span style={{
                              fontSize: 9, fontFamily: 'var(--font-mono, monospace)',
                              color: 'var(--text-dim)', background: 'var(--surface2)',
                              padding: '1px 5px', borderRadius: 3,
                            }}>
                              {param.type}
                            </span>
                          )}
                          {param.required && (
                            <span style={{
                              fontSize: 9, color: 'var(--red, #f87171)',
                              letterSpacing: '0.06em', fontWeight: 600,
                            }}>
                              required
                            </span>
                          )}
                        </div>
                        {param.description && (
                          <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.55 }}>
                            {param.description}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  No parameters.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
