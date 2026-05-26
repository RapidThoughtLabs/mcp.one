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
  publish,
  submit,
  RegistryError,
  type PublishPayload,
  type SubmitPayload,
} from "../src/registry/client.js";

import { loadSystemConfig } from "../src/system-config.js";
import { resolveConfigDir } from "../src/lib/resolve-config-dir.js";

// ── Install helper ────────────────────────────────────────────────
// Must use resolveConfigDir — the same precedence logic the CLI uses — so
// install/uninstall via the UI touches the same directory that `mcp-one start`
// watches (defaults to ~/mcp-configs, or config_dir from mcp-one.config.json).

function getMcpConfigsDir(): string {
  const systemConfig = loadSystemConfig(process.cwd());
  return resolveConfigDir(undefined, systemConfig);
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
    const p = payload as Record<string, unknown>;
    p.id = installedId;

    // When overwriting an existing install, preserve local connector.env (may hold
    // credentials) and merge overlays (registry wins per-tool, local-only entries kept).
    if (overwrite && fs.existsSync(filePath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
        const existingConnector = existing.connector as Record<string, unknown> | undefined;
        if (existingConnector?.env) {
          const newConnector = (p.connector as Record<string, unknown> | undefined) ?? {};
          newConnector.env = existingConnector.env;
          p.connector = newConnector;
        }
        const existingOverlays = (existing.overlays ?? {}) as Record<string, unknown>;
        const newOverlays = (p.overlays ?? {}) as Record<string, unknown>;
        p.overlays = { ...existingOverlays, ...newOverlays };
      } catch {
        // Can't read existing file — proceed with fresh payload
      }
    }

    fs.mkdirSync(configsDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(p, null, 2) + "\n", "utf-8");

    // D3: store qualified slug in manifest
    addToManifest(qualifiedSlug, resolvedVersion, resolvedConnector, registry);

    res.status(201).json({ ok: true, configId: installedId, qualified_slug: qualifiedSlug, version: resolvedVersion });

  }));

  // ── POST /api/registry/publish ────────────────────────────────────
  router.post("/publish", wrap(async (req, res) => {
    const {
      registry = "default",
      ...body
    } = req.body as PublishPayload & { registry?: string };

    if (!body.payload) {
      res.status(400).json({ error: '"payload" is required' });
      return;
    }

    if (!isLoggedIn(registry)) {
      res.status(401).json({ error: "Not logged in. Run: mcp-one login" });
      return;
    }

    const result = await publish(body, registry);
    addToManifest(result.config.qualified_slug, result.version.version, result.config.connector_type, registry);
    res.status(201).json(result);
  }));

  // ── POST /api/registry/submit ─────────────────────────────────────
  router.post("/submit", wrap(async (req, res) => {
    const {
      registry = "default",
      ...body
    } = req.body as SubmitPayload & { registry?: string };

    if (!body.target || !body.payload || !body.message) {
      res.status(400).json({ error: '"target", "payload", and "message" are required' });
      return;
    }

    if (!isLoggedIn(registry)) {
      res.status(401).json({ error: "Not logged in. Run: mcp-one login" });
      return;
    }

    const result = await submit(body, registry);
    res.status(201).json(result);
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
