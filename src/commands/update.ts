/**
 * heku update [target]
 *
 * Updates registry-installed configs to their latest versions.
 *
 * No target: checks and updates all installed configs.
 * With target: updates a specific config.
 *
 * Target formats:
 *   github-http              compound id (base-connector)
 *   github:http              bare slug with connector type
 *   @ruchit/github:http      full registry slug
 *   @ruchit/github           all connector variants for this slug
 *
 * Flags:
 *   --registry <n>   Use a non-default registry (default: "default")
 */

import fs   from "node:fs";
import path from "node:path";
import {
  checkUpdates,
  fetchVersionPayload,
  RegistryError,
  type UpdateInfo,
  type InstalledEntry,
} from "../registry/client.js";
import { loadManifest, addToManifest, type ManifestEntry } from "../registry/auth.js";
import { loadSystemConfig } from "../system-config.js";
import { resolveConfigDir } from "../lib/resolve-config-dir.js";
import { bold, green, red, cyan, dim, yellow } from "../lib/fmt.js";

// ── Target matching ───────────────────────────────────────────────

function compoundId(entry: ManifestEntry): string {
  const withoutNs = entry.slug.replace(/^@[^/]+\//, "");
  const colonIdx  = withoutNs.indexOf(":");
  const rawSlug   = colonIdx !== -1 ? withoutNs.slice(0, colonIdx) : withoutNs;
  const ct        = colonIdx !== -1 ? withoutNs.slice(colonIdx + 1) : entry.connector_type;
  return `${rawSlug}-${ct}`;
}

/** Returns true if a user-supplied target matches this manifest entry. */
function matchesTarget(entry: ManifestEntry, target: string): boolean {
  const slug = entry.slug; // "@ruchit/github:http"

  // Exact or @-prefixed full slug
  if (slug === target || slug === `@${target}`) return true;

  // Strip namespace to get "github:http"
  const withoutNs = slug.replace(/^@[^/]+\//, "");
  const colonIdx  = withoutNs.indexOf(":");
  const rawSlug   = colonIdx !== -1 ? withoutNs.slice(0, colonIdx) : withoutNs;
  const ct        = colonIdx !== -1 ? withoutNs.slice(colonIdx + 1) : "";

  // Compound id: "github-http"
  if (`${rawSlug}-${ct}` === target) return true;

  // bare:connector: "github:http"
  if (withoutNs === target) return true;

  // Full slug without connector: "@ruchit/github" → all connectors
  const withoutConnector = slug.replace(/:.*$/, "");
  if (withoutConnector === target || withoutConnector === `@${target}`) return true;

  // Bare name only (no colon or hyphen) → all connectors for this slug
  if (!target.includes(":") && !target.includes("-") && rawSlug === target) return true;

  return false;
}

// ── Download + install ────────────────────────────────────────────

async function downloadAndInstall(
  entry: ManifestEntry,
  latestVersion: string,
  configDir: string,
): Promise<{ id: string; from: string; to: string }> {
  const withoutAt = entry.slug.startsWith("@") ? entry.slug.slice(1) : entry.slug;
  const slashIdx  = withoutAt.indexOf("/");
  const namespace = withoutAt.slice(0, slashIdx);
  const rest      = withoutAt.slice(slashIdx + 1);
  const colonIdx  = rest.indexOf(":");
  const rawSlug   = colonIdx !== -1 ? rest.slice(0, colonIdx) : rest;
  const connType  = colonIdx !== -1 ? rest.slice(colonIdx + 1) : entry.connector_type;
  const id        = `${rawSlug}-${connType}`;
  const outFile   = path.join(configDir, `mcp.${id}.json`);

  const { payload, version: resolvedVersion } = await fetchVersionPayload(
    namespace, rawSlug, connType, latestVersion, entry.registry,
  );

  const payloadObj = payload as Record<string, unknown>;
  payloadObj.id    = id;

  // Preserve local env vars and overlays from the existing file
  if (fs.existsSync(outFile)) {
    try {
      const existing     = JSON.parse(fs.readFileSync(outFile, "utf-8")) as Record<string, unknown>;
      const existingConn = existing.connector as Record<string, unknown> | undefined;
      if (existingConn?.env) {
        const newConn = (payloadObj.connector as Record<string, unknown> | undefined) ?? {};
        newConn.env   = existingConn.env;
        payloadObj.connector = newConn;
      }
      const existingOverlays = (existing.overlays ?? {}) as Record<string, unknown>;
      const newOverlays      = (payloadObj.overlays ?? {}) as Record<string, unknown>;
      payloadObj.overlays    = { ...existingOverlays, ...newOverlays };
    } catch {
      // Can't read existing file — proceed with fresh payload
    }
  }

  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payloadObj, null, 2) + "\n", "utf-8");
  addToManifest(entry.slug, resolvedVersion, connType, entry.registry, entry.forked_from ?? null);

  return { id, from: entry.version, to: resolvedVersion };
}

// ── Entry point ───────────────────────────────────────────────────

