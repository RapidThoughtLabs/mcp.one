import { Star, Download, ShieldCheck, ArrowUp } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import type { RegistryConfigMeta, RegistryUpdateInfo } from '@/types/registry'

const CONNECTOR_LABELS: Record<string, string> = {
  http: 'HTTP', cli: 'CLI', file: 'File', grpc: 'gRPC', graphql: 'GraphQL', mcp: 'MCP',
}

interface RegistryCardProps {
  config: RegistryConfigMeta
  isInstalled: boolean
  updateInfo?: RegistryUpdateInfo
  onClick: () => void
}

export function RegistryCard({ config, isInstalled, updateInfo, onClick }: RegistryCardProps) {
  const connectorLabel = CONNECTOR_LABELS[config.connector_type] ?? config.connector_type

  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        padding: 0,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--border2)'
        e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.2)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* Accent bar */}
      <div style={{ height: 2, background: 'var(--accent)', opacity: 0.7 }} />

      <div style={{ padding: '12px 14px' }}>
        {/* Top row: name + status badges */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '0.92rem', fontWeight: 600, color: 'var(--text)',
              letterSpacing: '0.04em', marginBottom: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {config.name}
            </div>
            <div style={{ fontSize: '0.77rem', color: 'var(--text-dim)', letterSpacing: '0.02em' }}>
              {config.namespace}/{config.slug}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {updateInfo && (
              <Badge variant="warn">
                <ArrowUp size={8} style={{ marginRight: 3 }} />
                update
              </Badge>
            )}
            {isInstalled && !updateInfo && (
              <Badge variant="success">installed</Badge>
            )}
          </div>
        </div>

        {/* Description */}
        {config.description && (
          <div style={{
            fontSize: '0.77rem', color: 'var(--text-dim)', lineHeight: 1.55,
            letterSpacing: '0.02em', marginBottom: 10,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {config.description}
          </div>
        )}

        {/* Bottom row: connector, stats, verified */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '0.69rem', padding: '4px 7px', borderRadius: 99,
            background: 'var(--surface2)', color: 'var(--text-dim)',
            letterSpacing: '0.06em', flexShrink: 0,
          }}>
            {connectorLabel}
          </span>

          {config.verified && (
            <span title="Verified" style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
              <ShieldCheck size={11} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: '0.69rem', color: 'var(--accent)', letterSpacing: '0.04em' }}>verified</span>
            </span>
          )}

          <div style={{ flex: 1 }} />

          <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-dim)', fontSize: '0.77rem' }}>
            <Star size={10} />
            {(config.stars ?? 0).toLocaleString()}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-dim)', fontSize: '0.77rem' }}>
            <Download size={10} />
            {(config.installs ?? 0).toLocaleString()}
          </span>
        </div>

        {/* Tags */}
        {(config.tags?.length ?? 0) > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
            {config.tags!.slice(0, 3).map((tag) => (
              <span key={tag} style={{
                fontSize: '0.62rem', padding: '3px 6px', borderRadius: 99,
                background: 'var(--accent-dim)', color: 'var(--accent)',
                letterSpacing: '0.06em',
              }}>
                {tag}
              </span>
            ))}
            {config.tags!.length > 3 && (
              <span style={{ fontSize: '0.62rem', color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
                +{config.tags!.length - 3} more
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}
