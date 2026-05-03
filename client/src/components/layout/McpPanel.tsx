import { useState } from 'react'
import { ChevronRight, Zap, WifiOff, Loader2, LogOut } from 'lucide-react'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import type { McpTool } from '@/types/server'

const CONNECTOR_COLORS: Record<string, { bg: string; text: string }> = {
  http:     { bg: 'rgba(56, 189, 248, 0.15)', text: '#38bdf8' },
  stdio:    { bg: 'rgba(74, 222, 128, 0.15)', text: '#4ade80' },
  sse:      { bg: 'rgba(251, 146, 60, 0.15)',  text: '#fb923c' },
  graphql:  { bg: 'rgba(225, 0, 152, 0.15)',   text: '#e10098' },
  grpc:     { bg: 'rgba(161, 110, 255, 0.15)', text: '#a16eff' },
  internal: { bg: 'rgba(148, 163, 184, 0.12)', text: '#94a3b8' },
  sql:      { bg: 'rgba(99, 102, 241, 0.15)',  text: '#818cf8' },
}

// Group flat tool list by configId
function groupByConfig(tools: McpTool[]): Map<string, McpTool[]> {
  const map = new Map<string, McpTool[]>()
  for (const tool of tools) {
    const group = map.get(tool.configId) ?? []
    group.push(tool)
    map.set(tool.configId, group)
  }
  return map
}

