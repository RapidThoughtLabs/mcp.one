/**
 * Registry API client for mcp.one.space (and any other registry source).
 *
 * Every exported function accepts an optional `registryName` parameter
 * (defaults to "default") so multi-registry support is first-class.
 *
 * Auth tokens are loaded from ~/.mcp-one/credentials.json keyed by registry
 * name.  On 401 the client silently refreshes and retries once.
 */

import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  getRegistry,
  type Credentials,
} from "./auth.js";

// ── Error type ───────────────────────────────────────────────────

export class RegistryError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RegistryError";
  }
}

// ── Internal helpers ─────────────────────────────────────────────

async function parseError(res: Response): Promise<{ error: string; message: string; body: Record<string, unknown> }> {
  try {
    const body = (await res.json()) as { code?: string; error?: string; message: string; [key: string]: unknown };
    // Server returns { code, message }; normalise to { error, message } internally
    return { error: body.code ?? body.error ?? "unknown_error", message: body.message, body: body as Record<string, unknown> };
  } catch {
    return { error: "unknown_error", message: res.statusText, body: {} };
  }
}

function bearerHeaders(creds: Credentials | null): Record<string, string> {
  return creds ? { Authorization: `Bearer ${creds.access_token}` } : {};
}

/** Silently refresh tokens; returns new credentials or null. */
async function refreshAccessToken(
  creds: Credentials,
  apiBase: string,
  registry: string,
): Promise<Credentials | null> {
  if (!creds.refresh_token) return null;

  try {
    const res = await fetch(`${apiBase}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: creds.refresh_token }),
    });

    if (!res.ok) return null;

    const body = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      token_type: string;
    };

    const updated: Credentials = {
      ...creds,
      access_token:  body.access_token,
      refresh_token: body.refresh_token,
    };
    saveCredentials(updated, registry);
    return updated;
  } catch {
    return null;
  }
}

// ── Core fetch wrapper ────────────────────────────────────────────

interface FetchOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  requireAuth?: boolean;
  registryName?: string;
}

async function registryFetch(
  path: string,
  opts: FetchOptions = {},
): Promise<Response> {
  const {
    requireAuth   = false,
    registryName  = "default",
    headers: extraHeaders = {},
    ...rest
  } = opts;

  const registry = getRegistry(registryName);
  const apiBase  = `${registry.url}/api/v1`;
  const url      = path.startsWith("http") ? path : `${apiBase}${path}`;

  let creds = loadCredentials(registryName);

  if (requireAuth && !creds) {
    throw new RegistryError(
      401,
      "unauthorized",
      `Not logged in to registry "${registryName}". Run: mcp-one login${registryName !== "default" ? ` --registry ${registryName}` : ""}`,
    );
  }

  const buildHeaders = (c: Credentials | null): Record<string, string> => ({
    ...(rest.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...extraHeaders,
    ...bearerHeaders(c),
  });

  let res = await fetch(url, { ...rest, headers: buildHeaders(creds) });

  // Auto-refresh on 401
  if (res.status === 401 && creds?.refresh_token) {
    const refreshed = await refreshAccessToken(creds, apiBase, registryName);
    if (refreshed) {
      res = await fetch(url, { ...rest, headers: buildHeaders(refreshed) });
    } else {
      // Refresh failed — clear stale credentials
      clearCredentials(registryName);
    }
  }

  return res;
}

async function jsonFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const res = await registryFetch(path, opts);

  if (!res.ok) {
    const { error, message, body } = await parseError(res);
    throw new RegistryError(res.status, error, `HTTP ${res.status}: ${message}`, body);
  }

  return (await res.json()) as T;
}

// ── Auth endpoints ───────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: {
    id: string;
    username: string;
    display_name: string;
    email: string;
    avatar_url: string;
    created_at: string;
  };
}

export async function exchangeAuthCode(
  code: string,
  registryName = "default",
  redirectUri?: string,
): Promise<TokenResponse> {
  const payload: Record<string, string> = { grant_type: "authorization_code", code };
  if (redirectUri) payload["redirect_uri"] = redirectUri;
  return jsonFetch<TokenResponse>("/auth/token", {
    method: "POST",
    body: JSON.stringify(payload),
    registryName,
  });
}

export async function loginWithPassword(
  email: string,
  password: string,
  registryName = "default",
): Promise<TokenResponse> {
  return jsonFetch<TokenResponse>("/auth/token", {
    method: "POST",
    body: JSON.stringify({ grant_type: "password", email, password }),
    registryName,
  });
}

/**
 * Generate a one-time CLI auth code from an existing browser session.
 * The caller must be authenticated (Bearer JWT).  The returned code can be
 * exchanged with exchangeAuthCode() — useful for a "paste-the-code" CLI login
 * when the user is already logged in on the web dashboard.
 */
export async function generateCliAuthCode(registryName = "default"): Promise<{ code: string }> {
  return jsonFetch<{ code: string }>("/auth/code", {
    method: "POST",
    requireAuth: true,
    registryName,
  });
}

export async function apiLogout(registryName = "default"): Promise<void> {
  const creds = loadCredentials(registryName);
  if (!creds) return;

  try {
    await registryFetch("/auth/logout", {
      method: "DELETE",
      body: JSON.stringify({ refresh_token: creds.refresh_token }),
      registryName,
      requireAuth: true,
    });
  } catch {
    // Best-effort — clear local creds regardless
  }

  clearCredentials(registryName);
}

/** Build the browser URL for the OAuth login flow. */
export function buildOAuthUrl(
  callbackPort: number,
  state: string,
  registryName = "default",
): string {
  const registry = getRegistry(registryName);
  const callback = encodeURIComponent(`http://localhost:${callbackPort}/callback`);
  return `${registry.url}/login?callback=${callback}&state=${state}`;
}

// ── User ─────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  display_name: string;
  email?: string;
  bio?: string;
  avatar_url?: string;
  created_at: string;
}

export async function whoami(registryName = "default"): Promise<User> {
  return jsonFetch<User>("/users/me", { requireAuth: true, registryName });
}

// ── Discovery & browsing ─────────────────────────────────────────

export interface ConfigMeta {
  id: string;
  namespace: string;
  slug: string;
  /** Fully-qualified slug: @ns/slug:connector — use this as the canonical key. */
  qualified_slug: string;
  name: string;
  description: string;
  category: string;
  connector_type: string;
  visibility: string;
  verified: boolean;
  star_count: number;
  install_count: number;
  deprecated: boolean;
  archived: boolean;
  tags: string[];
  latest_version?: {
    version: string;
    status: string;
    message: string;
    created_at: string;
  };
  created_at: string;
  updated_at: string;
  /** Parent's qualified_slug if this config is a fork; null/absent otherwise. Immediate parent only. */
  forked_from?: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface SearchParams {
  q?: string;
  tags?: string;
  category?: string;
  connector_type?: string;
  verified?: boolean;
  namespace?: string;
  sort_by?: "popular" | "recent" | "name";
  limit?: number;
  offset?: number;
}

export async function searchConfigs(
  params: SearchParams,
  registryName = "default",
): Promise<PaginatedResponse<ConfigMeta>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  return jsonFetch<PaginatedResponse<ConfigMeta>>(
    `/configs/search?${qs}`,
    { registryName },
  );
}

export async function featuredConfigs(limit = 20, registryName = "default"): Promise<ConfigMeta[]> {
  return jsonFetch<ConfigMeta[]>(`/configs/featured?limit=${limit}`, { registryName });
}

export async function popularConfigs(limit = 20, registryName = "default"): Promise<ConfigMeta[]> {
  return jsonFetch<ConfigMeta[]>(`/configs/popular?limit=${limit}`, { registryName });
}

export async function recentConfigs(limit = 20, registryName = "default"): Promise<ConfigMeta[]> {
  return jsonFetch<ConfigMeta[]>(`/configs/recent?limit=${limit}`, { registryName });
}

export interface RegistryStats {
  total_configs: number;
  total_users: number;
  total_installs: number;
}

export async function registryStats(registryName = "default"): Promise<RegistryStats> {
  return jsonFetch<RegistryStats>("/stats", { registryName });
}

// ── Config metadata & versions ───────────────────────────────────

export async function getConfigMeta(
  namespace: string,
  slug: string,
  connectorType?: string,
  registryName = "default",
): Promise<ConfigMeta> {
  const slugWithConnector = connectorType ? `${slug}:${connectorType}` : slug;
  return jsonFetch<ConfigMeta>(`/configs/${namespace}/${slugWithConnector}`, { registryName });
}

export interface VersionMeta {
  id: string;
  version: string;
  status: string;
  message: string;
  download_count: number;
  created_at: string;
}

export async function listVersions(
  namespace: string,
  slug: string,
  registryName = "default",
): Promise<VersionMeta[]> {
  return jsonFetch<VersionMeta[]>(`/configs/${namespace}/${slug}/versions`, { registryName });
}

export interface VersionPayload {
  payload: unknown;
  version: string;
  etag: string;
}

/**
 * Download a config payload (the actual McpConfig JSON).
 * Pass version = undefined to get latest.
 * Pass connectorType to request a specific variant (appends :connector to the slug URL segment).
 */
export async function fetchVersionPayload(
  namespace: string,
  slug: string,
  connectorType: string | undefined,
  version: string | undefined,
  registryName = "default",
): Promise<VersionPayload> {
  const slugWithConnector = connectorType ? `${slug}:${connectorType}` : slug;
  const vPath = version ?? "latest";
  const res = await registryFetch(`/configs/${namespace}/${slugWithConnector}/versions/${vPath}`, {
    registryName,
  });

  if (res.status === 410) {
    throw new RegistryError(
      410,
      "yanked",
      `Version ${version} of ${namespace}/${slug} was yanked for security reasons. Run: mcp-one update`,
    );
  }
  if (!res.ok) {
    const body = await parseError(res);
    throw new RegistryError(res.status, body.error, body.message);
  }

  const payload         = await res.json();
  const resolvedVersion = (res.headers.get("X-Version") ?? version ?? "unknown");
  const etag            = (res.headers.get("ETag") ?? "").replace(/"/g, "");

  return { payload, version: resolvedVersion, etag };
}

// ── Update checking ──────────────────────────────────────────────

export interface InstalledEntry {
  slug: string;
  version: string;
}

export interface UpdateInfo {
  slug: string;
  installed_version: string;
  latest_version: string;
  severity: "patch" | "minor" | "major";
  changelog: string;
  breaking: boolean;
}

export interface DeprecatedInfo {
  slug: string;
  installed_version: string;
  replacement: string;
  message: string;
}

export interface CheckUpdatesResponse {
  updates: UpdateInfo[];
  deprecated: DeprecatedInfo[];
  up_to_date: InstalledEntry[];
}

export async function checkUpdates(
  installed: InstalledEntry[],
  registryName = "default",
): Promise<CheckUpdatesResponse> {
  return jsonFetch<CheckUpdatesResponse>("/configs/check-updates", {
    method: "POST",
    body: JSON.stringify({ installed }),
    registryName,
  });
}

// ── Publishing ───────────────────────────────────────────────────

export interface PublishNewPayload {
  namespace: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  connector_type: string;
  visibility: "public" | "private";
  tags: string[];
  payload: unknown;
  message: string;
}

export interface PublishNewResponse {
  config: ConfigMeta;
  version: VersionMeta;
}

export async function publishNew(
  data: PublishNewPayload,
  registryName = "default",
): Promise<PublishNewResponse> {
  // Server stores namespace as-is — strip leading @ so "@ruchit" → "ruchit"
  const normalized = { ...data, namespace: data.namespace.replace(/^@/, "") };
  return jsonFetch<PublishNewResponse>("/configs/", {
    method: "POST",
    body: JSON.stringify(normalized),
    requireAuth: true,
    registryName,
  });
}

export interface PublishVersionPayload {
  version?: string;   // ignored by the registry — kept optional for CLI compat
  payload: unknown;
  message: string;
}

export async function publishVersion(
  namespace: string,
  slug: string,
  data: PublishVersionPayload,
  registryName = "default",
): Promise<VersionMeta> {
  return jsonFetch<VersionMeta>(`/configs/${namespace}/${slug}/versions`, {
    method: "POST",
    body: JSON.stringify(data),
    requireAuth: true,
    registryName,
  });
}

// ── Submissions ──────────────────────────────────────────────────

export interface SubmissionPayload {
  base_version: string;
  proposed_version: string;
  payload: unknown;
  message: string;
}

export async function submitChange(
  namespace: string,
  slug: string,
  data: SubmissionPayload,
  registryName = "default",
): Promise<unknown> {
  return jsonFetch(`/configs/${namespace}/${slug}/submissions`, {
    method: "POST",
    body: JSON.stringify(data),
    requireAuth: true,
    registryName,
  });
}

// ── Forking ──────────────────────────────────────────────────────

/**
 * Fork a published config into the authenticated user's namespace.
 * Server sets forked_from, copies the latest payload as v1.0.0, and notifies the original author.
 * Returns 409 if userUsername/slug already exists, or if source has no published versions.
 */
export async function forkConfig(
  namespace: string,
  slug: string,
  registryName = "default",
): Promise<ConfigMeta> {
  return jsonFetch<ConfigMeta>(`/configs/${namespace}/${slug}/fork`, {
    method: "POST",
    requireAuth: true,
    registryName,
  });
}

// ── Submissions ──────────────────────────────────────────────────

export type SubmissionStatus = "pending" | "approved" | "rejected" | "merged" | "withdrawn";

export interface SubmissionMeta {
  id: string;
  config_id: string;
  namespace: string;
  slug: string;
  base_version: string;
  proposed_version: string;
  message: string;
  status: SubmissionStatus;
  submitted_by: string;
  votes: Array<{ user_id: string; vote: "approve" | "reject"; created_at: string }>;
  created_at: string;
  updated_at: string;
}

/** List submissions for a specific config. No auth required. */
export async function listSubmissions(
  namespace: string,
  slug: string,
  opts: { status?: SubmissionStatus; limit?: number; offset?: number } = {},
  registryName = "default",
): Promise<PaginatedResponse<SubmissionMeta>> {
  const qs = new URLSearchParams();
  if (opts.status !== undefined) qs.set("status", opts.status);
  if (opts.limit  !== undefined) qs.set("limit",  String(opts.limit));
  if (opts.offset !== undefined) qs.set("offset", String(opts.offset));
  const query = qs.toString() ? `?${qs}` : "";
  return jsonFetch<PaginatedResponse<SubmissionMeta>>(
    `/configs/${namespace}/${slug}/submissions${query}`,
    { registryName },
  );
}

/** Get a single submission by id. */
export async function getSubmission(
  id: string,
  registryName = "default",
): Promise<SubmissionMeta> {
  return jsonFetch<SubmissionMeta>(`/submissions/${id}`, { registryName });
}

// ── Notifications ────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: string;         // "vote.cast" | "submission.merged" | "submission.created" | …
  payload: unknown;
  read: boolean;
  created_at: string;
}

export async function listNotifications(registryName = "default"): Promise<Notification[]> {
  return jsonFetch<Notification[]>("/users/me/notifications", {
    requireAuth: true,
    registryName,
  });
}

// ── Social ───────────────────────────────────────────────────────

export async function starConfig(
  namespace: string,
  slug: string,
  registryName = "default",
): Promise<void> {
  const res = await registryFetch(`/configs/${namespace}/${slug}/star`, {
    method: "POST",
    requireAuth: true,
    registryName,
  });
  if (!res.ok && res.status !== 204) {
    const body = await parseError(res);
    throw new RegistryError(res.status, body.error, body.message);
  }
}

export async function unstarConfig(
  namespace: string,
  slug: string,
  registryName = "default",
): Promise<void> {
  const res = await registryFetch(`/configs/${namespace}/${slug}/star`, {
    method: "DELETE",
    requireAuth: true,
    registryName,
  });
  if (!res.ok && res.status !== 204) {
    const body = await parseError(res);
    throw new RegistryError(res.status, body.error, body.message);
  }
}

// ── API Keys ─────────────────────────────────────────────────────

export interface ApiKeyPayload {
  name: string;
  scopes: string[];
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  full_key?: string;
  created_at: string;
}

export async function createApiKey(
  data: ApiKeyPayload,
  registryName = "default",
): Promise<ApiKey> {
  return jsonFetch<ApiKey>("/users/me/api-keys", {
    method: "POST",
    body: JSON.stringify(data),
    requireAuth: true,
    registryName,
  });
}

export async function listApiKeys(registryName = "default"): Promise<ApiKey[]> {
  return jsonFetch<ApiKey[]>("/users/me/api-keys", { requireAuth: true, registryName });
}

export async function deleteApiKey(id: string, registryName = "default"): Promise<void> {
  const res = await registryFetch(`/users/me/api-keys/${id}`, {
    method: "DELETE",
    requireAuth: true,
    registryName,
  });
  if (!res.ok && res.status !== 204) {
    const body = await parseError(res);
    throw new RegistryError(res.status, body.error, body.message);
  }
}
