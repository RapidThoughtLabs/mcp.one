/**
 * Registry proxy router.
 *
 * All registry logic (credentials, manifest, HTTP calls, ETag verification)
 * lives in src/registry/ — this file is a thin Express adapter only.
 *
 * No duplication. The same modules power the mcp-one CLI commands.
 */

import fs from "node:fs";
import path from "node:path";
import { Router } from "express";

// ── Import from the single source of truth ────────────────────────
// tsx (dev) resolves .js → .ts automatically.
// These are the exact same modules used by `mcp-one search`, `mcp-one install`, etc.

import {
  loadManifest,
  addToManifest,
  removeFromManifest,
  loadRegistries,
  isLoggedIn,
  loadCredentials,
  getRegistry,
} from "../src/registry/auth.js";

import {
  searchConfigs,
  featuredConfigs,
  popularConfigs,
  recentConfigs,
  fetchVersionPayload,
  getConfigMeta,
  checkUpdates,
  whoami,
  publishNew,
  publishVersion,
  RegistryError,
  type PublishNewPayload,
  type PublishVersionPayload,
} from "../src/registry/client.js";

import { extractBaseAndConnector } from "../src/lib/connector-types.js";

// ── Install helper ────────────────────────────────────────────────

function getMcpConfigsDir(): string {
  return path.join(process.cwd(), "mcp-configs");
}

// ── Router ────────────────────────────────────────────────────────

