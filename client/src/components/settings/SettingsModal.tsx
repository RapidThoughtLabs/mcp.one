import { Palette, Server, Bot, Info, X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'
import { SegCtrl } from '@/components/ui/SegCtrl'
import { Button } from '@/components/ui/Button'
import { useAppStore, type AccentColor, type ThemeMode, type LogLevel } from '@/stores/app-store'
import { useChatStore } from '@/stores/chat-store'
import { useLlmStore } from '@/stores/llm-store'
import { PROVIDER_DEFAULTS, type ProviderName } from '@/lib/chat-engine'
import { applyTheme, applyFontSize } from '@/lib/theme'
import { toast } from '@/components/ui/Toast'

type Tab = 'appearance' | 'server' | 'llm' | 'about'

const TABS: { id: Tab; icon: typeof Palette; label: string }[] = [
  { id: 'appearance', icon: Palette, label: 'Appearance' },
  { id: 'server', icon: Server, label: 'Server' },
  { id: 'llm', icon: Bot, label: 'LLM' },
  { id: 'about', icon: Info, label: 'About' },
]

const ACCENTS: { value: AccentColor; hsl: string; label: string }[] = [
  { value: 'purple', hsl: 'hsl(270, 70%, 68%)', label: 'Purple' },
  { value: 'lime', hsl: 'hsl(86, 84%, 62%)', label: 'Lime' },
  { value: 'blue', hsl: 'hsl(210, 80%, 62%)', label: 'Blue' },
  { value: 'cyan', hsl: 'hsl(186, 80%, 52%)', label: 'Cyan' },
  { value: 'pink', hsl: 'hsl(330, 80%, 68%)', label: 'Pink' },
  { value: 'yellow', hsl: 'hsl(45, 92%, 56%)', label: 'Yellow' },
]

function SettingRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 0',
        borderBottom: '1px solid var(--border)',
        gap: 16,
      }}
    >
      <div>
        <div style={{ fontSize: 12, color: 'var(--text)', letterSpacing: '0.02em' }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3, letterSpacing: '0.04em' }}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function AppearanceTab() {
  const { mode, accent, fontSize, setMode, setAccent, setFontSize } = useAppStore()

  const handleMode = (m: ThemeMode) => {
    setMode(m)
    applyTheme(m, accent)
  }

  const handleAccent = (a: AccentColor) => {
    setAccent(a)
    applyTheme(mode, a)
  }

  const handleFontSize = (size: number) => {
    setFontSize(size)
    applyFontSize(size)
  }

  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
        Appearance
      </div>

      <SettingRow label="Theme" sub="Toggle between dark and light mode">
        <SegCtrl
          options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }] as { value: ThemeMode; label: string }[]}
          value={mode}
          onChange={handleMode}
        />
      </SettingRow>

      <SettingRow label="Accent color" sub="Choose your accent color">
        <div style={{ display: 'flex', gap: 8 }}>
          {ACCENTS.map((a) => (
            <button
              key={a.value}
              title={a.label}
              onClick={() => handleAccent(a.value)}
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                cursor: 'pointer',
                border: `2px solid ${accent === a.value ? 'var(--text)' : 'transparent'}`,
                background: a.hsl,
                transition: 'all 0.15s',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; e.currentTarget.style.filter = 'brightness(1.2)' }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.filter = '' }}
            >
              {accent === a.value && (
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.6)' }}>✓</span>
              )}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label="Font size" sub={`Adjust base font size (${fontSize}px)`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'monospace' }}>11</span>
          <input
            type="range"
            min={11}
            max={18}
            step={1}
            value={fontSize}
            onChange={(e) => handleFontSize(parseInt(e.target.value, 10))}
            style={{
              width: 100,
              accentColor: 'var(--accent)',
              cursor: 'pointer',
            }}
          />
          <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'monospace' }}>18</span>
        </div>
      </SettingRow>

      <SettingRow label="Compact mode" sub="Reduce padding and spacing">
        <Toggle checked={false} onChange={() => toast.info('Compact mode coming soon')} />
      </SettingRow>
    </div>
  )
}

