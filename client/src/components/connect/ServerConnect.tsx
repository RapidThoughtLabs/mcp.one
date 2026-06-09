import { useState, useEffect, useRef } from 'react'
import { api, setApiBase, deriveBridgeUrl } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import type { ConnectResponse } from '@/types/server'

// ── localStorage helpers ───────────────────────────────────────────

const STORAGE_KEY = 'mcp_one_recents'
const MAX_RECENTS = 10

function loadRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function saveRecent(endpoint: string): void {
  const recents = [endpoint, ...loadRecents().filter((r) => r !== endpoint)].slice(0, MAX_RECENTS)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recents))
}

// ── Component ─────────────────────────────────────────────────────

// When the console is served from a remote host, the Vite proxy isn't available.
// We derive the bridge URL from the MCP endpoint and set it silently — no field needed.
const IS_REMOTE = !['localhost', '127.0.0.1'].includes(window.location.hostname)

export function ServerConnect() {
  const { setConnectedEndpoint } = useAppStore()
  const [endpoint, setEndpoint] = useState('http://localhost:3333')
  const [recents, setRecents]   = useState<string[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRecents(loadRecents())
    inputRef.current?.focus()
  }, [])

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    const url = endpoint.trim()
    if (!url) return

    setLoading(true)
    setError(null)

    try {
      if (IS_REMOTE) setApiBase(deriveBridgeUrl(url))
      await api.post<ConnectResponse>('/connect', { endpoint: url })
      saveRecent(url)
      setConnectedEndpoint(url)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function selectRecent(url: string) {
    setEndpoint(url)
    setError(null)
    inputRef.current?.focus()
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: 'var(--bg)',
      padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 440 }}>

        {/* Logo / title */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            fontSize: '0.85rem',
            letterSpacing: '0.25em',
            color: 'var(--accent)',
            fontWeight: 700,
            marginBottom: 8,
          }}>
            HEKU
          </div>
          <div style={{
            fontSize: '1.69rem',
            color: 'var(--text)',
            fontWeight: 700,
            letterSpacing: '-0.01em',
            marginBottom: 6,
          }}>
            Connect to a server
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
            Enter the HTTP endpoint of your heku instance.<br />
            Start one with <code style={{ color: 'var(--accent)', background: 'var(--accent-dim)', padding: '1px 5px', borderRadius: 3 }}>heku start --http</code>
          </div>
        </div>

        {/* Connect form */}
        <form onSubmit={handleConnect}>
          <div style={{ marginBottom: 12 }}>
            <label style={{
              display: 'block',
              fontSize: '0.77rem',
              letterSpacing: '0.1em',
              color: 'var(--text-dim)',
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Server endpoint
            </label>
            <input
              ref={inputRef}
              list="mcp-recents"
              type="url"
              value={endpoint}
              onChange={(e) => { setEndpoint(e.target.value); setError(null) }}
              placeholder="http://localhost:3333"
              disabled={loading}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'var(--surface)',
                border: `1px solid ${error ? 'var(--red)' : 'var(--border2)'}`,
                borderRadius: 6,
                color: 'var(--text)',
                fontSize: '1rem',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => {
                if (!error) e.currentTarget.style.borderColor = 'var(--accent)'
              }}
              onBlur={(e) => {
                if (!error) e.currentTarget.style.borderColor = 'var(--border2)'
              }}
            />
            {/* Native browser autocomplete datalist */}
            <datalist id="mcp-recents">
              {recents.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              fontSize: '0.85rem',
              color: 'var(--red)',
              marginBottom: 12,
              padding: '8px 10px',
              background: 'rgba(255,95,87,0.08)',
              border: '1px solid rgba(255,95,87,0.2)',
              borderRadius: 4,
              lineHeight: 1.5,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !endpoint.trim()}
            style={{
              width: '100%',
              padding: '10px 16px',
              background: loading ? 'var(--accent-dim)' : 'var(--accent)',
              color: loading ? 'var(--accent)' : 'var(--accent-txt)',
              border: 'none',
              borderRadius: 6,
              fontSize: '0.92rem',
              fontWeight: 700,
              letterSpacing: '0.05em',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'opacity 0.15s',
              opacity: !endpoint.trim() ? 0.4 : 1,
            }}
          >
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </form>

        {/* Recent endpoints */}
        {recents.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <div style={{
              fontSize: '0.77rem',
              letterSpacing: '0.1em',
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}>
              Recent
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {recents.map((r) => (
                <button
                  key={r}
                  onClick={() => selectRecent(r)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 10px',
                    background: 'transparent',
                    border: '1px solid transparent',
                    borderRadius: 4,
                    color: 'var(--text-mid)',
                    fontSize: '0.92rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s, color 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--surface)'
                    e.currentTarget.style.color = 'var(--text)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--text-mid)'
                  }}
                >
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.77rem' }}>◆</span>
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
