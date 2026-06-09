import { useEffect, useRef, useState, useCallback } from 'react'
import { ScrollText } from 'lucide-react'
import { api } from '@/lib/api'
import type { LogEntry } from '@/types/server'

const POLL_MS = 3_000

const LEVEL_STYLE: Record<LogEntry['level'], { color: string; label: string }> = {
  debug: { color: 'var(--text-dim)',  label: 'DBG' },
  info:  { color: '#4eb8cc',          label: 'INF' },
  warn:  { color: '#c9953a',          label: 'WRN' },
  error: { color: '#c94a4a',          label: 'ERR' },
}

const SOURCE_LABEL: Record<LogEntry['source'], string> = {
  mcp:    'mcp',
  api:    'api',
  config: 'cfg',
}

type LevelFilter = 'all' | LogEntry['level']

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

export function LogsView() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState<LevelFilter>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchLogs = useCallback(async () => {
    try {
      const entries = await api.get<LogEntry[]>('/logs')
      if (!mountedRef.current) return
      setLogs(entries)
      setError(null)
    } catch {
      if (!mountedRef.current) return
      setError('Could not reach server — is heku running?')
    }
    if (mountedRef.current) {
      timerRef.current = setTimeout(fetchLogs, POLL_MS)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void fetchLogs()
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [fetchLogs])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  // Pause auto-scroll when user scrolls up
  function handleScroll() {
    const el = listRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  const visible = filter === 'all' ? logs : logs.filter(e => e.level === filter)

  if (error && logs.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: 'var(--text-dim)' }}>
        <ScrollText size={28} style={{ opacity: 0.25 }} />
        <div style={{ fontSize: '0.85rem', letterSpacing: '0.08em' }}>{error}</div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        <span style={{ fontSize: '0.77rem', color: 'var(--text-dim)', marginRight: 4, letterSpacing: '0.08em' }}>LEVEL</span>
        {(['all', 'debug', 'info', 'warn', 'error'] as const).map(lvl => (
          <button
            key={lvl}
            onClick={() => setFilter(lvl)}
            style={{
              fontSize: '0.69rem',
              fontFamily: 'monospace',
              padding: '2px 7px',
              borderRadius: 3,
              border: '1px solid',
              cursor: 'pointer',
              letterSpacing: '0.06em',
              background: filter === lvl ? (lvl === 'all' ? 'var(--accent-dim)' : LEVEL_STYLE[lvl as LogEntry['level']]?.color + '22') : 'transparent',
              color: filter === lvl
                ? (lvl === 'all' ? 'var(--accent)' : LEVEL_STYLE[lvl as LogEntry['level']]?.color)
                : 'var(--text-dim)',
              borderColor: filter === lvl
                ? (lvl === 'all' ? 'var(--accent)' : LEVEL_STYLE[lvl as LogEntry['level']]?.color)
                : 'var(--border)',
            }}
          >
            {lvl.toUpperCase()}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.69rem', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          {visible.length} entries
        </span>
        {!autoScroll && (
          <button
            onClick={() => {
              setAutoScroll(true)
              bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
            }}
            style={{ fontSize: '0.69rem', color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent)', borderRadius: 3, padding: '2px 7px', cursor: 'pointer', letterSpacing: '0.06em' }}
          >
            JUMP TO BOTTOM
          </button>
        )}
      </div>

      {/* Log list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.85rem' }}
      >
        {visible.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
            No log entries yet
          </div>
        ) : (
          visible.map(entry => {
            const lvl = LEVEL_STYLE[entry.level]
            return (
              <div
                key={entry.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 28px 28px 1fr',
                  gap: '0 8px',
                  alignItems: 'baseline',
                  padding: '2px 14px',
                  borderBottom: '1px solid var(--border)',
                  lineHeight: 1.6,
                }}
              >
                <span style={{ color: 'var(--text-dim)', fontSize: '0.77rem' }}>{fmtTime(entry.ts)}</span>
                <span style={{ color: lvl.color, fontWeight: 600, fontSize: '0.77rem' }}>{lvl.label}</span>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.77rem' }}>{SOURCE_LABEL[entry.source]}</span>
                <span style={{ color: 'var(--text)', wordBreak: 'break-all' }}>{entry.msg}</span>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
