import { Badge } from '@/components/ui/Badge'
import type { PromptTemplate } from '@/lib/chat-engine'

interface TemplatePickerProps {
  templates: PromptTemplate[]
  activeId: string
  onSelect: (id: string) => void
}

export function TemplatePicker({ templates, activeId, onSelect }: TemplatePickerProps) {
  return (
    <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
      <div
        style={{
          fontSize: 9,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
          padding: '14px 18px 6px',
        }}
      >
        Templates
      </div>

      {templates.map((tpl) => {
        const isActive = tpl.id === activeId
        return (
          <button
            key={tpl.id}
            onClick={() => onSelect(tpl.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 4,
              padding: '9px 18px',
              width: '100%',
              textAlign: 'left',
              background: isActive ? 'var(--accent-dim)' : 'transparent',
              borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
              borderTop: 'none',
              borderRight: 'none',
              borderBottom: 'none',
              color: isActive ? 'var(--accent)' : 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'all 0.12s',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = 'var(--text-mid)'
                e.currentTarget.style.background = 'var(--surface2)'
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = 'var(--text-dim)'
                e.currentTarget.style.background = 'transparent'
              }
            }}
          >
            <span style={{ fontSize: 11, letterSpacing: '0.04em' }}>{tpl.name}</span>
            <span style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.5, letterSpacing: '0.02em' }}>
              {tpl.description}
            </span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {tpl.tags.map((tag) => (
                <Badge key={tag} variant="offline">{tag}</Badge>
              ))}
              <Badge variant="offline">{tpl.layers.length} layer{tpl.layers.length !== 1 ? 's' : ''}</Badge>
            </div>
          </button>
        )
      })}
    </div>
  )
}
