import { create } from 'zustand'
import type { ConfigSummary, McpTool } from '@/types/server'

export type Page = 'demo' | 'configs' | 'registry' | 'logs' | 'prompts'
export type AccentColor = 'purple' | 'lime' | 'blue' | 'cyan' | 'pink'
export type ThemeMode = 'dark' | 'light'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface AppState {
  // Navigation
  activePage: Page
  setActivePage: (page: Page) => void

  // Theme
  mode: ThemeMode
  accent: AccentColor
  fontSize: number
  setMode: (mode: ThemeMode) => void
  setAccent: (accent: AccentColor) => void
  setFontSize: (size: number) => void

  // Settings modal
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void

  // Server settings (fetched from mcp-one at runtime; reset on process restart)
  hotReload: boolean
  logLevel: LogLevel
  setHotReload: (v: boolean) => void
  setLogLevel: (v: LogLevel) => void

  // MCP server connection — set by ServerConnect, gates the whole app
  connectedEndpoint: string | null
  setConnectedEndpoint: (endpoint: string | null) => void

  // MCP server status — driven by useMcpServer hook
  serverStatus: 'online' | 'offline' | 'connecting'
  toolCount: number
  tools: McpTool[]
  configs: ConfigSummary[]
  setServerStatus: (status: 'online' | 'offline' | 'connecting') => void
  setToolCount: (count: number) => void
  setTools: (tools: McpTool[]) => void
  setConfigs: (configs: ConfigSummary[]) => void

  // Registry update badge count
  registryUpdateCount: number
  setRegistryUpdateCount: (count: number) => void
}

export const useAppStore = create<AppState>((set) => ({
  activePage: 'demo',
  setActivePage: (page) => set({ activePage: page }),

  mode: 'dark',
  accent: 'purple',
  fontSize: 13,
  setMode: (mode) => set({ mode }),
  setAccent: (accent) => set({ accent }),
  setFontSize: (fontSize) => set({ fontSize }),

  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  hotReload: true,
  logLevel: 'info' as LogLevel,
  setHotReload: (hotReload) => set({ hotReload }),
  setLogLevel: (logLevel) => set({ logLevel }),

  connectedEndpoint: null,
  setConnectedEndpoint: (connectedEndpoint) => set({ connectedEndpoint }),

  serverStatus: 'connecting',
  toolCount: 0,
  tools: [],
  configs: [],
  setServerStatus: (serverStatus) => set({ serverStatus }),
  setToolCount: (toolCount) => set({ toolCount }),
  setTools: (tools) => set({ tools, toolCount: tools.length }),
  setConfigs: (configs) => set({ configs }),

  registryUpdateCount: 0,
  setRegistryUpdateCount: (registryUpdateCount) => set({ registryUpdateCount }),
}))