function ServerTab() {
  const { hotReload, logLevel, setHotReload, setLogLevel } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)

  // Fetch real settings from mcp-one when the tab mounts
  useEffect(() => {
    setLoading(true)
    fetch('/api/server-settings')
      .then((r) => r.json())
      .then((data: { hotReload?: boolean; logLevel?: LogLevel; unavailable?: boolean }) => {
        if (typeof data.hotReload === 'boolean') setHotReload(data.hotReload)
        if (data.logLevel) setLogLevel(data.logLevel)
        setUnavailable(data.unavailable === true)
      })
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false))
  }, [])

  const applySettings = async (patch: { hotReload?: boolean; logLevel?: LogLevel }) => {
    try {
      const res = await fetch('/api/server-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error('Failed')
    } catch {
      toast.error('Could not apply setting — mcp-one may not be connected')
    }
  }

  const handleHotReload = async (v: boolean) => {
    setHotReload(v)  // optimistic
    await applySettings({ hotReload: v })
    toast.info(`Hot reload ${v ? 'enabled' : 'disabled'}`)
  }

  const handleLogLevel = async (v: LogLevel) => {
    setLogLevel(v)   // optimistic
    await applySettings({ logLevel: v })
    toast.info(`Log level → ${v.toUpperCase()}`)
  }

  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
        Server
      </div>

      {unavailable && (
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 12, padding: '6px 10px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)', letterSpacing: '0.04em' }}>
          mcp-one not connected — settings are read-only
        </div>
      )}

      <SettingRow label="Config directory" sub="Where mcp.*.json files are stored">
        <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>./mcp-configs</span>
      </SettingRow>

      <SettingRow label="Hot reload" sub="Auto-reload when config files change">
        <Toggle
          checked={hotReload}
          onChange={handleHotReload}
          disabled={loading || unavailable}
        />
      </SettingRow>

      <SettingRow label="Log level" sub="Verbosity of mcp-one server output">
        <SegCtrl
          options={[
            { value: 'info' as LogLevel, label: 'INFO' },
            { value: 'debug' as LogLevel, label: 'DEBUG' },
            { value: 'error' as LogLevel, label: 'ERROR' },
          ]}
          value={logLevel}
          onChange={handleLogLevel}
          disabled={loading || unavailable}
        />
      </SettingRow>
    </div>
  )
}

function LlmTab() {
  const {
    activeProvider,
    customModels,
    selectedModel,
    setActiveProvider,
    addCustomModel,
    removeCustomModel,
    setSelectedModel,
    getModels,
  } = useLlmStore()

  const { provider, clearProvider, openProviderPicker, setProviderModel } = useChatStore()

  const [newModelInput, setNewModelInput] = useState('')

  const handleProviderSwitch = (p: ProviderName) => {
    setActiveProvider(p)
    if (provider) {
      clearProvider()
      openProviderPicker()
    }
  }

  const handleDefaultModelChange = (model: string) => {
    setSelectedModel(activeProvider, model)
    if (provider?.provider === activeProvider) {
      setProviderModel(model)
    }
  }

  const handleAddModel = () => {
    addCustomModel(activeProvider, newModelInput)
    setNewModelInput('')
  }

  const allModels = getModels(activeProvider)
  const builtInModels = PROVIDER_DEFAULTS[activeProvider].models
  const customList = customModels[activeProvider]

  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
        LLM Provider
      </div>

      <SettingRow label="Provider" sub="Switching will clear the current API key">
        <SegCtrl
          options={[{ value: 'openai', label: 'OpenAI' }, { value: 'togetherai', label: 'Together AI' }] as { value: ProviderName; label: string }[]}
          value={activeProvider}
          onChange={handleProviderSwitch}
        />
      </SettingRow>

      <SettingRow label="Default model" sub="Pre-selected when connecting">
        <select
          value={selectedModel[activeProvider]}
          onChange={(e) => handleDefaultModelChange(e.target.value)}
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border2)',
            borderRadius: 6,
            padding: '5px 10px',
            color: 'var(--text)',
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
            outline: 'none',
            cursor: 'pointer',
            maxWidth: 200,
          }}
        >
          <optgroup label="Provided">
            {builtInModels.map((m) => (
              <option key={m} value={m} style={{ background: 'var(--surface)' }}>{m.split('/').pop()}</option>
            ))}
          </optgroup>
          {customList.length > 0 && (
            <optgroup label="Custom">
              {customList.map((m) => (
                <option key={m} value={m} style={{ background: 'var(--surface)' }}>{m.split('/').pop()}</option>
              ))}
            </optgroup>
          )}
        </select>
      </SettingRow>

      <SettingRow label="Base URL" sub="Provider endpoint (read-only)">
        <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          {PROVIDER_DEFAULTS[activeProvider].baseUrl}
        </span>
      </SettingRow>

      {/* Custom models section */}
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10, color: 'var(--text)', marginBottom: 8, letterSpacing: '0.02em' }}>
          Custom models
          <span style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 6 }}>
            · {allModels.length - builtInModels.length} added
          </span>
        </div>

        {/* Existing custom models */}
        {customList.map((m) => (
          <div
            key={m}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 0',
              fontSize: 10,
              color: 'var(--text-mid)',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <span>{m}</span>
            <button
              onClick={() => removeCustomModel(activeProvider, m)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-dim)',
                display: 'flex',
                alignItems: 'center',
                padding: 2,
                borderRadius: 3,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
              title="Remove model"
            >
              <X size={11} />
            </button>
          </div>
        ))}

        {/* Add model input */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            value={newModelInput}
            onChange={(e) => setNewModelInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddModel() }}
            placeholder="org/model-name"
            style={{
              flex: 1,
              background: 'var(--bg)',
              border: '1px solid var(--border2)',
              borderRadius: 6,
              padding: '5px 10px',
              color: 'var(--text)',
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              outline: 'none',
              letterSpacing: '0.04em',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'hsla(var(--accent-h), var(--accent-s), var(--accent-l), 0.5)' }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border2)' }}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={!newModelInput.trim()}
            onClick={handleAddModel}
          >
            Add
          </Button>
        </div>
      </div>

      <div style={{ padding: '12px 0', fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.7, letterSpacing: '0.04em' }}>
        API keys are configured when you start a chat session. They are stored in session memory only and never persisted to disk.
      </div>
    </div>
  )
}

