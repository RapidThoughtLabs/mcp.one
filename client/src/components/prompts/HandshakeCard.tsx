import { useEffect, useRef, useState } from 'react'
import { Copy, Plug } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'
import { api } from '@/lib/api'
import type { McpTool } from '@/types/server'
import { countJsonTokens, formatTokenCount } from './lib/token-count'

// Static fallback: what one.* tools look like if server is offline
const FALLBACK_TOOLS: McpTool[] = [
  { name: 'one.list_configs', description: '[one] List all installed MCP configs with their connector types and tool counts', inputSchema: { type: 'object', properties: {} }, configId: 'one' },
  { name: 'one.list_tools', description: '[one] List all tools for a specific config', inputSchema: { type: 'object', properties: { config_id: { type: 'string' } }, required: ['config_id'] }, configId: 'one' },
  { name: 'one.get_tool', description: '[one] Get the full schema for a specific tool by its qualified name', inputSchema: { type: 'object', properties: { qualified_name: { type: 'string' } }, required: ['qualified_name'] }, configId: 'one' },
  { name: 'one.search', description: '[one] Search for tools across all installed configs by intent or keyword', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, configId: 'one' },
]

function toHandshakeShape(tools: McpTool[]) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }))
}

interface HandshakeCardProps {
  onTokenCount?: (n: number) => void
}

export function HandshakeCard({ onTokenCount }: HandshakeCardProps) {
  const [tools, setTools] = useState<McpTool[]>([])
  const [loading, setLoading] = useState(true)
  const [isFallback, setIsFallback] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    api.get<McpTool[]>('/tools/manifest')
      .then((manifest) => {
        setTools(manifest.length > 0 ? manifest : FALLBACK_TOOLS)
        setIsFallback(manifest.length === 0)
      })
      .catch(() => {
        setTools(FALLBACK_TOOLS)
        setIsFallback(true)
      })
      .finally(() => setLoading(false))
  }, [])

  const handshakeJson = toHandshakeShape(tools)
  const jsonText = JSON.stringify(handshakeJson, null, 2)
  const tokenCount = countJsonTokens(handshakeJson)

  useEffect(() => {
    onTokenCount?.(tokenCount)
  }, [tokenCount, onTokenCount])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(jsonText)
      toast.success('Copied · tools/list')
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
        background: 'var(--surface)',
        overflow: 'hidden',
        flexShrink: 0,
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
        <Plug size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--text)', letterSpacing: '0.04em', flex: 1 }}>
          tools/list handshake
        </span>
        <Badge variant="offline">HANDSHAKE · tools/list</Badge>
        {isFallback && <Badge variant="warn">offline fallback</Badge>}
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
        <Button size="xs" variant="ghost" onClick={handleCopy} title="Copy handshake JSON">
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
        The tool inventory the LLM receives on connect. After lazy-discovery mode, only{' '}
        <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>one.*</code>{' '}
        tools are advertised — service tools are discovered on demand.
      </div>

      {/* JSON body */}
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
          whiteSpace: 'pre',
          opacity: loading ? 0.5 : 1,
          transition: 'opacity 0.2s',
        }}
      >
        {loading ? '// loading...' : jsonText}
      </pre>
    </div>
  )
}