export function McpPanel() {
  const { tools, configs, serverStatus, connectedEndpoint, setConnectedEndpoint, setTools, setToolCount, setServerStatus } = useAppStore()
  const configTypeMap = new Map(configs.map((c) => [c.id, c.connector.type]))
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())

  async function handleDisconnect() {
    try {
      await api.post('/disconnect', {})
    } catch { /* best-effort */ }
    setTools([])
    setToolCount(0)
    setServerStatus('offline')
    setConnectedEndpoint(null)
  }

  const groups = groupByConfig(tools)
  const totalTools = tools.length

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleTool = (toolName: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev)
      if (next.has(toolName)) next.delete(toolName)
      else next.add(toolName)
      return next
    })
  }

  return (
    <div
      style={{
        width: 300,
        minWidth: 260,
        flexShrink: 0,
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 42,
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
          borderBottom: '1px solid var(--border)',
          gap: 8,
          flexShrink: 0,
        }}
      >
        {serverStatus === 'connecting' ? (
          <Loader2
            size={12}
            style={{ color: 'var(--yellow)', animation: 'spin 1s linear infinite' }}
          />
        ) : (
          <Zap size={12} style={{ color: 'var(--text-dim)' }} />
        )}
        <span style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)', flex: 1 }}>
          MCP TOOLS
        </span>
        <span
          style={{
            fontSize: 9,
            color: totalTools > 0 ? 'var(--accent)' : 'var(--text-dim)',
            letterSpacing: '0.08em',
            background: totalTools > 0 ? 'var(--accent-dim)' : 'var(--surface2)',
            padding: '2px 8px',
            borderRadius: 99,
            fontWeight: 600,
          }}
        >
          {totalTools} tools
        </span>
      </div>

      {/* Tool groups or empty state */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '6px 0' }}>
        {serverStatus === 'offline' && tools.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '40px 20px',
              color: 'var(--text-dim)',
            }}
          >
            <WifiOff size={24} style={{ opacity: 0.3 }} />
            <span style={{ fontSize: 10, letterSpacing: '0.06em', textAlign: 'center', lineHeight: 1.6 }}>
              Server offline.<br />
              Run <code style={{ background: 'var(--surface2)', padding: '1px 5px', borderRadius: 3, fontSize: 10 }}>npm run dev</code>
            </span>
          </div>
        ) : serverStatus === 'connecting' && tools.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '40px 20px',
              color: 'var(--text-dim)',
            }}
          >
            <Loader2 size={24} style={{ opacity: 0.3, animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 10, letterSpacing: '0.06em' }}>Connecting to mcp-one...</span>
          </div>
        ) : tools.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '40px 20px',
              color: 'var(--text-dim)',
            }}
          >
            <Zap size={24} style={{ opacity: 0.2 }} />
            <span style={{ fontSize: 10, letterSpacing: '0.06em', textAlign: 'center', lineHeight: 1.6 }}>
              No tools loaded.<br />Add a config to get started.
            </span>
          </div>
        ) : (
          Array.from(groups.entries()).map(([configId, groupTools]) => {
            const isOpen = openGroups.has(configId)
            const connectorType = configTypeMap.get(configId) ?? null
            const suffix = connectorType ? `-${connectorType}` : null
            const baseName = (suffix && configId.endsWith(suffix))
              ? configId.slice(0, -suffix.length)
              : configId
            const displayName = baseName.charAt(0).toUpperCase() + baseName.slice(1).replace(/-/g, ' ')
            const connectorStyle = connectorType ? (CONNECTOR_COLORS[connectorType] ?? null) : null

            return (
              <div key={configId} style={{ borderBottom: '1px solid var(--border)' }}>
                {/* Group header — semantic button for keyboard + screen reader support */}
                <button
                  onClick={() => toggleGroup(configId)}
                  aria-expanded={isOpen}
                  aria-controls={`group-${configId}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 14px',
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                    userSelect: 'none',
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--surface2)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <ChevronRight
                    size={9}
                    style={{
                      color: 'var(--text-dim)',
                      transition: 'transform 0.2s',
                      transform: isOpen ? 'rotate(90deg)' : 'none',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
                      <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, letterSpacing: '0.02em' }}>
                        {displayName}
                      </span>
                      {connectorStyle && connectorType && (
                        <span style={{
                          fontSize: 8,
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                          padding: '3px 8px',
                          borderRadius: 99,
                          background: connectorStyle.bg,
                          color: connectorStyle.text,
                          flexShrink: 0,
                          textTransform: 'uppercase',
                        }}>
                          {connectorType}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.02em', marginTop: 2 }}>
                      {configId}
                    </div>
                  </div>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      border: '2px solid hsla(var(--accent-h), var(--accent-s), var(--accent-l), 0.5)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      fontWeight: 700,
                      color: 'var(--accent)',
                      flexShrink: 0,
                    }}
                  >
                    {groupTools.length}
                  </div>
                </button>

                {/* Tool list */}
                {isOpen && (
                  <div id={`group-${configId}`} style={{ padding: '0 10px 8px 20px' }}>
                    {groupTools.map((tool) => {
                      const shortName = tool.name.includes('.')
                        ? tool.name.slice(tool.name.indexOf('.') + 1)
                        : tool.name
                      const isToolExpanded = expandedTools.has(tool.name)

                      return (
                        <button
                          key={tool.name}
                          onClick={() => tool.description && toggleTool(tool.name)}
                          aria-expanded={tool.description ? isToolExpanded : undefined}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 8,
                            padding: '6px 4px',
                            fontSize: 10,
                            color: 'var(--text-dim)',
                            letterSpacing: '0.04em',
                            cursor: tool.description ? 'pointer' : 'default',
                            transition: 'color 0.1s',
                            width: '100%',
                            background: 'transparent',
                            border: 'none',
                            textAlign: 'left',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = 'var(--text-mid)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = 'var(--text-dim)'
                          }}
                        >
                          <div
                            style={{
                              width: 4,
                              height: 4,
                              borderRadius: '50%',
                              background: 'var(--accent)',
                              flexShrink: 0,
                              marginTop: 4,
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{shortName}</span>
                              {tool.description && (
                                <ChevronRight
                                  size={8}
                                  style={{
                                    color: 'var(--text-dim)',
                                    flexShrink: 0,
                                    transition: 'transform 0.15s',
                                    transform: isToolExpanded ? 'rotate(90deg)' : 'none',
                                    opacity: 0.6,
                                  }}
                                />
                              )}
                            </div>
                            {tool.description && (
                              <div
                                style={{
                                  fontSize: 9,
                                  color: 'var(--text-dim)',
                                  marginTop: 3,
                                  lineHeight: 1.5,
                                  opacity: 0.8,
                                  // Only clamp when collapsed
                                  ...(isToolExpanded
                                    ? {}
                                    : {
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical' as const,
                                        overflow: 'hidden',
                                      }),
                                }}
                              >
                                {tool.description}
                              </div>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '8px 14px',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        {/* Endpoint label */}
        {connectedEndpoint && (
          <div style={{
            fontSize: 9,
            color: 'var(--text-dim)',
            letterSpacing: '0.04em',
            marginBottom: 6,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {connectedEndpoint}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.06em', flex: 1 }}>
            <strong style={{ color: 'var(--accent)' }}>{totalTools}</strong> tools ·{' '}
            <strong style={{ color: 'var(--accent)' }}>{groups.size}</strong> configs
          </span>
          <span
            style={{
              fontSize: 9,
              padding: '2px 8px',
              borderRadius: 99,
              letterSpacing: '0.06em',
              background:
                serverStatus === 'online'
                  ? 'var(--accent-dim)'
                  : serverStatus === 'connecting'
                  ? 'rgba(255,200,0,0.1)'
                  : 'var(--surface2)',
              color:
                serverStatus === 'online'
                  ? 'var(--accent)'
                  : serverStatus === 'connecting'
                  ? 'var(--yellow)'
                  : 'var(--text-dim)',
            }}
          >
            {serverStatus}
          </span>
          <button
            onClick={() => { void handleDisconnect() }}
            title="Disconnect from server"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              borderRadius: 4,
              padding: 0,
              transition: 'color 0.1s, background 0.1s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--red)'
              e.currentTarget.style.background = 'rgba(255,95,87,0.1)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-dim)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <LogOut size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}
