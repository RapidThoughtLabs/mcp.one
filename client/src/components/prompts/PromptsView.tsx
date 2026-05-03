import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import {
  composeSystemPrompt,
  buildConfigCatalog,
  type PromptLayer,
} from '@/lib/chat-engine'
import type { ConfigSummary } from '@/types/server'
import promptData from '@/prompts/default.json'
import { TemplatePicker } from './TemplatePicker'
import { LayerCard, type GravityKind } from './LayerCard'
import { HandshakeCard } from './HandshakeCard'
import { ComposedPromptCard } from './ComposedPromptCard'

function gravityFor(layer: PromptLayer, index: number): GravityKind {
  if (layer.required || index === 0) return 'foundation'
  if (layer.id === 'progressive-discovery') return 'discovery'
  return undefined
}

export function PromptsView() {
  const [activeTemplateId, setActiveTemplateId] = useState('default')
  const [composedText, setComposedText] = useState('')
  const [handshakeTokens, setHandshakeTokens] = useState(0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pf = promptData as any

  const buildComposed = useCallback(async (templateId: string) => {
    try {
      const configs = await api.get<ConfigSummary[]>('/configs')
      const catalog = buildConfigCatalog(
        configs.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          connector_type: c.connector?.type ?? 'unknown',
          tool_count: c.toolCount,
        })),
      )
      setComposedText(composeSystemPrompt(pf, templateId, { config_catalog: catalog }))
    } catch {
      setComposedText(composeSystemPrompt(pf, templateId, { config_catalog: '(no configs installed yet)' }))
    }
  }, [pf])

  useEffect(() => {
    void buildComposed(activeTemplateId)
  }, [activeTemplateId, buildComposed])

  const activeTemplate = pf.templates.find((t: { id: string }) => t.id === activeTemplateId) ?? pf.templates[0]

  // Deduplicate layers in same order as composeSystemPrompt
  const requiredIds = (pf.layers as PromptLayer[]).filter((l) => l.required).map((l) => l.id)
  const allIds: string[] = [...new Set([...requiredIds, ...(activeTemplate?.layers ?? [])])]
  const activeLayers = allIds
    .map((id: string) => (pf.layers as PromptLayer[]).find((l) => l.id === id))
    .filter((l): l is PromptLayer => l !== undefined)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Topbar */}
      <div
        style={{
          height: 42,
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          flexShrink: 0,
          gap: 10,
        }}
      >
        <span style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)' }}>
          <span style={{ color: 'var(--accent)' }}>mcp.one</span> / prompts
        </span>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 9,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.08em',
            color: 'var(--accent)',
            background: 'var(--accent-dim)',
            padding: '2px 8px',
            borderRadius: 3,
          }}
        >
          {activeTemplate?.name ?? activeTemplateId}
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <TemplatePicker
          templates={pf.templates}
          activeId={activeTemplateId}
          onSelect={setActiveTemplateId}
        />

        {/* Right pane */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <ComposedPromptCard
            composedText={composedText}
            handshakeTokens={handshakeTokens}
          />

          <HandshakeCard onTokenCount={setHandshakeTokens} />

          {activeLayers.map((layer, i) => (
            <LayerCard
              key={layer.id}
              layer={layer}
              index={i + 1}
              gravity={gravityFor(layer, i)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
