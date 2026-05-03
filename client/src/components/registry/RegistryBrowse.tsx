import { useState } from 'react'
import { Search, RefreshCw, Loader2, PackageSearch, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { RegistryCard } from './RegistryCard'
import type { RegistryConfigMeta, RegistryUpdateInfo, RegistrySource } from '@/types/registry'
import type { RegistryFilters } from '@/hooks/useRegistry'

const CONNECTOR_TYPES = ['http', 'cli', 'file', 'grpc', 'graphql', 'mcp'] as const
const SORT_OPTIONS: { value: RegistryFilters['sort_by']; label: string }[] = [
  { value: 'popular', label: 'Most Popular' },
  { value: 'recent', label: 'Most Recent' },
  { value: 'name', label: 'Name A–Z' },
]

interface RegistryBrowseProps {
  results: RegistryConfigMeta[]
  featured: RegistryConfigMeta[]
  loading: boolean
  error: string | null
  total: number
  filters: RegistryFilters
  selectedRegistry: string
  availableSources: RegistrySource[]
  onSelectRegistry: (name: string) => void
  onSetFilter: (patch: Partial<RegistryFilters>) => void
  onClearFilters: () => void
  onRefetch: () => void
  isInstalled: (slug: string) => boolean
  getUpdateInfo: (slug: string) => RegistryUpdateInfo | undefined
  onSelect: (config: RegistryConfigMeta) => void
}

export function RegistryBrowse({
  results,
  featured,
  loading,
  error,
  total,
  filters,
  selectedRegistry,
  availableSources,
  onSelectRegistry,
  onSetFilter,
  onClearFilters,
  onRefetch,
  isInstalled,
  getUpdateInfo,
  onSelect,
}: RegistryBrowseProps) {
  const [searchInput, setSearchInput] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const hasActiveSearch = !!searchInput.trim() || !!filters.connector_type || !!filters.verified

  const handleSearchInput = (value: string) => {
    setSearchInput(value)
    onSetFilter({ q: value || undefined })
  }

  const clearSearch = () => {
    setSearchInput('')
    onClearFilters()
  }

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 10,
  } as const

  const sectionLabel = (text: string) => (
    <div style={{
      padding: '14px 0 6px',
      fontSize: 9,
      letterSpacing: '0.16em',
      color: 'var(--text-dim)',
      textTransform: 'uppercase',
    }}>
      {text}
    </div>
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header bar */}
      <div style={{
        height: 42, background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 16px', flexShrink: 0, gap: 10,
      }}>
        <span style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)' }}>
          <span style={{ color: 'var(--accent)' }}>registry</span> / browse
        </span>
        {loading && <Loader2 size={11} style={{ color: 'var(--text-dim)', animation: 'spin 1s linear infinite' }} />}
        <div style={{ flex: 1 }} />
        {hasActiveSearch && (
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            {total} result{total !== 1 ? 's' : ''}
          </span>
        )}
        {/* Source picker — shown when multiple sources are configured */}
        {availableSources.length > 1 && (
          <select
            value={selectedRegistry}
            onChange={(e) => onSelectRegistry(e.target.value)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '2px 8px',
              color: 'var(--text-dim)',
              fontSize: 9,
              fontFamily: "'JetBrains Mono', monospace",
              cursor: 'pointer',
              letterSpacing: '0.06em',
              outline: 'none',
            }}
          >
            {availableSources.map((s) => (
              <option key={s.name} value={s.name} style={{ background: 'var(--surface)', color: 'var(--text)' }}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" variant="ghost" onClick={() => setShowFilters((v) => !v)} title="Filters">
          <SlidersHorizontal size={11} style={{ color: showFilters ? 'var(--accent)' : undefined }} />
        </Button>
        <Button size="sm" variant="ghost" onClick={onRefetch} title="Refresh">
          <RefreshCw size={11} />
        </Button>
      </div>

      {/* Search bar */}
      <div style={{
        padding: '10px 16px', background: 'var(--surface)',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--surface2)', border: '1px solid var(--border2)',
          borderRadius: 5, padding: '6px 10px',
        }}>
          <Search size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder="Search configs… (e.g. github, postgres, openai)"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 11, color: 'var(--text)', letterSpacing: '0.03em',
              fontFamily: 'inherit',
            }}
          />
          {searchInput && (
            <button
              onClick={clearSearch}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
            >
              <X size={12} style={{ color: 'var(--text-dim)' }} />
            </button>
          )}
        </div>
      </div>

      {/* Filter row */}
      {showFilters && (
        <div style={{
          padding: '8px 16px', background: 'var(--surface)',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Sort:
          </span>
          {SORT_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onSetFilter({ sort_by: value })}
              style={{
                fontSize: 9, padding: '3px 10px', borderRadius: 99, cursor: 'pointer',
                border: `1px solid ${filters.sort_by === value ? 'var(--accent)' : 'var(--border2)'}`,
                background: filters.sort_by === value ? 'var(--accent-dim)' : 'transparent',
                color: filters.sort_by === value ? 'var(--accent)' : 'var(--text-dim)',
                letterSpacing: '0.06em', transition: 'all 0.12s',
              }}
            >
              {label}
            </button>
          ))}

          <div style={{ width: 1, height: 14, background: 'var(--border2)' }} />

          <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Type:
          </span>
          {CONNECTOR_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => onSetFilter({ connector_type: filters.connector_type === type ? undefined : type })}
              style={{
                fontSize: 9, padding: '3px 10px', borderRadius: 99, cursor: 'pointer',
                border: `1px solid ${filters.connector_type === type ? 'var(--accent)' : 'var(--border2)'}`,
                background: filters.connector_type === type ? 'var(--accent-dim)' : 'transparent',
                color: filters.connector_type === type ? 'var(--accent)' : 'var(--text-dim)',
                letterSpacing: '0.06em', transition: 'all 0.12s',
              }}
            >
              {type.toUpperCase()}
            </button>
          ))}

          <div style={{ width: 1, height: 14, background: 'var(--border2)' }} />

          <button
            onClick={() => onSetFilter({ verified: filters.verified ? undefined : true })}
            style={{
              fontSize: 9, padding: '3px 10px', borderRadius: 99, cursor: 'pointer',
              border: `1px solid ${filters.verified ? 'var(--accent)' : 'var(--border2)'}`,
              background: filters.verified ? 'var(--accent-dim)' : 'transparent',
              color: filters.verified ? 'var(--accent)' : 'var(--text-dim)',
              letterSpacing: '0.06em', transition: 'all 0.12s',
            }}
          >
            ✓ Verified only
          </button>

          {hasActiveSearch && (
            <button
              onClick={clearSearch}
              style={{
                fontSize: 9, padding: '3px 10px', borderRadius: 99, cursor: 'pointer',
                border: '1px solid var(--border2)', background: 'transparent',
                color: 'var(--text-dim)', letterSpacing: '0.06em',
                marginLeft: 'auto',
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {error ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 10, padding: '60px 20px', color: 'var(--red)',
          }}>
            <PackageSearch size={28} style={{ opacity: 0.5 }} />
            <span style={{ fontSize: 11, letterSpacing: '0.04em' }}>Failed to load registry</span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'center' }}>{error}</span>
            <Button size="sm" variant="ghost" onClick={onRefetch}>Retry</Button>
          </div>
        ) : (
          <>
            {/* Featured section — hidden while searching */}
            {!hasActiveSearch && featured.length > 0 && (
              <>
                {sectionLabel('Featured')}
                <div style={{ ...gridStyle, marginBottom: 24 }}>
                  {featured.map((cfg) => (
                    <RegistryCard
                      key={cfg.id ?? `${cfg.namespace}/${cfg.slug}`}
                      config={cfg}
                      isInstalled={isInstalled(cfg.slug)}
                      updateInfo={getUpdateInfo(cfg.slug)}
                      onClick={() => onSelect(cfg)}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Results section */}
            {!hasActiveSearch && sectionLabel('Browse')}
            {loading && results.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 10, padding: '60px 20px', color: 'var(--text-dim)',
              }}>
                <Loader2 size={28} style={{ opacity: 0.3, animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 10, letterSpacing: '0.06em' }}>Loading registry…</span>
              </div>
            ) : results.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 12, padding: '60px 20px', color: 'var(--text-dim)',
              }}>
                <PackageSearch size={28} style={{ opacity: 0.2 }} />
                <span style={{ fontSize: 11, letterSpacing: '0.04em' }}>No configs found</span>
                {hasActiveSearch && (
                  <Button size="sm" variant="ghost" onClick={clearSearch}>Clear search</Button>
                )}
              </div>
            ) : (
              <div style={gridStyle}>
                {results.map((cfg) => (
                  <RegistryCard
                    key={cfg.id ?? `${cfg.namespace}/${cfg.slug}`}
                    config={cfg}
                    isInstalled={isInstalled(cfg.slug)}
                    updateInfo={getUpdateInfo(cfg.slug)}
                    onClick={() => onSelect(cfg)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
