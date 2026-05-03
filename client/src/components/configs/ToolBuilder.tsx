import { useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ParamBuilder, type ParamRow } from './ParamBuilder'

export interface ToolRow {
  id: string
  name: string
  description: string
  // HTTP
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  // CLI
  command: string
  output_as: 'text' | 'json'
  // File
  operation: 'read' | 'write' | 'append' | 'delete' | 'list'
  path_template: string
  // gRPC
  service: string
  rpc_method: string
  // GraphQL
  query: string
  // SQL
  sql: string
  maxRowsStr: string
  timeoutMsStr: string
  // Common
  params: ParamRow[]
}

export function newTool(): ToolRow {
  return {
    id: Math.random().toString(36).slice(2),
    name: '', description: '',
    method: 'GET', path: '',
    command: '', output_as: 'json',
    operation: 'read', path_template: '',
    service: '', rpc_method: '',
    query: '',
    sql: '', maxRowsStr: '', timeoutMsStr: '',
    params: [],
  }
}

interface ToolBuilderProps {
  tools: ToolRow[]
  onChange: (tools: ToolRow[]) => void
  connectorType: string
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

const inputStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '6px 9px',
  fontSize: 11,
  color: 'var(--text)',
  fontFamily: 'inherit',
  outline: 'none',
  letterSpacing: '0.02em',
  width: '100%',
  transition: 'border-color 0.12s',
}

const labelStyle: React.CSSProperties = {
  fontSize: 9,
  color: 'var(--text-dim)',
  letterSpacing: '0.07em',
}

