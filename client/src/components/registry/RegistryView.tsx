import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { useRegistry } from '@/hooks/useRegistry'
import { RegistryBrowse } from './RegistryBrowse'
import { RegistryDetail } from './RegistryDetail'
import type { RegistryConfigMeta, RegistrySource } from '@/types/registry'

type SubPage = 'browse' | 'detail'

const LS_KEY = 'mcp-one:registry:selectedSource'

export function RegistryView() {
  const [subPage, setSubPage] = useState<SubPage>('browse')
  const [selectedConfig, setSelectedConfig] = useState<RegistryConfigMeta | null>(null)
  const [selectedRegistry, setSelectedRegistry] = useState<string>(
    () => localStorage.getItem(LS_KEY) ?? 'default'
  )
  const [availableSources, setAvailableSources] = useState<RegistrySource[]>([])

  useEffect(() => {
    api.get<RegistrySource[]>('/registry/sources').then((sources) => {
      setAvailableSources(sources)
      const stored = localStorage.getItem(LS_KEY)
      if (stored && !sources.find((s) => s.name === stored)) {
        setSelectedRegistry('default')
        localStorage.setItem(LS_KEY, 'default')
      }
    }).catch(() => {})
  }, [])

  const handleSelectRegistry = (name: string) => {
    setSelectedRegistry(name)
    localStorage.setItem(LS_KEY, name)
  }

  const {
    results,
    featured,
    loading,
    error,
    total,
    filters,
    isInstalled,
    getUpdateInfo,
    setFilter,
    clearFilters,
    checkUpdates,
    install,
    uninstall,
  } = useRegistry({ registry: selectedRegistry })

  const handleSelect = (config: RegistryConfigMeta) => {
    setSelectedConfig(config)
    setSubPage('detail')
  }

  const handleBack = () => {
    setSubPage('browse')
    setSelectedConfig(null)
  }

  if (subPage === 'detail' && selectedConfig) {
    return (
      <RegistryDetail
        config={selectedConfig}
        isInstalled={isInstalled(selectedConfig.slug)}
        updateInfo={getUpdateInfo(selectedConfig.slug)}
        onInstall={install}
        onUninstall={uninstall}
        onBack={handleBack}
      />
    )
  }

  return (
    <RegistryBrowse
      results={results}
      featured={featured}
      loading={loading}
      error={error}
      total={total}
      filters={filters}
      selectedRegistry={selectedRegistry}
      availableSources={availableSources}
      onSelectRegistry={handleSelectRegistry}
      onSetFilter={setFilter}
      onClearFilters={clearFilters}
      onRefetch={() => void checkUpdates()}
      isInstalled={isInstalled}
      getUpdateInfo={getUpdateInfo}
      onSelect={handleSelect}
    />
  )
}