export function createRegistryRouter(): Router {
  const router = Router();

  // Centralised async error handler
  function wrap(fn: (req: import("express").Request, res: import("express").Response) => Promise<void>) {
    return (req: import("express").Request, res: import("express").Response) => {
      fn(req, res).catch((err: unknown) => {
        const status = err instanceof RegistryError ? err.status : (err as { status?: number }).status ?? 500;
        const message = err instanceof Error ? err.message : "Internal error";
        if (err instanceof RegistryError && err.body?.["code"]) {
          res.status(status).json({
            error:   String(err.body["message"] ?? message),
            code:    String(err.body["code"]),
            message: String(err.body["message"] ?? message),
          });
        } else {
          res.status(status).json({ error: message });
        }
      });
    };
  }

  // ── GET /api/registry/sources ─────────────────────────────────────
  // Returns all configured registry sources from ~/.mcp-one/registries.json
  router.get("/sources", (_req, res) => {
    res.json(loadRegistries());
  });

  // ── GET /api/registry/auth/status ────────────────────────────────
  router.get("/auth/status", wrap(async (req, res) => {
    const registry = (req.query["registry"] as string | undefined) ?? "default";
    if (!isLoggedIn(registry)) {
      res.json({ loggedIn: false });
      return;
    }
    try {
      const user = await whoami(registry);
      res.json({ loggedIn: true, user });
    } catch {
      res.json({ loggedIn: false });
    }
  }));

  // ── GET /api/registry/search ──────────────────────────────────────
  router.get("/search", wrap(async (req, res) => {
    const registry = (req.query["registry"] as string | undefined) ?? "default";
    const { q, tags, category, connector_type, verified, namespace, sort_by, limit, offset } = req.query as Record<string, string | undefined>;

    const data = await searchConfigs({
      q,
      tags,
      category,
      connector_type,
      verified: verified === "true" ? true : undefined,
      namespace,
      sort_by: sort_by as "popular" | "recent" | "name" | undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    }, registry);
    res.json(data);
  }));

  // ── GET /api/registry/featured ────────────────────────────────────
  router.get("/featured", wrap(async (req, res) => {
    const registry = (req.query["registry"] as string | undefined) ?? "default";
    const limit = req.query["limit"] ? Number(req.query["limit"]) : 20;
    const data = await featuredConfigs(limit, registry);
    res.json(data);
  }));

  // ── GET /api/registry/popular ─────────────────────────────────────
  router.get("/popular", wrap(async (req, res) => {
    const registry = (req.query["registry"] as string | undefined) ?? "default";
    const limit = req.query["limit"] ? Number(req.query["limit"]) : 20;
    const data = await popularConfigs(limit, registry);
    res.json(data);
  }));

  // ── GET /api/registry/recent ──────────────────────────────────────
  router.get("/recent", wrap(async (req, res) => {
    const registry = (req.query["registry"] as string | undefined) ?? "default";
    const limit = req.query["limit"] ? Number(req.query["limit"]) : 20;
    const data = await recentConfigs(limit, registry);
    res.json(data);
  }));

  // ── GET /api/registry/stats ───────────────────────────────────────
  router.get("/stats", wrap(async (req, res) => {
    const registry = (req.query["registry"] as string | undefined) ?? "default";
    const regInfo = getRegistry(registry);
    const res2 = await fetch(`${regInfo.url}/api/v1/stats`, {
      headers: loadCredentials(registry) ? { Authorization: `Bearer ${loadCredentials(registry)!.access_token}` } : {},
    });
    if (!res2.ok) {
      res.status(res2.status).json({ error: await res2.text() });
      return;
    }
    res.json(await res2.json());
  }));

  // ── GET /api/registry/manifest ────────────────────────────────────
  router.get("/manifest", (_req, res) => {
    res.json(loadManifest());
  });

  // ── POST /api/registry/check-updates ─────────────────────────────
  router.post("/check-updates", wrap(async (req, res) => {
    const { installed, registry = "default" } = req.body as {
      installed?: { slug: string; version: string }[];
      registry?: string;
    };
    if (!Array.isArray(installed)) {
      res.status(400).json({ error: '"installed" must be an array' });
      return;
    }
    const data = await checkUpdates(installed, registry);
    res.json(data);
  }));

  // ── POST /api/registry/install ────────────────────────────────────
  router.post("/install", wrap(async (req, res) => {
    const { namespace, slug, connector_type, version, registry = "default", overwrite = false } = req.body as {
      namespace: string;
      slug: string;
      connector_type?: string;
      version?: string;
      registry?: string;
      overwrite?: boolean;
    };

    if (!namespace || !slug) {
      res.status(400).json({ error: '"namespace" and "slug" are required' });
      return;
    }

    // Step 1: Fetch config metadata to resolve qualified slug and connector type (D5)
    let meta: Awaited<ReturnType<typeof getConfigMeta>>;
    try {
      meta = await getConfigMeta(namespace, slug, connector_type, registry);
    } catch (err) {
      if (err instanceof RegistryError) {
        if (err.status === 400 && err.code === "ambiguous_slug") {
          res.status(400).json({
            error: "ambiguous_slug",
            available_variants: err.body?.["available_variants"],
            examples: err.body?.["examples"],
          });
          return;
        }
        throw err;
      }
      throw err;
    }

    const qualifiedSlug     = meta.qualified_slug;
    const resolvedConnector = meta.connector_type;
    const installedId       = `${slug}-${resolvedConnector}`; // D2

    const configsDir = getMcpConfigsDir();
    const filePath   = path.join(configsDir, `mcp.${installedId}.json`); // D1

    if (fs.existsSync(filePath) && !overwrite) {
      res.status(409).json({ error: `"${installedId}" is already installed. Send overwrite:true to reinstall.` });
      return;
    }

    // Step 2: Download payload
    const { payload, version: resolvedVersion } = await fetchVersionPayload(
      namespace, slug, resolvedConnector, version, registry,
    );

    // D2: set compound id in the payload
    (payload as Record<string, unknown>).id = installedId;

    fs.mkdirSync(configsDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf-8");

    // D3: store qualified slug in manifest
    addToManifest(qualifiedSlug, resolvedVersion, resolvedConnector, registry);

    res.status(201).json({ ok: true, configId: installedId, qualified_slug: qualifiedSlug, version: resolvedVersion });
  }));

  // ── POST /api/registry/publish ────────────────────────────────────
  // Publish a config to the registry for the first time.
  // Body: { config_id, namespace, name, description, category, tags, visibility, message, payload, registry? }
  router.post("/publish", wrap(async (req, res) => {
    const {
      registry = "default",
      config_id,
      namespace,
      name,
      description = "",
      category = "",
      tags = [],
      visibility = "public",
      message = "",
      payload,
    } = req.body as {
      registry?: string;
      config_id: string;
      namespace: string;
      name: string;
      description?: string;
      category?: string;
      tags?: string[];
      visibility?: "public" | "private";
      message?: string;
      payload: unknown;
    };

    if (!config_id || !namespace || !name || !payload) {
      res.status(400).json({ error: '"config_id", "namespace", "name", and "payload" are required' });
      return;
    }

    if (!isLoggedIn(registry)) {
      res.status(401).json({ error: "Not logged in. Run: mcp-one login" });
      return;
    }

    // Derive slug (base id without connector suffix) and connector_type from the payload
    const { base } = extractBaseAndConnector(config_id);
    const slug = base.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
    const connectorType =
      payload && typeof payload === "object"
        ? String((payload as Record<string, unknown>)["connector"]
            ? ((payload as Record<string, unknown>)["connector"] as Record<string, unknown>)["type"] ?? "mcp"
            : "mcp")
        : "mcp";

    const publishPayload: PublishNewPayload = {
      namespace: namespace.replace(/^@/, ""),
      slug,
      name,
      description,
      category,
      connector_type: connectorType,
      visibility: visibility as "public" | "private",
      tags: Array.isArray(tags) ? tags : [],
      payload,
      message,
    };

    try {
      const result = await publishNew(publishPayload, registry);
      addToManifest(result.config.qualified_slug, result.version.version, result.config.connector_type, registry);
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof RegistryError && err.status === 409) {
        res.status(409).json({ error: "slug_exists", meta: err.body });
        return;
      }
      throw err;
    }
  }));

  // ── POST /api/registry/publish-version/:namespace/:slug ───────────
  // Publish a new version of an existing registry config.
  // Body: { version, payload, message?, qualified_slug?, connector_type?, registry? }
  router.post("/publish-version/:namespace/:slug", wrap(async (req, res) => {
    const { namespace, slug } = req.params as { namespace: string; slug: string };
    const {
      registry = "default",
      payload,
      message = "",
      qualified_slug,
      connector_type,
    } = req.body as {
      registry?: string;
      payload: unknown;
      message?: string;
      qualified_slug?: string;
      connector_type?: string;
    };

    if (!payload) {
      res.status(400).json({ error: '"payload" is required' });
      return;
    }

    if (!isLoggedIn(registry)) {
      res.status(401).json({ error: "Not logged in. Run: mcp-one login" });
      return;
    }

    const versionPayload: PublishVersionPayload = { payload, message };
    const result = await publishVersion(namespace, slug, versionPayload, registry);

    if (qualified_slug && connector_type) {
      addToManifest(qualified_slug, result.version, connector_type, registry);
    }

    res.json(result);
  }));

  // ── GET /api/registry/payload/:namespace/:slug ────────────────────
  // Fetch the current published payload for diff display during version bump.
  router.get("/payload/:namespace/:slug", wrap(async (req, res) => {
    const { namespace, slug } = req.params as { namespace: string; slug: string };
    const registry       = (req.query["registry"] as string | undefined) ?? "default";
    const connector_type = (req.query["connector_type"] as string | undefined);
    const { payload }    = await fetchVersionPayload(namespace, slug, connector_type, undefined, registry);
    res.json(payload);
  }));

  // ── DELETE /api/registry/uninstall/:id ───────────────────────────
  // :id is the compound config id, e.g. "github-http"
  router.delete("/uninstall/:id", wrap(async (req, res) => {
    const id       = req.params["id"]!;
    const registry = (req.query["registry"] as string | undefined) ?? "default";

    const filePath = path.join(getMcpConfigsDir(), `mcp.${id}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // Find and remove the matching manifest entry by compound id (D3)
    const manifest = loadManifest();
    const entry    = manifest.installed.find((e) => {
      const withoutNs = e.slug.replace(/^@[^/]+\//, "");
      const colonIdx  = withoutNs.indexOf(":");
      if (colonIdx === -1) return false;
      return `${withoutNs.slice(0, colonIdx)}-${withoutNs.slice(colonIdx + 1)}` === id && e.registry === registry;
    });

    if (entry) removeFromManifest(entry.slug, registry);
    res.json({ ok: true });
  }));

  return router;
}
