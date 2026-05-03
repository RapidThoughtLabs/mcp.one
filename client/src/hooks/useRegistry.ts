import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import type {
  RegistryConfigMeta,
  RegistryPaginatedResponse,
  RegistryUpdateInfo,
  ManifestEntry,
  Manifest,
} from '@/types/registry'

export interface RegistryFilters {
  q?: string
  sort_by?: 'popular' | 'recent' | 'name'
  connector_type?: string
  verified?: boolean
}

export interface UseRegistryResult {
  results: RegistryConfigMeta[]
  featured: RegistryConfigMeta[]
  loading: boolean
  error: string | null
  total: number
  filters: RegistryFilters
  manifest: ManifestEntry[]
  updatesAvailable: Map<string, RegistryUpdateInfo>

  setFilter: (patch: Partial<RegistryFilters>) => void
  clearFilters: () => void
  install: (namespace: string, slug: string, version?: string) => Promise<void>
  uninstall: (slug: string) => Promise<void>
  isInstalled: (slug: string) => boolean
  getUpdateInfo: (slug: string) => RegistryUpdateInfo | undefined
  checkUpdates: () => Promise<void>
  refetchManifest: () => Promise<void>
}

const DEFAULT_FILTERS: RegistryFilters = {
  sort_by: 'popular',
}

function buildRegistryUrl(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v))
  }
  const q = qs.toString()
  return q ? `${path}?${q}` : path
}

export function useRegistry({ registry }: { registry: string }): UseRegistryResult {
  const [results, setResults] = useState<RegistryConfigMeta[]>([])
  const [featured, setFeatured] = useState<RegistryConfigMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState<RegistryFilters>(DEFAULT_FILTERS)
  const [manifest, setManifest] = useState<ManifestEntry[]>([])
  const [updatesAvailable, setUpdatesAvailable] = useState<Map<string, RegistryUpdateInfo>>(new Map())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setRegistryUpdateCount = useAppStore((s) => s.setRegistryUpdateCount)

  // ── Manifest ──────────────────────────────────────────────────────

  const refetchManifest = useCallback(async () => {
    try {
      const data = await api.get<Manifest>('/registry/manifest')
      setManifest(data.installed)
    } catch {
      // non-critical
    }
  }, [])

  // ── Update checking ───────────────────────────────────────────────

  const checkUpdates = useCallback(async (registryName: string) => {
    const currentManifest = await api
      .get<Manifest>('/registry/manifest')
      .catch(() => ({ installed: [] as ManifestEntry[] }))
    const forThisRegistry = currentManifest.installed.filter((e) => e.registry === registryName)
    if (forThisRegistry.length === 0) return

    try {
      const url = buildRegistryUrl('/registry/check-updates', { registry: registryName })
      const result = await api.post<{
        updates: RegistryUpdateInfo[]
        deprecated: { slug: string; installed_version: string; replacement: string; message: string }[]
        up_to_date: { slug: string; version: string }[]
      }>(url, {
        installed: forThisRegistry.map((e) => ({ slug: e.slug, version: e.version })),
      })

      const map = new Map<string, RegistryUpdateInfo>()
      for (const u of result.updates) map.set(u.slug, u)
      setUpdatesAvailable(map)
      setRegistryUpdateCount(result.updates.length)
    } catch {
      // non-critical
    }
  }, [setRegistryUpdateCount])

  // ── Search ────────────────────────────────────────────────────────

  const executeSearch = useCallback(async (currentFilters: RegistryFilters, registryName: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = buildRegistryUrl('/registry/search', {
        registry: registryName,
        q: currentFilters.q,
        sort_by: currentFilters.sort_by,
        connector_type: currentFilters.connector_type,
        verified: currentFilters.verified,
        limit: 20,
        offset: 0,
      })
      const data = await api.get<RegistryPaginatedResponse<RegistryConfigMeta>>(url)
      setResults(data.data)
      setTotal(data.total)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Effects ───────────────────────────────────────────────────────

  // Registry changed: reset state, load featured + manifest
  useEffect(() => {
    setResults([])
    setFeatured([])
    setFilters(DEFAULT_FILTERS)
    setTotal(0)
    setError(null)

    void (async () => {
      try {
        const url = buildRegistryUrl('/registry/featured', { registry, limit: 12 })
        const data = await api.get<RegistryConfigMeta[]>(url)
        setFeatured(data)
      } catch {
        // non-critical
      }
    })()

    void refetchManifest().then(() => checkUpdates(registry))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry])

  // Debounced search on filter or registry change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void executeSearch(filters, registry)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, registry])

  // ── Filter actions ────────────────────────────────────────────────

  const setFilter = useCallback((patch: Partial<RegistryFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
  }, [])

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
  }, [])

  // ── Install / uninstall ───────────────────────────────────────────

  const install = useCallback(async (namespace: string, slug: string, version?: string) => {
    await api.post('/registry/install', { namespace, slug, version, overwrite: true })
    await refetchManifest()
  }, [refetchManifest])

  const uninstall = useCallback(async (slug: string) => {
    await api.delete(`/registry/uninstall/${slug}`)
    await refetchManifest()
  }, [refetchManifest])

  // ── Derived ───────────────────────────────────────────────────────

  const isInstalled = useCallback((slug: string): boolean => {
    return manifest.some((e) => e.slug === slug)
  }, [manifest])

  const getUpdateInfo = useCallback((slug: string): RegistryUpdateInfo | undefined => {
    return updatesAvailable.get(slug)
  }, [updatesAvailable])

  return {
    results,
    featured,
    loading,
    error,
    total,
    filters,
    manifest,
    updatesAvailable,
    setFilter,
    clearFilters,
    install,
    uninstall,
    isInstalled,
    getUpdateInfo,
    checkUpdates: () => checkUpdates(registry),
    refetchManifest,
  }
}
