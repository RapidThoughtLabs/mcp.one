import { MessageSquare, Settings2, ScrollText, Sparkles, Settings, Package, FlaskConical, Lock } from 'lucide-react'
import { useAppStore, type Page } from '@/stores/app-store'
import { Badge } from '@/components/ui/Badge'

const NAV_ITEMS: { page: Page; icon: typeof MessageSquare; label: string; soon?: boolean }[] = [
  { page: 'demo', icon: MessageSquare, label: 'Demo' },
  { page: 'configs', icon: Settings2, label: 'Configs' },
  { page: 'registry', icon: Package, label: 'Registry' },
  { page: 'experimental', icon: FlaskConical, label: 'Experimental' },
  { page: 'logs', icon: ScrollText, label: 'Logs' },
  { page: 'prompts', icon: Sparkles, label: 'Prompts' },
]

export function Sidebar() {
  const { activePage, setActivePage, openSettings, registryUpdateCount, configWriteLock } = useAppStore()

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
        <a
          href="https://www.rapidthoughtlabs.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            fontSize: '0.69rem',
            letterSpacing: '0.20em',
            color: 'var(--text-dim)',
            marginBottom: 6,
            textDecoration: 'none',
            cursor: 'pointer',
            transition: 'color 0.15s ease, text-shadow 0.22s ease',
          }}
          onMouseEnter={(e) => {
            const t = e.currentTarget
            t.style.color = 'var(--accent)'
            t.style.textShadow = '0 0 6px var(--accent), 0 0 14px var(--accent), 0 0 28px var(--accent)'
          }}
          onMouseLeave={(e) => {
            const t = e.currentTarget
            t.style.color = 'var(--text-dim)'
            t.style.textShadow = ''
          }}
        >
          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>rtl</span>://
        </a>
        <div style={{ fontSize: '1.38rem', fontWeight: 500, fontFamily: "'DM Mono', monospace", color: 'var(--text)', letterSpacing: '-0.03em' }}>
          he<span style={{ color: 'var(--accent)' }}>k</span>u
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        <div style={{ fontSize: '0.69rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)', padding: '14px 18px 5px' }}>
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
                fontSize: '0.85rem',
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
        <span style={{ fontSize: '0.77rem', color: 'var(--text-dim)', letterSpacing: '0.06em', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {window.location.host}
        </span>
        {configWriteLock && (
          <Lock
            size={11}
            aria-label="Config write lock ON"
            style={{ color: 'var(--yellow)', flexShrink: 0, marginRight: 4 }}
          />
        )}
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
            fontSize: '0.92rem',
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