export async function run(args: string[]): Promise<void> {
  const registryIdx = args.indexOf("--registry");
  const registry    = registryIdx !== -1 ? (args[registryIdx + 1] ?? "default") : "default";

  const skipIndices = new Set<number>();
  if (registryIdx !== -1) { skipIndices.add(registryIdx); skipIndices.add(registryIdx + 1); }

  const target = args.find((a, i) => !skipIndices.has(i) && !a.startsWith("--"));

  // ── Load manifest ─────────────────────────────────────────────────

  const systemConfig = loadSystemConfig(process.cwd());
  const configDir    = resolveConfigDir(undefined, systemConfig);
  const { installed } = loadManifest();
  const forRegistry   = installed.filter((e) => e.registry === registry);

  if (forRegistry.length === 0) {
    console.log();
    console.log(dim("  No registry-installed configs found."));
    console.log(dim(`  Install one with: ${bold("heku install @ns/slug")}`));
    console.log();
    return;
  }

  // ── Find entries to check ─────────────────────────────────────────

  let toCheck: ManifestEntry[];

  if (target) {
    toCheck = forRegistry.filter((e) => matchesTarget(e, target));
    if (toCheck.length === 0) {
      console.log();
      console.error(red("✗") + `  No installed config matches "${bold(target)}".`);
      console.error(dim(`  Run ${bold("heku list")} to see installed configs.`));
      console.log();
      process.exit(1);
    }
  } else {
    toCheck = forRegistry;
  }

  // ── Check for updates ─────────────────────────────────────────────

  console.log();
  if (target) {
    console.log(bold(`  Checking ${cyan(target)}...`));
  } else {
    console.log(bold("  Checking for updates..."));
  }
  console.log();

  let updateResult: Awaited<ReturnType<typeof checkUpdates>>;
  try {
    updateResult = await checkUpdates(
      toCheck.map((e) => ({ slug: e.slug, version: e.version })),
      registry,
    );
  } catch (err) {
    console.error(
      red("✗") + `  ${err instanceof RegistryError ? err.message : (err as Error).message}`,
    );
    process.exit(1);
  }

  const { updates, up_to_date, deprecated } = updateResult;

  // ── Status summary ────────────────────────────────────────────────

  const colWidth = Math.max(
    ...[...updates, ...up_to_date, ...deprecated].map((u) => {
      const entry = toCheck.find((e) => e.slug === u.slug);
      return entry ? compoundId(entry).length : 0;
    }),
    12,
  );

  for (const u of up_to_date) {
    const entry = toCheck.find((e) => e.slug === u.slug);
    const id    = entry ? compoundId(entry) : u.slug;
    console.log(`  ${dim(id.padEnd(colWidth))}  ${dim(`v${u.version}`)}  ${dim("up to date")}`);
  }

  for (const u of updates) {
    const entry = toCheck.find((e) => e.slug === u.slug);
    const id    = entry ? compoundId(entry) : u.slug;
    const badge = u.breaking ? yellow(`${u.severity} · breaking`) : cyan(u.severity);
    console.log(
      `  ${bold(id.padEnd(colWidth))}  ${dim(`v${u.installed_version}`)} → ${green(`v${u.latest_version}`)}  [${badge}]`,
    );
  }

  for (const d of deprecated) {
    const entry = toCheck.find((e) => e.slug === d.slug);
    const id    = entry ? compoundId(entry) : d.slug;
    const note  = d.replacement ? `  → use ${cyan(d.replacement)}` : "";
    console.log(`  ${yellow(id.padEnd(colWidth))}  ${dim(`v${d.installed_version}`)}  ${yellow("deprecated")}${note}`);
  }

  console.log();

  // ── Nothing to update ─────────────────────────────────────────────

  if (updates.length === 0) {
    console.log(green("✓") + (target ? `  ${cyan(target)} is up to date.` : "  All configs are up to date."));
    if (deprecated.length > 0) {
      console.log(yellow("⚠") + `  ${deprecated.length} deprecated — consider replacing them.`);
    }
    console.log();
    return;
  }

  // ── Perform updates ───────────────────────────────────────────────

  const noun = updates.length === 1 ? "config" : "configs";
  console.log(bold(`  Updating ${updates.length} ${noun}...`));
  console.log();

  const entryBySlug = new Map(toCheck.map((e) => [e.slug, e]));
  let successCount  = 0;
  let failCount     = 0;

  for (const u of updates) {
    const entry = entryBySlug.get(u.slug);
    if (!entry) continue;

    const id = compoundId(entry);
    process.stdout.write(`  ${bold(id.padEnd(colWidth))}  Downloading... `);

    try {
      const result = await downloadAndInstall(entry, u.latest_version, configDir);
      console.log(green("done") + `  ${dim(`${result.from} → ${result.to}`)}`);
      successCount++;
    } catch (err) {
      console.log(red("failed"));
      const msg = err instanceof RegistryError ? err.message : (err as Error).message;
      console.error(`  ${"".padEnd(colWidth)}  ${red("✗")}  ${msg}`);
      failCount++;
    }
  }

  console.log();

  if (failCount === 0) {
    const upToDateNote = up_to_date.length > 0 ? `  ${dim(`${up_to_date.length} already up to date.`)}` : "";
    console.log(green("✓") + `  ${successCount} ${noun} updated.${upToDateNote}`);
  } else if (successCount > 0) {
    console.log(yellow("⚠") + `  ${successCount} updated, ${failCount} failed.`);
  } else {
    console.log(red("✗") + `  All updates failed.`);
    process.exit(1);
  }

  console.log(dim("  Restart or reload heku to apply changes."));
  console.log();
}
