/**
 * Registry credential storage, OAuth browser flow, multi-registry config,
 * and local installed-config manifest.
 *
 * Directory layout under ~/.mcp-one/
 *   registries.json       — named registry sources
 *   credentials.json      — tokens keyed by registry name
 *   installed.json        — manifest of installed configs (slug + version + registry)
 */

import fs   from "node:fs";
import path from "node:path";
import os   from "node:os";
import http from "node:http";
import crypto from "node:crypto";

// ── Paths ────────────────────────────────────────────────────────

export const MCP_ONE_DIR   = path.join(os.homedir(), ".mcp-one");
const REGISTRIES_FILE      = path.join(MCP_ONE_DIR, "registries.json");
const CREDENTIALS_FILE     = path.join(MCP_ONE_DIR, "credentials.json");
const MANIFEST_FILE        = path.join(MCP_ONE_DIR, "installed.json");

// ── Registry sources ─────────────────────────────────────────────

export interface RegistrySource {
  name: string;
  url: string;
}

const DEFAULT_REGISTRY: RegistrySource = {
  name: "default",
  url: "https://mcp.rapidthoughtlabs.space",
};

export function loadRegistries(): RegistrySource[] {
  if (!fs.existsSync(REGISTRIES_FILE)) return [DEFAULT_REGISTRY];

  try {
    const parsed = JSON.parse(fs.readFileSync(REGISTRIES_FILE, "utf-8")) as RegistrySource[];
    // Always enforce the current default registry URL (guards against stale cached URLs)
    const defaultIdx = parsed.findIndex((r) => r.name === "default");
    if (defaultIdx !== -1) {
      parsed[defaultIdx] = DEFAULT_REGISTRY;
    } else {
      parsed.unshift(DEFAULT_REGISTRY);
    }
    return parsed;
  } catch {
    return [DEFAULT_REGISTRY];
  }
}

export function saveRegistries(registries: RegistrySource[]): void {
  fs.mkdirSync(MCP_ONE_DIR, { recursive: true });
  fs.writeFileSync(REGISTRIES_FILE, JSON.stringify(registries, null, 2) + "\n", "utf-8");
}

export function getRegistry(name = "default"): RegistrySource {
  const registries = loadRegistries();
  const found = registries.find((r) => r.name === name);
  if (!found) {
    throw new Error(
      `Unknown registry "${name}". Run: mcp-one registry list`,
    );
  }
  return found;
}

export function addRegistry(name: string, url: string): void {
  const registries = loadRegistries();
  const existing = registries.findIndex((r) => r.name === name);
  if (existing !== -1) {
    registries[existing] = { name, url };
  } else {
    registries.push({ name, url });
  }
  saveRegistries(registries);
}

export function removeRegistry(name: string): void {
  if (name === "default") throw new Error('Cannot remove the "default" registry.');
  const registries = loadRegistries().filter((r) => r.name !== name);
  saveRegistries(registries);
}

// ── Credentials (keyed by registry name) ─────────────────────────

export interface Credentials {
  access_token: string;
  refresh_token?: string;
  username?: string;
}

type CredentialStore = Record<string, Credentials>;

function loadCredentialStore(): CredentialStore {
  if (!fs.existsSync(CREDENTIALS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf-8")) as CredentialStore;
  } catch {
    return {};
  }
}

function saveCredentialStore(store: CredentialStore): void {
  fs.mkdirSync(MCP_ONE_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(store, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600, // owner-only
  });
}

export function loadCredentials(registry = "default"): Credentials | null {
  // Env var takes precedence (CI/CD) — only applies to the default registry
  if (registry === "default" && process.env.MCP_ONE_TOKEN) {
    const token = process.env.MCP_ONE_TOKEN;
    // API keys are prefixed mcp1_ — no refresh token needed
    return { access_token: token };
  }

  const store = loadCredentialStore();
  const creds = store[registry];
  if (!creds?.access_token) return null;
  return creds;
}

export function saveCredentials(creds: Credentials, registry = "default"): void {
  const store = loadCredentialStore();
  store[registry] = creds;
  saveCredentialStore(store);
}

export function clearCredentials(registry = "default"): void {
  const store = loadCredentialStore();
  delete store[registry];
  saveCredentialStore(store);
}

export function isLoggedIn(registry = "default"): boolean {
  return loadCredentials(registry) !== null;
}

// ── OAuth browser callback listener ──────────────────────────────

export interface OAuthCallbackResult {
  code: string;
  state: string;
}

/**
 * Start a temporary HTTP server on a random available port to receive the
 * OAuth callback.  Returns the port, state nonce, and a promise that resolves
 * when the browser hits /callback.
 */
export function startOAuthListener(): {
  port: number;
  state: string;
  result: Promise<OAuthCallbackResult>;
  close: () => void;
} {
  const state = crypto.randomBytes(16).toString("hex");
  let resolveResult!: (v: OAuthCallbackResult) => void;
  let rejectResult!: (e: Error) => void;

  const result = new Promise<OAuthCallbackResult>((res, rej) => {
    resolveResult = res;
    rejectResult  = rej;
  });

  const server = http.createServer((req, incoming_res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname !== "/callback") {
      incoming_res.writeHead(404);
      incoming_res.end("Not found");
      return;
    }

    const code          = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");

    if (!code || returnedState !== state) {
      incoming_res.writeHead(400, { "Content-Type": "text/html" });
      incoming_res.end(htmlPage("Authentication failed", "State mismatch or missing code. Please try again."));
      server.close();
      rejectResult(new Error("OAuth state mismatch or missing code"));
      return;
    }

    incoming_res.writeHead(200, { "Content-Type": "text/html" });
    incoming_res.end(htmlPage("Authenticated!", "You can close this tab and return to the terminal."));
    server.close();
    resolveResult({ code, state: returnedState });
  });

  // Listen on OS-assigned random port
  server.listen(0);

  const timeout = setTimeout(() => {
    server.close();
    rejectResult(new Error("OAuth callback timed out (5 min). Please try again."));
  }, 5 * 60 * 1000);

  server.on("close", () => clearTimeout(timeout));

  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;

  return {
    port,
    state,
    result,
    close: () => server.close(),
  };
}

