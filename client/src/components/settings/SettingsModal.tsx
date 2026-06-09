import { Palette, Server, Bot, Info, X, Lock, Cpu } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'
import { SegCtrl } from '@/components/ui/SegCtrl'
import { Button } from '@/components/ui/Button'
import { useAppStore, type AccentColor, type ThemeMode, type LogLevel, type ManifestStyle } from '@/stores/app-store'
import { useChatStore } from '@/stores/chat-store'
import { useLlmStore } from '@/stores/llm-store'
import { PROVIDER_DEFAULTS, type ProviderName } from '@/lib/chat-engine'
import { applyTheme, applyFontSize } from '@/lib/theme'
import { toast } from '@/components/ui/Toast'

type Tab = 'appearance' | 'server' | 'mcp' | 'llm' | 'about'

const TABS: { id: Tab; icon: typeof Palette; label: string }[] = [
  { id: 'appearance', icon: Palette, label: 'Appearance' },
  { id: 'server', icon: Server, label: 'Server' },
  { id: 'mcp', icon: Cpu, label: 'MCP' },
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
        <div style={{ fontSize: '0.92rem', color: 'var(--text)', letterSpacing: '0.02em' }}>{label}</div>
        {sub && <div style={{ fontSize: '0.77rem', color: 'var(--text-dim)', marginTop: 3, letterSpacing: '0.04em' }}>{sub}</div>}
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
      <div style={{ fontSize: '0.69rem', letterSpacing: '0.16em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
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
                <span style={{ fontSize: '0.77rem', fontWeight: 700, color: 'rgba(0,0,0,0.6)' }}>✓</span>
              )}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label="Font size" sub={`Adjust base font size (${fontSize}px)`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.69rem', color: 'var(--text-dim)', fontFamily: 'monospace' }}>11</span>
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
          <span style={{ fontSize: '0.69rem', color: 'var(--text-dim)', fontFamily: 'monospace' }}>18</span>
        </div>
      </SettingRow>

    </div>
  )
}

function ManifestStylePreview({ style, selected }: { style: ManifestStyle; selected: boolean }) {
  const tools = style === 'flat'
    ? ['search()', 'list_configs()', 'list_tools()', 'invoke()']
    : ['one.search()', 'one.list_configs()', 'one.list_tools()']

  const label = style === 'flat' ? 'Flat' : 'Namespaced'
  const desc = style === 'flat' ? 'Claude / Cursor (regex-safe)' : 'Bespoke / Enterprise'

  return (
    <div
      style={{
        flex: 1,
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 6,
        padding: '8px 10px',
        background: selected ? 'var(--accent-dim)' : 'var(--bg)',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ fontSize: '0.77rem', color: selected ? 'var(--accent)' : 'var(--text-mid)', fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '0.69rem', color: 'var(--text-dim)', marginBottom: 8, letterSpacing: '0.03em' }}>{desc}</div>
      {tools.map((t) => (
        <div key={t} style={{ fontSize: '0.69rem', fontFamily: "'JetBrains Mono', monospace", color: selected ? 'var(--text)' : 'var(--text-dim)', padding: '1px 0' }}>
          {t}
        </div>
      ))}
    </div>
  )
}

