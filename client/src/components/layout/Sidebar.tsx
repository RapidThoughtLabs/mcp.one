import { MessageSquare, Settings2, ScrollText, Sparkles, Settings, Package } from 'lucide-react'
import { useAppStore, type Page } from '@/stores/app-store'
import { Badge } from '@/components/ui/Badge'

const NAV_ITEMS: { page: Page; icon: typeof MessageSquare; label: string; soon?: boolean }[] = [
  { page: 'demo', icon: MessageSquare, label: 'Demo' },
  { page: 'configs', icon: Settings2, label: 'Configs' },
  { page: 'registry', icon: Package, label: 'Registry' },
  { page: 'logs', icon: ScrollText, label: 'Logs' },
  { page: 'prompts', icon: Sparkles, label: 'Prompts' },
]

export function Sidebar() {
  const { activePage, setActivePage, serverStatus, toolCount, openSettings, registryUpdateCount } = useAppStore()

  const statusDotStyle = {
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
    ...(serverStatus === 'online'
      ? { background: 'var(--accent)', animation: 'breathe 4s ease-in-out infinite' }
      : serverStatus === 'connecting'
      ? { background: 'var(--yellow)', animation: 'pulse 1.2s ease-in-out infinite' }
      : { background: 'var(--red)' }),
  }

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Brand */}
      <div style={{ padding: '18px 18px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.20em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>
          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>RTL</span>://
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em' }}>
          mcp<span style={{ color: 'var(--accent)' }}>.</span>one
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.12em', marginTop: 5 }}>
          one server. any protocol.
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        <div style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)', padding: '14px 18px 5px' }}>
          Navigate
        </div>
        {NAV_ITEMS.map(({ page, icon: Icon, label, soon }) => {
          const isActive = activePage === page
          return (
            <button
              key={page}
              onClick={() => !soon && setActivePage(page)}
              aria-current={isActive ? 'page' : undefined}
              disabled={soon}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 18px',
                fontSize: 11,
                color: isActive ? 'var(--accent)' : 'var(--text-dim)',
                cursor: soon ? 'default' : 'pointer',
                transition: 'all 0.12s',
                letterSpacing: '0.06em',
                borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                borderTop: 'none', borderRight: 'none', borderBottom: 'none',
                background: isActive ? 'var(--accent-dim)' : 'transparent',
                userSelect: 'none',
                width: '100%',
                textAlign: 'left',
                opacity: soon ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (!isActive && !soon) {
                  e.currentTarget.style.color = 'var(--text-mid)'
                  e.currentTarget.style.background = 'var(--surface2)'
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive && !soon) {
                  e.currentTarget.style.color = 'var(--text-dim)'
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              <Icon size={14} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{label}</span>
              {soon && <Badge variant="info">soon</Badge>}
              {page === 'registry' && registryUpdateCount > 0 && (
                <Badge variant="warn">{registryUpdateCount}</Badge>
              )}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div
        style={{
          padding: '12px 18px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          flexShrink: 0,
        }}
      >
        <div style={statusDotStyle} />
        <span style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.06em', flex: 1 }}>
          {serverStatus === 'online'
            ? `${toolCount} tool${toolCount !== 1 ? 's' : ''} ready`
            : serverStatus === 'connecting'
            ? 'connecting...'
            : 'server offline'}
        </span>
        <button
          onClick={openSettings}
          title="Settings"
          aria-label="Open settings"
          style={{
            width: 22,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: '50%',
            color: 'var(--accent-txt)',
            fontSize: 12,
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'box-shadow 0.22s ease, filter 0.18s ease, transform 0.28s ease',
          }}
          onMouseEnter={(e) => {
            const t = e.currentTarget
            t.style.filter = 'brightness(1.25)'
            t.style.boxShadow = 'var(--glow)'
            t.style.transform = 'rotate(35deg)'
          }}
          onMouseLeave={(e) => {
            const t = e.currentTarget
            t.style.filter = ''
            t.style.boxShadow = ''
            t.style.transform = ''
          }}
        >
          <Settings size={11} />
        </button>
      </div>
    </div>
  )
}