function htmlPage(heading: string, body: string): string {
  return `<!DOCTYPE html><html><head><style>
    body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f0f0f;color:#fff}
    .card{text-align:center;padding:40px;border-radius:12px;background:#1a1a1a;border:1px solid #333}
    h2{margin:0 0 12px}p{margin:0;color:#aaa}
  </style></head><body><div class="card"><h2>${heading}</h2><p>${body}</p></div></body></html>`;
}

// ── Manifest (installed configs) ─────────────────────────────────

export interface ManifestEntry {
  /** Fully-qualified slug: @ns/slug:connector */
  slug: string;
  version: string;
  registry: string;
  connector_type: string;
  installed_at: string;
  /** Parent's qualified_slug if this config is a fork; null/absent for legacy entries. */
  forked_from?: string | null;
}

export interface Manifest {
  installed: ManifestEntry[];
}

export function loadManifest(): Manifest {
  if (!fs.existsSync(MANIFEST_FILE)) return { installed: [] };
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf-8")) as Manifest;
  } catch {
    return { installed: [] };
  }
}

export function saveManifest(manifest: Manifest): void {
  fs.mkdirSync(MCP_ONE_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

export function addToManifest(
  qualifiedSlug: string,
  version: string,
  connectorType: string,
  registry = "default",
  forkedFrom: string | null = null,
): void {
  const manifest = loadManifest();
  const idx = manifest.installed.findIndex(
    (e) => e.slug === qualifiedSlug && e.registry === registry,
  );
  const entry: ManifestEntry = {
    slug: qualifiedSlug,
    version,
    registry,
    connector_type: connectorType,
    installed_at: new Date().toISOString(),
    forked_from: forkedFrom,
  };

  if (idx !== -1) {
    manifest.installed[idx] = entry;
  } else {
    manifest.installed.push(entry);
  }
  saveManifest(manifest);
}

/** Find all installed entries matching a bare slug (without :connector), e.g. "@ruchit/github". */
export function getInstalledEntriesByBareName(bareName: string, registry: string): ManifestEntry[] {
  return loadManifest().installed.filter((e) => {
    const bareSlug = e.slug.replace(/:.*$/, ""); // strip :connector
    return bareSlug === bareName && e.registry === registry;
  });
}

/**
 * Find the manifest entry whose bare slug matches `rawSlug` and connector_type matches `connectorType`.
 * Used to detect cross-namespace collisions on the same on-disk filename.
 * Returns undefined if no entry matches.
 */
export function findEntryByBareSlugAndConnector(
  rawSlug: string,
  connectorType: string,
  registry: string,
): ManifestEntry | undefined {
  return loadManifest().installed.find((e) => {
    if (e.registry !== registry) return false;
    const slashIdx = e.slug.indexOf("/");
    if (slashIdx === -1) return false;
    const afterSlash = e.slug.slice(slashIdx + 1);
    const colonIdx = afterSlash.indexOf(":");
    const bare = colonIdx !== -1 ? afterSlash.slice(0, colonIdx) : afterSlash;
    return bare === rawSlug && e.connector_type === connectorType;
  });
}

export function removeFromManifest(slug: string, registry = "default"): void {
  const manifest = loadManifest();
  manifest.installed = manifest.installed.filter(
    (e) => !(e.slug === slug && e.registry === registry),
  );
  saveManifest(manifest);
}

export function getInstalledEntry(slug: string, registry = "default"): ManifestEntry | undefined {
  return loadManifest().installed.find(
    (e) => e.slug === slug && e.registry === registry,
  );
}
