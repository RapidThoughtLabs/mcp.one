/**
 * Registry operation handlers for the internal connector.
 * Thin wrappers around src/registry/client.ts — same logic as CLI commands
 * but returns structured JSON instead of printing to stdout.
 */

import fs   from "node:fs";
import path from "node:path";
import {
  searchConfigs,
  featuredConfigs,
  popularConfigs,
  recentConfigs,
  fetchVersionPayload,
  getConfigMeta,
  checkUpdates,
  RegistryError,
  type ConfigMeta,
} from "../../registry/client.js";
import { addToManifest, getInstalledEntry, loadManifest } from "../../registry/auth.js";
import type { ConnectorResult } from "../base.js";
import type { InternalContext } from "../internal.js";

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Parse an install target into its components.
 * Accepted formats:
 *   @ns/slug                   — bare (may be ambiguous if multiple variants)
 *   @ns/slug:connector         — fully qualified
 *   @ns/slug:connector@version — qualified + pinned version
 *
 * The leading @ on the namespace is stripped; the registry stores "ruchit" not "@ruchit".
 */
function parseTarget(target: string): {
  namespace: string;
  rawSlug: string;
  connectorType?: string;
  version?: string;
} {
  // Strip leading @ so "@ruchit/github:cli" → "ruchit/github:cli"
  const cleaned = target.startsWith("@") ? target.slice(1) : target;

  const slashIdx = cleaned.indexOf("/");
  if (slashIdx === -1 || slashIdx === 0 || slashIdx === cleaned.length - 1) {
    throw new Error(
      `Invalid target "${target}". Expected: @ns/slug  or  @ns/slug:connector  or  @ns/slug:connector@version`,
    );
  }

  const namespace = cleaned.slice(0, slashIdx);         // "ruchit"
  const rest      = cleaned.slice(slashIdx + 1);        // "github:cli@1.2.0"

  // Split on last @ for version (avoids confusion with @scope in npm-style names)
  const atIdx = rest.lastIndexOf("@");
  let slugPart: string;
  let version: string | undefined;

  if (atIdx !== -1) {
    slugPart = rest.slice(0, atIdx);   // "github:cli"
    version  = rest.slice(atIdx + 1);  // "1.2.0"
    if (!version) version = undefined;
  } else {
    slugPart = rest;
  }

  // Split on : for connector type
  const colonIdx = slugPart.indexOf(":");
  let rawSlug: string;
  let connectorType: string | undefined;

  if (colonIdx !== -1) {
    rawSlug       = slugPart.slice(0, colonIdx);   // "github"
    connectorType = slugPart.slice(colonIdx + 1);  // "cli"
    if (!connectorType) connectorType = undefined;
  } else {
    rawSlug = slugPart;
  }

  if (!namespace || !rawSlug) {
    throw new Error(
      `Invalid target "${target}". Expected: @ns/slug  or  @ns/slug:connector`,
    );
  }

  return { namespace, rawSlug, connectorType, version };
}

// ── handlers ─────────────────────────────────────────────────────────

export async function handleRegistrySearch(
  _ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  try {
    const result = await searchConfigs(
      {
        q:              args.query     as string | undefined,
        tags:           args.tags      as string | undefined,
        category:       args.category  as string | undefined,
        connector_type: args.connector_type as string | undefined,
        limit:          typeof args.limit === "number" ? args.limit : 20,
      },
      (args.registry as string | undefined) ?? "default",
    );
    return { success: true, data: result };
  } catch (err) {
    if (err instanceof RegistryError) {
      return { success: false, data: { error: err.message, status: err.status } };
    }
    return { success: false, data: { error: (err as Error).message } };
  }
}

export async function handleRegistryBrowse(
  _ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const mode     = (args.mode as string | undefined) ?? "featured";
  const limit    = typeof args.limit === "number" ? args.limit : 20;
  const registry = (args.registry as string | undefined) ?? "default";

  try {
    let configs;
    switch (mode) {
      case "popular":  configs = await popularConfigs(limit, registry);  break;
      case "recent":   configs = await recentConfigs(limit, registry);   break;
      case "featured":
      default:         configs = await featuredConfigs(limit, registry); break;
    }
    return { success: true, data: { mode, configs, total: configs.length } };
  } catch (err) {
    if (err instanceof RegistryError) {
      return { success: false, data: { error: err.message, status: err.status } };
    }
    return { success: false, data: { error: (err as Error).message } };
  }
}

