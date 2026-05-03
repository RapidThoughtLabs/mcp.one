import { useRef } from 'react'
import { Copy } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'
import type { PromptLayer } from '@/lib/chat-engine'
import { countTokens, formatTokenCount } from './lib/token-count'

export type GravityKind = 'foundation' | 'discovery' | undefined

interface LayerCardProps {
  layer: PromptLayer
  index: number
  gravity?: GravityKind
}

export function LayerCard({ layer, index, gravity }: LayerCardProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const tokenCount = countTokens(layer.content)

  const borderColor = gravity ? 'var(--accent)' : 'var(--border)'
  const borderWidth = gravity ? '1.5px' : '1px'
  const boxShadow = gravity ? 'var(--glow)' : 'none'

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(layer.content)
      toast.success(`Copied · ${layer.name}`)
    } catch {
      const pre = preRef.current
      if (pre) {
        const sel = window.getSelection()
        const range = document.createRange()
        range.selectNodeContents(pre)
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
    }
  }

  return (
    <div
      style={{
        border: `${borderWidth} solid ${borderColor}`,
        borderRadius: 6,
        background: 'var(--surface)',
        boxShadow,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.1em',
            color: 'var(--text-dim)',
            background: 'var(--border)',
            padding: '2px 7px',
            borderRadius: 3,
          }}
        >
          LAYER {index}
        </span>

        {gravity === 'foundation' && (
          <Badge variant="online">LAYER 1 · FOUNDATION</Badge>
        )}
        {gravity === 'discovery' && (
          <Badge variant="online">DISCOVERY ↑ ABOVE one.*</Badge>
        )}

        <span style={{ fontSize: 11, color: 'var(--text)', letterSpacing: '0.04em', flex: 1, minWidth: 0 }}>
          {layer.name}
        </span>

        {layer.tags.map((tag) => (
          <Badge key={tag} variant="offline">{tag}</Badge>
        ))}

        <span
          style={{
            fontSize: 9,
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--text-dim)',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}
        >
          {formatTokenCount(tokenCount)} tok
        </span>

        <Button size="xs" variant="ghost" onClick={handleCopy} title="Copy layer content">
          <Copy size={11} />
        </Button>
      </div>

      {/* Description */}
      {layer.description && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-dim)',
            padding: '6px 14px 0',
            letterSpacing: '0.02em',
            lineHeight: 1.5,
          }}
        >
          {layer.description}
        </div>
      )}

      {/* Content */}
      <pre
        ref={preRef}
        style={{
          margin: 0,
          padding: '10px 14px 14px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          lineHeight: 1.7,
          color: 'var(--text-mid)',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {layer.content}
      </pre>
    </div>
  )
}