function ServerTab() {
  const { hotReload, logLevel, configWriteLock, setHotReload, setLogLevel, setConfigWriteLock, setMcpServerVersion } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [configDir, setConfigDir] = useState<string>('')

  useEffect(() => {
    setLoading(true)
    fetch('/api/server-settings')
      .then((r) => r.json())
      .then((data: { hotReload?: boolean; logLevel?: LogLevel; configWriteLock?: boolean; unavailable?: boolean; configDir?: string; mcpServerVersion?: string }) => {
        if (typeof data.hotReload === 'boolean') setHotReload(data.hotReload)
        if (data.logLevel) setLogLevel(data.logLevel)
        if (typeof data.configWriteLock === 'boolean') setConfigWriteLock(data.configWriteLock)
        if (data.configDir) setConfigDir(data.configDir)
        if (data.mcpServerVersion) setMcpServerVersion(data.mcpServerVersion)
        setUnavailable(data.unavailable === true)
      })
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false))
  }, [])

  const applySettings = async (patch: { hotReload?: boolean; logLevel?: LogLevel; configWriteLock?: boolean }) => {
    try {
      const res = await fetch('/api/server-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error('Failed')
    } catch {
      toast.error('Could not apply setting — heku may not be connected')
    }
  }

  const handleHotReload = async (v: boolean) => {
    setHotReload(v)
    await applySettings({ hotReload: v })
    toast.info(`Hot reload ${v ? 'enabled' : 'disabled'}`)
  }

  const handleLogLevel = async (v: LogLevel) => {
    setLogLevel(v)
    await applySettings({ logLevel: v })
    toast.info(`Log level → ${v.toUpperCase()}`)
  }

  const handleConfigWriteLock = async (v: boolean) => {
    setConfigWriteLock(v)
    await applySettings({ configWriteLock: v })
    toast.info(`Config write lock ${v ? 'ON — agents cannot mutate configs' : 'OFF'}`)
  }

  return (
    <div>
      <div style={{ fontSize: '0.69rem', letterSpacing: '0.16em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
        Server
      </div>

      {unavailable && (
        <div style={{ fontSize: '0.77rem', color: 'var(--text-dim)', marginBottom: 12, padding: '6px 10px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)', letterSpacing: '0.04em' }}>
          heku not connected — settings are read-only
        </div>
      )}

      <SettingRow label="Config directory" sub="Where mcp.*.json files are stored">
        <span style={{ fontSize: '0.77rem', color: 'var(--text-dim)', fontFamily: 'monospace' }}>{configDir || '…'}</span>
      </SettingRow>

      <SettingRow label="Hot reload" sub="Auto-reload when config files change">
        <Toggle
          checked={hotReload}
          onChange={handleHotReload}
          disabled={loading || unavailable}
        />
      </SettingRow>

      <SettingRow label="Log level" sub="Verbosity of heku server output">
        <SegCtrl
          options={[
            { value: 'info' as LogLevel, label: 'INFO' },
            { value: 'debug' as LogLevel, label: 'DEBUG' },
            { value: 'warn' as LogLevel, label: 'WARN' },
            { value: 'error' as LogLevel, label: 'ERROR' },
          ]}
          value={logLevel}
          onChange={handleLogLevel}
          disabled={loading || unavailable}
        />
      </SettingRow>

      <SettingRow
        label="Config write lock"
        sub="Block LLM agents from creating, editing, or deleting configs"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {configWriteLock && <Lock size={11} style={{ color: 'var(--yellow)', flexShrink: 0 }} />}
          <Toggle
            checked={configWriteLock}
            onChange={handleConfigWriteLock}
            disabled={loading || unavailable}
          />
        </div>
      </SettingRow>
      {configWriteLock && (
        <div style={{ fontSize: '0.69rem', color: 'var(--text-dim)', marginBottom: 8, letterSpacing: '0.04em', lineHeight: 1.6 }}>
          Blocked: create_config · update_config · delete_config · add_tool · remove_tool · update_tool · registry_install · auth_set
        </div>
      )}
    </div>
  )
}

function RuntimeTab() {
  const { manifestStyle, blockAutoInstall, blockAutoStart, setManifestStyle, setBlockAutoInstall, setBlockAutoStart } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch('/api/server-settings')
      .then((r) => r.json())
      .then((data: { manifestStyle?: ManifestStyle; blockAutoInstall?: boolean; blockAutoStart?: boolean; unavailable?: boolean }) => {
        if (data.manifestStyle) setManifestStyle(data.manifestStyle)
        if (typeof data.blockAutoInstall === 'boolean') setBlockAutoInstall(data.blockAutoInstall)
        if (typeof data.blockAutoStart === 'boolean') setBlockAutoStart(data.blockAutoStart)
        setUnavailable(data.unavailable === true)
      })
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false))
  }, [])

  const applySettings = async (patch: { manifestStyle?: ManifestStyle; blockAutoInstall?: boolean; blockAutoStart?: boolean }) => {
    try {
      const res = await fetch('/api/server-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error('Failed')
    } catch {
      toast.error('Could not apply setting — heku may not be connected')
    }
  }

  const handleBlockAutoInstall = async (v: boolean) => {
    setBlockAutoInstall(v)
    await applySettings({ blockAutoInstall: v })
    toast.info(`Auto-install ${v ? 'blocked' : 'allowed'}`)
  }

  const handleBlockAutoStart = async (v: boolean) => {
    setBlockAutoStart(v)
    await applySettings({ blockAutoStart: v })
    toast.info(`Auto-start ${v ? 'blocked' : 'allowed'}`)
  }

  const handleManifestStyle = async (v: ManifestStyle) => {
    setManifestStyle(v)
    await applySettings({ manifestStyle: v })
    toast.info(`Manifest style → ${v}`)
  }

  return (
    <div>
      <div style={{ fontSize: '0.69rem', letterSpacing: '0.16em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
        MCP
      </div>

      {unavailable && (
        <div style={{ fontSize: '0.77rem', color: 'var(--text-dim)', marginBottom: 12, padding: '6px 10px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)', letterSpacing: '0.04em' }}>
          heku not connected — settings are read-only
        </div>
      )}

      {/* Lifecycle sub-section */}
      <div style={{ fontSize: '0.69rem', letterSpacing: '0.16em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
        Lifecycle
      </div>

      <SettingRow label="Block auto-install" sub="Prevent heku from running install commands on startup">
        <Toggle checked={blockAutoInstall} onChange={handleBlockAutoInstall} disabled={loading || unavailable} />
      </SettingRow>

      <SettingRow label="Block auto-start" sub="Prevent heku from auto-spawning MCP subprocesses">
        <Toggle checked={blockAutoStart} onChange={handleBlockAutoStart} disabled={loading || unavailable} />
      </SettingRow>

      {/* Agent Behavior sub-section */}
      <div style={{ fontSize: '0.69rem', letterSpacing: '0.16em', color: 'var(--accent)', textTransform: 'uppercase', margin: '20px 0 12px', paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
        Agent Behavior
      </div>

      <SettingRow label="Manifest style" sub="Tool names advertised to LLM clients via tools/list">
        <SegCtrl
          options={[
            { value: 'flat' as ManifestStyle, label: 'Flat' },
            { value: 'namespaced' as ManifestStyle, label: 'Namespaced' },
          ]}
          value={manifestStyle}
          onChange={handleManifestStyle}
          disabled={loading || unavailable}
        />
      </SettingRow>

      <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 16 }}>
        <ManifestStylePreview style="flat" selected={manifestStyle === 'flat'} />
        <ManifestStylePreview style="namespaced" selected={manifestStyle === 'namespaced'} />
      </div>
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
      <div style={{ fontSize: '0.69rem', letterSpacing: '0.16em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
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
            fontSize: '0.77rem',
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
        <span style={{ fontSize: '0.69rem', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          {PROVIDER_DEFAULTS[activeProvider].baseUrl}
        </span>
      </SettingRow>

      {/* Custom models section */}
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: '0.77rem', color: 'var(--text)', marginBottom: 8, letterSpacing: '0.02em' }}>
          Custom models
          <span style={{ fontSize: '0.69rem', color: 'var(--text-dim)', marginLeft: 6 }}>
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
              fontSize: '0.77rem',
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
              fontSize: '0.77rem',
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

      <div style={{ padding: '12px 0', fontSize: '0.77rem', color: 'var(--text-dim)', lineHeight: 1.7, letterSpacing: '0.04em' }}>
        API keys are configured when you start a chat session. They are stored in session memory only and never persisted to disk.
      </div>
    </div>
  )
}

declare const __APP_VERSION__: string

function AboutTab() {
  const { mcpServerVersion, setMcpServerVersion } = useAppStore()

  useEffect(() => {
    if (mcpServerVersion) return
    fetch('/api/server-settings')
      .then((r) => r.json())
      .then((data: { mcpServerVersion?: string }) => {
        if (data.mcpServerVersion) setMcpServerVersion(data.mcpServerVersion)
      })
      .catch(() => {})
  }, [])

  return (
    <div>
      <div style={{ fontSize: '0.69rem', letterSpacing: '0.16em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
        About
      </div>

      <SettingRow label="Console" sub="Dashboard and API bridge">
        <span style={{ fontSize: '0.77rem', color: 'var(--text-dim)' }}>v{__APP_VERSION__}</span>
      </SettingRow>

      <SettingRow label="heku server" sub="MCP protocol layer">
        <span style={{ fontSize: '0.77rem', color: 'var(--text-dim)' }}>{mcpServerVersion ? `v${mcpServerVersion}` : 'unknown'}</span>
      </SettingRow>

      <SettingRow label="Design system" sub="UI design language">
        <span style={{ fontSize: '0.77rem', color: 'var(--text-dim)' }}>rtl:// v3</span>
      </SettingRow>

      <div style={{ padding: '16px 0', fontSize: '0.77rem', color: 'var(--text-dim)', lineHeight: 1.7, letterSpacing: '0.04em' }}>
        Built by RapidThoughtLabs. heku is an open-source MCP server that turns JSON configs into working API tools.
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
    mcp: <RuntimeTab />,
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
          <div style={{ fontSize: '0.69rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-dim)', padding: '0 14px 6px' }}>
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
                fontSize: '0.85rem',
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
