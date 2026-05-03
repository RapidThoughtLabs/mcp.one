import { Sidebar } from './Sidebar'
import { McpPanel } from './McpPanel'
import { ChatView } from '@/components/chat/ChatView'
import { ConfigsView } from '@/components/configs/ConfigsView'
import { RegistryView } from '@/components/registry/RegistryView'
import { LogsView } from '@/components/logs/LogsView'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { Toaster } from '@/components/ui/Toast'
import { useAppStore } from '@/stores/app-store'
import { PromptsView } from '@/components/prompts/PromptsView'

const PAGE_COMPONENTS = {
  demo: ChatView,
  configs: ConfigsView,
  registry: RegistryView,
  logs: LogsView,
  prompts: PromptsView,
}

export function AppShell() {
  const { activePage } = useAppStore()
  const PageComponent = PAGE_COMPONENTS[activePage]

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative', background: 'var(--bg)' }}>
        <PageComponent />
      </main>

      <McpPanel />

      <SettingsModal />
      <Toaster />
    </div>
  )
}
