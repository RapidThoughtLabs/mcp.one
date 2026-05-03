import { useRef } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'
import { countTokens, formatTokenCount } from './lib/token-count'

interface ComposedPromptCardProps {
  composedText: string
  handshakeTokens: number
}

export function ComposedPromptCard({ composedText, handshakeTokens }: ComposedPromptCardProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const promptTokens = countTokens(composedText)
  const totalTokens = promptTokens + handshakeTokens

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(composedText)
      toast.success('Copied · composed system prompt')
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
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--bg)',
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
        <span style={{ fontSize: 11, color: 'var(--text)', letterSpacing: '0.04em', flex: 1 }}>
          Composed system prompt
        </span>

        <div
          style={{
            fontSize: 9,
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--accent)',
            letterSpacing: '0.04em',
            background: 'var(--accent-dim)',
            padding: '2px 8px',
            borderRadius: 3,
            whiteSpace: 'nowrap',
          }}
          title={`prompt ${formatTokenCount(promptTokens)} + tools ${formatTokenCount(handshakeTokens)}`}
        >
          Σ {formatTokenCount(totalTokens)} tok
        </div>

        <span
          style={{
            fontSize: 9,
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--text-dim)',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}
        >
          prompt {formatTokenCount(promptTokens)} + tools {formatTokenCount(handshakeTokens)}
        </span>

        <Button size="xs" variant="ghost" onClick={handleCopy} title="Copy composed prompt">
          <Copy size={11} />
        </Button>
      </div>

      {/* Description */}
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-dim)',
          padding: '6px 14px 0',
          letterSpacing: '0.02em',
          lineHeight: 1.5,
        }}
      >
        All layers joined with <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>---</code> separators, variables substituted. This is the exact text sent as the system message at the start of each conversation.
      </div>

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
        {composedText || '// select a template'}
      </pre>

      {/* Footer disclaimer */}
      <div
        style={{
          fontSize: 9,
          color: 'var(--text-dim)',
          padding: '0 14px 10px',
          letterSpacing: '0.04em',
          opacity: 0.6,
        }}
      >
        Token counts approximated via cl100k_base (OpenAI tokenizer). Actual provider counts may differ ±10–20%.
      </div>
    </div>
  )
}
