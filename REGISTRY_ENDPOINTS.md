# Registry Page — Endpoint Audit

> This document describes the full call chain from the mcp.one demo client app
> through to the remote registry server. Written so the registry repo maintainer
> can confirm or correct each endpoint and response shape.

---

## Architecture overview

```
Browser (React client)
  → local Express server  (/api/registry/*)   [server/registry-api.ts]
      → remote registry   (https://mcp.rapidthoughtlabs.space/api/v1)
                           [src/registry/client.ts]
```

The local Express server is a thin proxy. All actual data comes from the remote
registry. The client-side code never talks to the remote registry directly.

---

## 1. Endpoints the client calls on the local server

All paths are relative to the app origin (e.g. `http://localhost:3000`).

### 1a. `GET /api/registry/sources`

**When:** on registry page mount  
**Purpose:** list configured registry sources (name + url)  
**Expected response:**
```json
[
  { "name": "default", "url": "https://mcp.rapidthoughtlabs.space" }
]
```
**Local handler:** reads `~/.mcp-one/registries.json`, always includes the
hardcoded default registry.

---

### 1b. `GET /api/registry/featured?registry=<name>&limit=12`

**When:** on registry page mount and whenever the selected registry changes  
**Purpose:** load the featured/highlighted configs for the landing page  
**Expected response:** plain array of config objects (NOT paginated)
```json
[
  {
    "id": "uuid",
    "namespace": "ruchit",
    "slug": "github",
    "name": "GitHub",
    "description": "...",
    "category": "...",
    "connector_type": "http",
    "visibility": "public",
    "verified": true,
    "star_count": 42,
    "install_count": 100,
    "deprecated": false,
    "archived": false,
    "tags": ["git", "vcs"],
    "latest_version": {
      "version": "1.0.0",
      "status": "published",
      "message": "initial release",
      "created_at": "2025-01-01T00:00:00Z"
    },
    "created_at": "2025-01-01T00:00:00Z",
    "updated_at": "2025-01-01T00:00:00Z"
  }
]
```
**Remote endpoint:** `GET /api/v1/configs/featured?limit=12`  
**Important:** client expects a **plain JSON array**, not a paginated wrapper.
If the remote returns `{ data: [...], total: N }` the featured section silently
stays empty (error is caught and swallowed).

---

### 1c. `GET /api/registry/search?registry=<name>&q=<text>&sort_by=popular&connector_type=<type>&verified=true&limit=20&offset=0`

**When:** on every filter or search-query change (debounced 300 ms), and
automatically on page load (triggers with default filters immediately)  
**Purpose:** search / browse configs  
**Expected response:** paginated wrapper
```json
{
  "data": [ ...ConfigMeta objects... ],
  "total": 123,
  "limit": 20,
  "offset": 0
}
```
**Remote endpoint:** `GET /api/v1/configs/search?q=...&sort_by=...&connector_type=...&verified=...&limit=20&offset=0`  
**Query params forwarded:**
| param | type | notes |
|---|---|---|
| `q` | string | free-text search |
| `tags` | string | comma-separated tag filter |
| `category` | string | category filter |
| `connector_type` | string | `http` \| `cli` \| `file` \| `grpc` \| `graphql` \| `mcp` |
| `verified` | `"true"` | only verified configs |
| `namespace` | string | filter by namespace |
| `sort_by` | string | `popular` \| `recent` \| `name` |
| `limit` | number | default 20 |
| `offset` | number | default 0 |

**⚠ Critical:** If the remote returns anything other than `{ data: [...], total, limit, offset }`,
the client stores `undefined` in the `results` state and the render crashes
(`results.length` is called unconditionally on the array). This is the root
cause of the crash on clear-search — see §Known bugs below.

---

### 1d. `GET /api/registry/manifest`

**When:** on page mount and after install/uninstall  
**Purpose:** list locally-installed configs  
**Expected response:**
```json
{
  "installed": [
    {
      "slug": "@ruchit/github:http",
      "version": "1.0.0",
      "registry": "default",
      "installed_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```
**Local handler:** reads `~/.mcp-one/installed.json` — no remote call.

---

### 1e. `POST /api/registry/check-updates`

**When:** after manifest is loaded on page mount  
**Purpose:** check if installed configs have newer versions  
**Request body:**
```json
{
  "registry": "default",
  "installed": [
    { "slug": "@ruchit/github:http", "version": "1.0.0" }
  ]
}
```
**Expected response:**
```json
{
  "updates": [
    {
      "slug": "@ruchit/github:http",
      "installed_version": "1.0.0",
      "latest_version": "1.1.0",
      "severity": "minor",
      "changelog": "...",
      "breaking": false
    }
  ],
  "deprecated": [],
  "up_to_date": []
}
```
**Remote endpoint:** `POST /api/v1/configs/check-updates`  
**Remote request body:** `{ "installed": [ { "slug": "...", "version": "..." } ] }`