export async function handleRegistryInstall(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const target   = args.target as string | undefined;
  const force    = args.force === true;
  const registry = (args.registry as string | undefined) ?? "default";

  if (!target) {
    return {
      success: false,
      data: { error: "target is required (format: @ns/slug  or  @ns/slug:connector  or  @ns/slug:connector@version)" },
    };
  }

  let parsed: { namespace: string; rawSlug: string; connectorType?: string; version?: string };
  try {
    parsed = parseTarget(target);
  } catch (err) {
    return { success: false, data: { error: (err as Error).message } };
  }

  const { namespace, rawSlug, connectorType, version } = parsed;

  // ── Step 1: Fetch config metadata (catches ambiguity/not-found before downloading payload) ──

  let meta: ConfigMeta;
  try {
    meta = await getConfigMeta(namespace, rawSlug, connectorType, registry);
  } catch (err) {
    if (err instanceof RegistryError) {
      if (err.status === 400 && err.code === "ambiguous_slug") {
        // D7: surface picker info — LLM must re-prompt user with a qualified slug
        return {
          success: false,
          data: {
            ambiguous: true,
            available_variants: err.body?.["available_variants"],
            examples: err.body?.["examples"],
            error: `Ambiguous target "@${namespace}/${rawSlug}" — multiple variants exist. Retry with a qualified slug (e.g. @${namespace}/${rawSlug}:http).`,
          },
        };
      }
      if (err.status === 404 && err.code === "variant_not_found") {
        return {
          success: false,
          data: {
            not_found: true,
            available_variants: err.body?.["available_variants"],
            error: err.message,
          },
        };
      }
      if (err.status === 404) {
        return { success: false, data: { error: `Config not found: @${namespace}/${rawSlug}${connectorType ? `:${connectorType}` : ""}` } };
      }
      return { success: false, data: { error: err.message, status: err.status } };
    }
    return { success: false, data: { error: (err as Error).message } };
  }

  // ── Step 2: Extract canonical identifiers from metadata (D3, D5) ──

  const qualifiedSlug       = meta.qualified_slug;   // "@ruchit/github:cli"
  const resolvedConnector   = meta.connector_type;   // "cli"
  const installedId         = `${rawSlug}-${resolvedConnector}`; // "github-cli"  (D2)

  // ── Step 3: Already-installed check ──

  const outFile = path.join(ctx.configDir, `mcp.${installedId}.json`);
  const existing = getInstalledEntry(qualifiedSlug, registry);
  // Only block if manifest says installed AND the config file actually exists in this configDir.
  // Manifest-only entries (file deleted or installed from a different cwd) are treated as not installed.
  if (existing && !force && fs.existsSync(outFile)) {
    return {
      success: false,
      data: {
        error: `"${qualifiedSlug}" is already installed at version ${existing.version}. Pass force: true to reinstall.`,
      },
    };
  }

  // ── Step 4: Collision guard — different qualified slug maps to same compound id (D2) ──

  const { installed } = loadManifest();
  const collision = installed.find((e) => {
    if (e.slug === qualifiedSlug || e.registry !== registry) return false;
    const barePart     = e.slug.replace(/^@[^/]+\//, "");   // "github:cli"
    const colonIdx     = barePart.indexOf(":");
    const entryBase    = colonIdx !== -1 ? barePart.slice(0, colonIdx) : barePart; // "github"
    const entryCt      = colonIdx !== -1 ? barePart.slice(colonIdx + 1) : "";      // "cli"
    return entryBase === rawSlug && entryCt === resolvedConnector;
  });

  if (collision) {
    return {
      success: false,
      data: {
        error: `Config id "${installedId}" conflicts with already-installed "${collision.slug}". Uninstall it first.`,
      },
    };
  }

  // ── Step 5–8: Download payload, mutate id, write file, record manifest ──

  try {
    const { payload, version: resolvedVersion } = await fetchVersionPayload(
      namespace, rawSlug, resolvedConnector, version, registry,
    );

    // D2: overwrite the id field with the compound form
    const payloadObj = payload as Record<string, unknown>;
    payloadObj.id    = installedId;

    const payloadJson = JSON.stringify(payloadObj, null, 2);

    // D1: filename is mcp.{base_id}-{connector_type}.json
    fs.mkdirSync(ctx.configDir, { recursive: true });
    fs.writeFileSync(outFile, payloadJson + "\n", "utf-8");

    // D3: manifest stores the fully-qualified slug
    addToManifest(qualifiedSlug, resolvedVersion, resolvedConnector, registry);

    return {
      success: true,
      data: {
        qualified_slug: qualifiedSlug,
        id:      installedId,
        version: resolvedVersion,
        file:    outFile,
        message: `Installed ${qualifiedSlug}@${resolvedVersion}. The server will hot-reload it automatically.`,
      },
    };
  } catch (err) {
    if (err instanceof RegistryError) {
      if (err.status === 410) {
        return { success: false, data: { error: `Version was yanked: ${err.message}` } };
      }
      return { success: false, data: { error: err.message, status: err.status } };
    }
    return { success: false, data: { error: (err as Error).message } };
  }
}

export async function handleRegistryUpdate(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const configId = args.config_id as string | undefined;
  const registry = (args.registry as string | undefined) ?? "default";

  const { installed } = loadManifest();
  const forRegistry = installed.filter((e) => e.registry === registry);

  let toCheck: typeof installed;

  if (configId) {
    // Find the manifest entry that matches this compound config ID (e.g. "github-http")
    const entry = forRegistry.find((e) => {
      const withoutNs = e.slug.replace(/^@[^/]+\//, "");
      const colonIdx  = withoutNs.indexOf(":");
      if (colonIdx === -1) return false;
      const base = withoutNs.slice(0, colonIdx);
      const ct   = withoutNs.slice(colonIdx + 1);
      return `${base}-${ct}` === configId;
    });
    if (!entry) {
      return {
        success: false,
        data: { error: `"${configId}" is not a registry-installed config or was not found in the manifest. Only configs installed from the registry can be updated this way.` },
      };
    }
    toCheck = [entry];
  } else {
    if (forRegistry.length === 0) {
      return { success: true, data: { message: "No registry-installed configs to update", updated: [], up_to_date: [] } };
    }
    toCheck = forRegistry;
  }

  let updateCheck: Awaited<ReturnType<typeof checkUpdates>>;
  try {
    updateCheck = await checkUpdates(
      toCheck.map((e) => ({ slug: e.slug, version: e.version })),
      registry,
    );
  } catch (err) {
    if (err instanceof RegistryError) {
      return { success: false, data: { error: err.message, status: err.status } };
    }
    return { success: false, data: { error: (err as Error).message } };
  }

  if (updateCheck.updates.length === 0) {
    return {
      success: true,
      data: { message: "All configs are up to date", up_to_date: updateCheck.up_to_date },
    };
  }

  const updated: { slug: string; id: string; from: string; to: string }[] = [];
  const errors:  { slug: string; error: string }[] = [];

  for (const info of updateCheck.updates) {
    // Parse "@ns/slug:connector" from the slug
    const withoutAt  = info.slug.startsWith("@") ? info.slug.slice(1) : info.slug;
    const slashIdx   = withoutAt.indexOf("/");
    if (slashIdx === -1) continue;
    const namespace  = withoutAt.slice(0, slashIdx);
    const rest       = withoutAt.slice(slashIdx + 1);
    const colonIdx   = rest.indexOf(":");
    const rawSlug    = colonIdx !== -1 ? rest.slice(0, colonIdx) : rest;
    const connType   = colonIdx !== -1 ? rest.slice(colonIdx + 1) : undefined;
    const installedId = `${rawSlug}-${connType ?? ""}`;
    const outFile    = path.join(ctx.configDir, `mcp.${installedId}.json`);

    try {
      const { payload, version: resolvedVersion } = await fetchVersionPayload(
        namespace, rawSlug, connType, info.latest_version, registry,
      );

      const payloadObj = payload as Record<string, unknown>;
      payloadObj.id    = installedId;

      // Preserve local env vars and overlays from existing file
      if (fs.existsSync(outFile)) {
        try {
          const existing = JSON.parse(fs.readFileSync(outFile, "utf-8")) as Record<string, unknown>;
          const existingConnector = existing.connector as Record<string, unknown> | undefined;
          if (existingConnector?.env) {
            const newConnector = (payloadObj.connector as Record<string, unknown> | undefined) ?? {};
            newConnector.env   = existingConnector.env;
            payloadObj.connector = newConnector;
          }
          const existingOverlays = (existing.overlays ?? {}) as Record<string, unknown>;
          const newOverlays      = (payloadObj.overlays ?? {}) as Record<string, unknown>;
          payloadObj.overlays    = { ...existingOverlays, ...newOverlays };
        } catch {
          // Can't read existing file — proceed with fresh payload
        }
      }

      fs.mkdirSync(ctx.configDir, { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify(payloadObj, null, 2) + "\n", "utf-8");
      addToManifest(info.slug, resolvedVersion, connType ?? "", registry);

      updated.push({ slug: info.slug, id: installedId, from: info.installed_version, to: resolvedVersion });
    } catch (err) {
      if (err instanceof RegistryError) {
        errors.push({ slug: info.slug, error: err.message });
      } else {
        errors.push({ slug: info.slug, error: (err as Error).message });
      }
    }
  }

  return {
    success: errors.length === 0,
    data: {
      message: updated.length > 0
        ? `Updated ${updated.length} config(s).${errors.length > 0 ? ` ${errors.length} failed.` : ""} Server will hot-reload automatically.`
        : `All configs are up to date.`,
      updated,
      up_to_date: updateCheck.up_to_date,
      ...(errors.length > 0 && { errors }),
    },
  };
}

export async function handleRegistryCheckUpdates(
  _ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const registry = (args.registry as string | undefined) ?? "default";

  try {
    const { installed } = loadManifest();
    const forRegistry = installed.filter((e) => e.registry === registry);

    if (forRegistry.length === 0) {
      return { success: true, data: { message: "No installed configs for this registry", updates: [], deprecated: [], up_to_date: [] } };
    }

    const result = await checkUpdates(
      forRegistry.map((e) => ({ slug: e.slug, version: e.version })),
      registry,
    );

    return { success: true, data: result };
  } catch (err) {
    if (err instanceof RegistryError) {
      return { success: false, data: { error: err.message, status: err.status } };
    }
    return { success: false, data: { error: (err as Error).message } };
  }
}