function ToolItem({
  tool, onChange, onRemove, connectorType, index,
}: {
  tool: ToolRow
  onChange: (t: ToolRow) => void
  onRemove: () => void
  connectorType: string
  index: number
}) {
  const [expanded, setExpanded] = useState(true)
  const set = (partial: Partial<ToolRow>) => onChange({ ...tool, ...partial })
  const showLocation = connectorType === 'http' || connectorType === 'graphql'

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', cursor: 'pointer',
          background: 'var(--surface2)', userSelect: 'none',
          transition: 'background 0.12s', width: '100%',
          border: 'none', textAlign: 'left',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface3)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface2)' }}
      >
        {expanded
          ? <ChevronDown size={11} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          : <ChevronRight size={11} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        }
        <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.06em', minWidth: 20 }}>
          #{index + 1}
        </span>
        <span style={{ fontSize: 11, color: tool.name ? 'var(--text)' : 'var(--text-dim)', flex: 1, letterSpacing: '0.02em' }}>
          {tool.name || 'unnamed_tool'}
        </span>
        {connectorType === 'http' && (
          <span style={{
            fontSize: 9, padding: '2px 7px', borderRadius: 99,
            background: 'var(--accent-dim)', color: 'var(--accent)',
            letterSpacing: '0.06em', fontWeight: 600, flexShrink: 0,
          }}>
            {tool.method}
          </span>
        )}
        <Button
          variant="icon"
          size="xs"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          title="Remove tool"
        >
          <Trash2 size={10} />
        </Button>
      </button>

      {expanded && (
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--surface)' }}>
          {/* Name + Description */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={labelStyle}>TOOL NAME *</label>
              <input style={inputStyle} value={tool.name} onChange={(e) => set({ name: e.target.value })} placeholder="list_repos" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={labelStyle}>DESCRIPTION *</label>
              <input style={inputStyle} value={tool.description} onChange={(e) => set({ description: e.target.value })} placeholder="What this tool does…" />
            </div>
          </div>

          {/* HTTP-specific */}
          {connectorType === 'http' && (
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={labelStyle}>METHOD</label>
                <select style={{ ...inputStyle, cursor: 'pointer' }} value={tool.method} onChange={(e) => set({ method: e.target.value as ToolRow['method'] })}>
                  {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={labelStyle}>PATH</label>
                <input style={inputStyle} value={tool.path} onChange={(e) => set({ path: e.target.value })} placeholder="/users/{owner}/repos" />
              </div>
            </div>
          )}

          {/* CLI-specific */}
          {connectorType === 'cli' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={labelStyle}>COMMAND</label>
                <input style={inputStyle} value={tool.command} onChange={(e) => set({ command: e.target.value })} placeholder="git log --oneline -{{count}}" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={labelStyle}>OUTPUT</label>
                <select style={{ ...inputStyle, cursor: 'pointer' }} value={tool.output_as} onChange={(e) => set({ output_as: e.target.value as 'text' | 'json' })}>
                  <option value="text">text</option>
                  <option value="json">json</option>
                </select>
              </div>
            </div>
          )}

          {/* File-specific */}
          {connectorType === 'file' && (
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={labelStyle}>OPERATION</label>
                <select style={{ ...inputStyle, cursor: 'pointer' }} value={tool.operation} onChange={(e) => set({ operation: e.target.value as ToolRow['operation'] })}>
                  {(['read', 'write', 'append', 'delete', 'list'] as const).map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={labelStyle}>PATH TEMPLATE</label>
                <input style={inputStyle} value={tool.path_template} onChange={(e) => set({ path_template: e.target.value })} placeholder="{{filepath}}" />
              </div>
            </div>
          )}

          {/* gRPC-specific */}
          {connectorType === 'grpc' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={labelStyle}>SERVICE</label>
                <input style={inputStyle} value={tool.service} onChange={(e) => set({ service: e.target.value })} placeholder="mypackage.MyService" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={labelStyle}>RPC METHOD</label>
                <input style={inputStyle} value={tool.rpc_method} onChange={(e) => set({ rpc_method: e.target.value })} placeholder="GetUser" />
              </div>
            </div>
          )}

          {/* GraphQL-specific */}
          {connectorType === 'graphql' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={labelStyle}>GRAPHQL QUERY / MUTATION</label>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: 80, lineHeight: 1.6 }}
                value={tool.query}
                onChange={(e) => set({ query: e.target.value })}
                placeholder="query ListUsers { users { id name email } }"
              />
            </div>
          )}

          {/* SQL-specific */}
          {connectorType === 'sql' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={labelStyle}>SQL QUERY *</label>
                <textarea
                  style={{ ...inputStyle, fontFamily: 'monospace', minHeight: 90, lineHeight: 1.5, resize: 'vertical' }}
                  value={tool.sql}
                  onChange={(e) => set({ sql: e.target.value })}
                  placeholder="SELECT id, email FROM users WHERE active = true AND created_at > :since LIMIT :limit"
                />
                <span style={{ fontSize: 9, color: 'var(--text-dim)', opacity: 0.7, lineHeight: 1.4 }}>
                  Use <code>:name</code> placeholders that map to params. Curly-brace {'{{name}}'} is NOT supported here.
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={labelStyle}>MAX ROWS</label>
                  <input type="number" style={inputStyle} value={tool.maxRowsStr}
                    onChange={(e) => set({ maxRowsStr: e.target.value })} placeholder="config default" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={labelStyle}>TIMEOUT (ms)</label>
                  <input type="number" style={inputStyle} value={tool.timeoutMsStr}
                    onChange={(e) => set({ timeoutMsStr: e.target.value })} placeholder="config default" />
                </div>
              </div>
            </div>
          )}

          {/* Params */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label style={labelStyle}>PARAMETERS</label>
            <div style={{ padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5 }}>
              <ParamBuilder
                params={tool.params}
                onChange={(params) => set({ params })}
                showLocation={showLocation}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function ToolBuilder({ tools, onChange, connectorType }: ToolBuilderProps) {
  const setTool = (id: string, t: ToolRow) => onChange(tools.map((x) => (x.id === id ? t : x)))
  const removeTool = (id: string) => onChange(tools.filter((x) => x.id !== id))
  const addTool = () => onChange([...tools, newTool()])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tools.map((tool, i) => (
        <ToolItem
          key={tool.id}
          tool={tool}
          index={i}
          connectorType={connectorType}
          onChange={(t) => setTool(tool.id, t)}
          onRemove={() => removeTool(tool.id)}
        />
      ))}
      <button
        onClick={addTool}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '9px 14px', background: 'transparent',
          border: '1px dashed var(--border2)', borderRadius: 6,
          color: 'var(--text-dim)', fontSize: 10, cursor: 'pointer',
          letterSpacing: '0.05em', transition: 'all 0.12s', fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget).style.color = 'var(--accent)'
          ;(e.currentTarget).style.borderColor = 'var(--accent)'
          ;(e.currentTarget).style.background = 'var(--accent-dim)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget).style.color = 'var(--text-dim)'
          ;(e.currentTarget).style.borderColor = 'var(--border2)'
          ;(e.currentTarget).style.background = 'transparent'
        }}
      >
        <Plus size={10} />
        Add tool
      </button>
    </div>
  )
}
