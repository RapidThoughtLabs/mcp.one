// Registry types for the web UI — mirrors shapes from src/registry/client.ts

export interface RegistryConfigMeta {
  id: string
  namespace: string
  slug: string
  qualified_slug: string
  forked_from?: string | null
  name: string
  description: string
  category: string
  connector_type: string
  visibility: string
  verified: boolean
  stars: number
  installs: number
  forks?: number
  watches?: number
  deprecated: boolean
  archived: boolean
  tags?: string[]
  latest_version?: {
    version: string
    status: string
    message: string
    created_at: string
  }
  created_at: string
  updated_at: string
}

export interface RegistryPaginatedResponse<T> {
  data: T[]
  total: number
  limit: number
  offset: number
}

export interface RegistrySearchParams {
  q?: string
  tags?: string
  category?: string
  connector_type?: string
  verified?: boolean
  namespace?: string
  sort_by?: 'popular' | 'recent' | 'name'
  limit?: number
  offset?: number
}

export interface RegistryUpdateInfo {
  slug: string
  installed_version: string
  latest_version: string
  severity: 'patch' | 'minor' | 'major'
  changelog: string
  breaking: boolean
}

export interface RegistryDeprecatedInfo {
  slug: string
  installed_version: string
  replacement: string
  message: string
}

export interface RegistryCheckUpdatesResponse {
  updates: RegistryUpdateInfo[]
  deprecated: RegistryDeprecatedInfo[]
  up_to_date: { slug: string; version: string }[]
}

export interface ManifestEntry {
  slug: string
  version: string
  registry: string
  installed_at: string
}

export interface Manifest {
  installed: ManifestEntry[]
}

export interface RegistryFilters {
  q?: string
  sort_by?: 'popular' | 'recent' | 'name'
  connector_type?: string
  verified?: boolean
}

export interface RegistrySource {
  name: string
  url: string
}

export interface RegistryStats {
  total_configs: number
  total_users: number
  total_installs: number
}

export interface RegistryUser {
  id: string
  username: string
  display_name: string
  email?: string
  bio?: string
  avatar_url?: string
  created_at: string
}

export interface RegistryAuthStatus {
  loggedIn: boolean
  user?: RegistryUser
}

export interface ConfigPayloadParam {
  name: string
  description?: string
  type?: string
  required?: boolean
}

export interface ConfigPayloadTool {
  name: string
  description?: string
  params?: ConfigPayloadParam[]
}

export interface ConfigPayloadOverlay {
  description?: string
  active?: boolean
  params?: Record<string, { description?: string }>
}

export interface ConfigPayload {
  id?: string
  name?: string
  tools?: ConfigPayloadTool[]
  registry_overlays?: Record<string, ConfigPayloadOverlay>
}