---

### 1f. `POST /api/registry/install`

**When:** user clicks Install on a config  
**Request body:**
```json
{
  "namespace": "ruchit",
  "slug": "github",
  "connector_type": "http",
  "version": "1.0.0",
  "registry": "default",
  "overwrite": false
}
```
**Expected response (201):**
```json
{
  "ok": true,
  "configId": "github-http",
  "qualified_slug": "@ruchit/github:http",
  "version": "1.0.0"
}
```
**Remote endpoints used internally:**
1. `GET /api/v1/configs/<namespace>/<slug>:<connector_type>` — fetch metadata
2. `GET /api/v1/configs/<namespace>/<slug>:<connector_type>/versions/latest` — download payload

---

### 1g. `DELETE /api/registry/uninstall/<compound-id>`

**When:** user clicks Uninstall  
**`:compound-id`** is `<slug>-<connector_type>`, e.g. `github-http`  
**Query params:** `?registry=default`  
**Expected response:**
```json
{ "ok": true }
```
**Local handler:** deletes `mcp-configs/mcp.<id>.json` and removes from manifest.
No remote call.

---

## 2. Remote registry endpoints summary

Base URL: `https://mcp.rapidthoughtlabs.space/api/v1`

| Method | Path | Used by |
|--------|------|---------|
| GET | `/configs/featured?limit=N` | featured section on page load |
| GET | `/configs/search?q=...` | browse + search |
| POST | `/configs/check-updates` | update badge on install cards |
| GET | `/configs/<ns>/<slug>:<type>` | install flow — resolve metadata |
| GET | `/configs/<ns>/<slug>:<type>/versions/<ver>` | install flow — download payload |

---

## 3. Known bugs in the current client

### Bug A — Clear-search crashes the app (hard crash / white screen)

**Root cause:** `executeSearch` calls `api.get<RegistryPaginatedResponse<...>>(url)` and then:
```ts
const data = await api.get<RegistryPaginatedResponse<RegistryConfigMeta>>(url)
setResults(data.data)   // crashes if `data` is not { data: [...] }
setTotal(data.total)
```
If the remote search endpoint returns a **plain array** (or any shape that is not
`{ data: [], total: N, limit: N, offset: N }`), then `data.data` is `undefined`.
`setResults(undefined)` stores `undefined` in React state.

The render in `RegistryBrowse` then evaluates:
```tsx
{loading && results.length === 0   // 'loading' is false after search completes
  ? (...)
  : results.length === 0           // undefined.length → TypeError → crash
    ? (...)
    : (...)}
```
The crash surfaces on **clear** (and also on initial load) because `loading`
transitions to `false` right as results are set, triggering the ternary that
accesses `results.length` unguarded.

**Fix required:** defensive guard `setResults(Array.isArray(data?.data) ? data.data : [])`.

---

### Bug B — Featured section silently empty

**Root cause:** the featured fetch is wrapped in a silent catch:
```ts
try {
  const data = await api.get<RegistryConfigMeta[]>(url)
  setFeatured(data)        // if remote returns paginated shape, this stores an object
} catch {
  // non-critical — stays []
}
```
If the remote `/configs/featured` endpoint:
- Does not exist (404) → error is caught, featured stays `[]` → featured section never shows.
- Returns `{ data: [...] }` paginated → `setFeatured({ data: [...] })` stores an object.
  `featured.length` is `undefined` → section never renders (but no crash because React
  short-circuits on `undefined > 0`).

**Fix required:** confirm remote endpoint exists and returns a plain array, OR adapt
client to extract `data.data` if response is paginated.

---

### Bug C — `qualified_slug` field missing in `RegistryConfigMeta` type

`src/registry/client.ts → ConfigMeta` has `qualified_slug` field but
`client/src/types/registry.ts → RegistryConfigMeta` does not. This causes the
`isInstalled` check (which does `manifest.some(e => e.slug === slug)`) to compare
a bare slug against fully-qualified manifest slugs like `@ns/slug:connector` —
they never match, so all configs appear un-installed.

---

## 4. Questions for the registry repo

Please confirm or correct the following about `https://mcp.rapidthoughtlabs.space/api/v1`:

1. **Does `/configs/featured` exist?** If yes, does it return a plain `ConfigMeta[]`
   array, or a paginated `{ data: ConfigMeta[], total, limit, offset }` wrapper?

2. **Does `/configs/search` exist with the query params listed in §1c?** What is
   the exact response shape?

3. **Does `/configs/check-updates` accept `POST { installed: [...] }` and return
   `{ updates, deprecated, up_to_date }`?**

4. **Are there any endpoints that have been renamed / are at different paths?**
   (e.g. `/configs` vs `/packages`, `/api/v1` vs `/api/v2`)

5. **What fields does each `ConfigMeta` object actually contain?** In particular,
   is `qualified_slug` always present?