function AboutTab() {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
        About
      </div>

      <SettingRow label="Version" sub="mcp.one client">
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>v0.1.0</span>
      </SettingRow>

      <SettingRow label="MCP transport" sub="Protocol used with the server">
        <span style={{ fontSize: 10, color: 'var(--accent)' }}>stdio (JSON-RPC)</span>
      </SettingRow>

      <SettingRow label="Design system" sub="UI design language">
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>RTL:// v3</span>
      </SettingRow>

      <div style={{ padding: '16px 0', fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.7, letterSpacing: '0.04em' }}>
        Built by RapidThoughtLabs. mcp.one is an open-source MCP server that turns JSON configs into working API tools.
      </div>
    </div>
  )
}

export function SettingsModal() {
  const { settingsOpen, closeSettings } = useAppStore()
  const [activeTab, setActiveTab] = useState<Tab>('appearance')

  const tabContent = {
    appearance: <AppearanceTab />,
    server: <ServerTab />,
    llm: <LlmTab />,
    about: <AboutTab />,
  }

  return (
    <Modal open={settingsOpen} onClose={closeSettings} title="Settings" width={560} height={460}>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar nav */}
        <div
          style={{
            width: 160,
            background: 'var(--bg)',
            borderRight: '1px solid var(--border)',
            padding: '14px 0',
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-dim)', padding: '0 14px 6px' }}>
            Settings
          </div>
          {TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              aria-selected={activeTab === id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                fontSize: 11,
                color: activeTab === id ? 'var(--accent)' : 'var(--text-dim)',
                cursor: 'pointer',
                transition: 'all 0.1s',
                letterSpacing: '0.04em',
                borderLeft: `2px solid ${activeTab === id ? 'var(--accent)' : 'transparent'}`,
                borderTop: 'none',
                borderRight: 'none',
                borderBottom: 'none',
                background: activeTab === id ? 'var(--accent-dim)' : 'transparent',
                userSelect: 'none',
                width: '100%',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { if (activeTab !== id) e.currentTarget.style.color = 'var(--text-mid)' }}
              onMouseLeave={(e) => { if (activeTab !== id) e.currentTarget.style.color = 'var(--text-dim)' }}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {tabContent[activeTab]}
        </div>
      </div>
    </Modal>
  )
}
