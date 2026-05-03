/**
 * mcp-one install <target>
 *
 * Installs a config from the registry into mcp-configs/.
 *
 * Target formats:
 *   @ns/slug                     — bare (server picks default variant; 400 if ambiguous)
 *   @ns/slug:connector           — fully qualified variant
 *   @ns/slug:connector@version   — pinned version
 *   ns/slug                      — leading @ is optional
 *
 * Flags:
 *   --force          Reinstall even if already installed
 *   --registry <n>   Use a non-default registry (default: "default")
 */

import fs   from "node:fs";
import path from "node:path";
import { getConfigMeta, fetchVersionPayload, RegistryError, type ConfigMeta } from "../registry/client.js";
import { addToManifest, getInstalledEntry, findEntryByBareSlugAndConnector } from "../registry/auth.js";
import { handleCrossNamespaceConflict } from "./install-conflict.js";
import { confirm } from "../lib/prompt.js";
import { loadSystemConfig } from "../system-config.js";
import { resolveConfigDir } from "../lib/resolve-config-dir.js";
import { pick } from "../lib/picker.js";
import { closestConnector } from "../lib/closest-match.js";
import { bold, green, red, cyan, dim, yellow } from "../lib/fmt.js";

// ── Target parser ─────────────────────────────────────────────────

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

  const namespace = cleaned.slice(0, slashIdx);
  const rest      = cleaned.slice(slashIdx + 1);

  // Split on last @ for version (avoids conflict with npm-style scopes)
  const atIdx = rest.lastIndexOf("@");
  let slugPart: string;
  let version: string | undefined;

  if (atIdx !== -1) {
    slugPart = rest.slice(0, atIdx);
    version  = rest.slice(atIdx + 1) || undefined;
  } else {
    slugPart = rest;
  }

  // Split on : for connector type
  const colonIdx = slugPart.indexOf(":");
  let rawSlug: string;
  let connectorType: string | undefined;

  if (colonIdx !== -1) {
    rawSlug       = slugPart.slice(0, colonIdx);
    connectorType = slugPart.slice(colonIdx + 1) || undefined;
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

// ── Metadata resolution (handles ambiguity + variant-not-found) ──

async function resolveMeta(
  namespace: string,
  rawSlug: string,
  connectorType: string | undefined,
  registry: string,
  displayTarget: string,
): Promise<ConfigMeta> {
  process.stdout.write("  Resolving... ");

  try {
    const meta = await getConfigMeta(namespace, rawSlug, connectorType, registry);
    console.log(green("found"));
    return meta;
  } catch (err) {
    if (err instanceof RegistryError && err.status === 400 && err.code === "ambiguous_slug") {
      console.log(yellow("ambiguous"));

      const variants = (err.body?.["available_variants"] as string[] | undefined) ?? [];
      const examples = (err.body?.["examples"] as string[] | undefined) ?? [];

      const picked = await pick(
        `"${displayTarget}" has multiple connector variants — pick one:`,
        variants.map((v) => ({
          label: cyan(`@${namespace}/${rawSlug}:${v}`),
          value: v,
        })),
      );

      if (picked === null) {
        // Non-TTY fallback — match the original copy-paste-friendly output.
        console.log();
        console.error(yellow("⚠") + `  "${displayTarget}" has multiple connector variants.`);
        if (variants.length > 0) console.error(`  Available: ${variants.join(", ")}`);
        if (examples.length > 0) {
          console.error(`  Pick one, e.g.:`);
          for (const ex of examples.slice(0, 3)) {
            console.error(`    mcp-one install ${ex}`);
          }
        }
        process.exit(1);
      }

      process.stdout.write(`  Resolving ${cyan(`:${picked}`)}... `);
      try {
        const meta = await getConfigMeta(namespace, rawSlug, picked, registry);
        console.log(green("found"));
        return meta;
      } catch (err2) {
        console.log(red("failed"));
        console.error(red("✗") + `  ${(err2 as Error).message}`);
        process.exit(1);
      }
    }

    console.log(red("failed"));
    console.log();

    if (err instanceof RegistryError) {
      if (err.status === 404) {
        const variants = (err.body?.["available_variants"] as string[] | undefined) ?? [];
        if (variants.length > 0) {
          console.error(red("✗") + `  Connector variant "${connectorType}" not found.`);
          const suggestion = closestConnector(connectorType ?? "", variants);
          if (suggestion) {
            console.error(
              `  Did you mean ${bold(cyan(`@${namespace}/${rawSlug}:${suggestion}`))}?`,
            );
          }
          console.error(`  Available: ${variants.join(", ")}`);
        } else {
          console.error(red("✗") + `  Config not found: ${displayTarget}`);
        }
        process.exit(1);
      }

      console.error(red("✗") + `  ${err.message}`);
      process.exit(1);
    }

    console.error(red("✗") + `  ${(err as Error).message}`);
    process.exit(1);
  }
}

// ── Entry point ───────────────────────────────────────────────────

export async function run(args: string[]): Promise<void> {
  // Parse flags
  const forceIdx    = args.indexOf("--force");
  const force       = forceIdx !== -1;
  const replaceIdx  = args.indexOf("--replace");
  const replace     = replaceIdx !== -1;
  const registryIdx = args.indexOf("--registry");
  const registry    = registryIdx !== -1 ? args[registryIdx + 1] : "default";

  // Find first positional (non-flag, non-value) arg as the target
  const skipIndices = new Set<number>();
  if (forceIdx !== -1)    skipIndices.add(forceIdx);
  if (replaceIdx !== -1)  skipIndices.add(replaceIdx);
  if (registryIdx !== -1) { skipIndices.add(registryIdx); skipIndices.add(registryIdx + 1); }

  const target = args.find((a, i) => !skipIndices.has(i) && !a.startsWith("--"));

  if (!target) {
    console.error(
      red("✗") + ` Usage: ${bold("mcp-one install <target>")}` +
      `\n  Examples:` +
      `\n    mcp-one install @rtl/context7-api` +
      `\n    mcp-one install @rtl/github:http` +
      `\n    mcp-one install @rtl/github:http@1.2.0` +
      `\n  Flags: ${bold("--force")} (reinstall same namespace)  ${bold("--replace")} (replace cross-namespace conflict)`,
    );
    process.exit(1);
  }

  // Resolve config directory (respects mcp-one.config.json config_dir)
  const systemConfig = loadSystemConfig(process.cwd());
  const configDir    = resolveConfigDir(undefined, systemConfig);

  // Parse target
  let parsed: ReturnType<typeof parseTarget>;
  try {
    parsed = parseTarget(target);
  } catch (err) {
    console.error(red("✗") + ` ${(err as Error).message}`);
    process.exit(1);
  }

  const { namespace, rawSlug, connectorType, version } = parsed;
  const displayTarget = `@${namespace}/${rawSlug}${connectorType ? `:${connectorType}` : ""}${version ? `@${version}` : ""}`;

  console.log();
  console.log(bold("  Installing from registry"));
  console.log();
  console.log(`  Target:   ${bold(cyan(displayTarget))}`);
  if (registry !== "default") {
    console.log(`  Registry: ${dim(registry)}`);
  }
  console.log();

  // ── Step 1: Fetch config metadata ────────────────────────────────
  const meta = await resolveMeta(
    namespace, rawSlug, connectorType, registry, displayTarget,
  );

  // ── Derive canonical identifiers ──────────────────────────────────

  const qualifiedSlug     = meta.qualified_slug;
  const resolvedConnector = meta.connector_type;
  const installedId       = `${rawSlug}-${resolvedConnector}`; // D2: compound id
  const outFile           = path.join(configDir, `mcp.${installedId}.json`); // D1

  console.log(`  Config:   ${bold(meta.name)}  ${dim(`(${qualifiedSlug})`)}`);
  console.log(`  Connector: ${dim(meta.connector_type)}`);
  if (meta.latest_version) {
    console.log(`  Version:  ${dim(version ?? meta.latest_version.version)}`);
  }
  console.log();

  // ── Conflict detection ────────────────────────────────────────────
  // Only block/prompt if manifest says installed AND the config file actually exists.
  // Manifest-only entries (file deleted or different cwd) are treated as not installed.

  const sameSlugEntry = getInstalledEntry(qualifiedSlug, registry);
  const fileEntry     = findEntryByBareSlugAndConnector(rawSlug, resolvedConnector, registry);

  // Case A: same qualified_slug → re-install guard (unchanged behavior)
  if (sameSlugEntry && !force && fs.existsSync(outFile)) {
    console.error(
      yellow("⚠") +
      `  "${qualifiedSlug}" is already installed at version ${sameSlugEntry.version}.`,
    );
    console.error(`  Use ${bold("--force")} to reinstall.`);
    process.exit(1);
  }

  // Case B: file exists, manifest entry from different namespace → cross-namespace conflict
  if (!sameSlugEntry && fileEntry && fs.existsSync(outFile)) {
    await handleCrossNamespaceConflict({
      incoming: meta,
      existing: fileEntry,
      outFile,
      replace,
      registry,
    });
    // on decline: exits. on accept: falls through to download.
  }

  // Case C: file exists but no manifest entry → unmanaged file (hand-edited or stale)
  if (!sameSlugEntry && !fileEntry && fs.existsSync(outFile) && !force) {
    if (!process.stdout.isTTY) {
      console.error(red("✗") + `  An unmanaged config file already exists at ${outFile}.`);
      console.error(`  Use ${bold("--force")} to overwrite.`);
      process.exit(1);
    }
    const relPath = outFile.startsWith(process.cwd() + "/")
      ? outFile.slice(process.cwd().length + 1)
      : outFile;
    console.log();
    console.log(yellow("⚠") + `  An unmanaged config exists at ${bold(relPath)}.`);
    console.log();
    const accepted = await confirm("  Overwrite? [y/N] ");
    if (!accepted) {
      console.log();
      console.error(red("✗") + `  Cancelled. Use ${bold("--force")} to overwrite non-interactively.`);
      process.exit(1);
    }
  }

  // ── Step 2: Download payload ──────────────────────────────────────

  process.stdout.write("  Downloading... ");

  let payload: unknown;
  let resolvedVersion: string;

  try {
    const result = await fetchVersionPayload(
      namespace, rawSlug, resolvedConnector, version, registry,
    );
    payload         = result.payload;
    resolvedVersion = result.version;
    console.log(green("done"));
  } catch (err) {
    console.log(red("failed"));

    if (err instanceof RegistryError) {
      if (err.status === 410) {
        console.error(red("✗") + `  Version was yanked: ${err.message}`);
        console.error(`  Run ${bold("mcp-one list")} to check for updates.`);
      } else {
        console.error(red("✗") + `  ${err.message}`);
      }
    } else {
      console.error(red("✗") + `  ${(err as Error).message}`);
    }
    process.exit(1);
  }

  // ── Write config file ─────────────────────────────────────────────

  // D2: overwrite the id field with the compound form ({base}-{connector})
  const payloadObj = payload as Record<string, unknown>;
  payloadObj.id    = installedId;

  const payloadJson = JSON.stringify(payloadObj, null, 2);

  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(outFile, payloadJson + "\n", "utf-8");
  } catch (err) {
    console.error(red("✗") + `  Failed to write config file: ${(err as Error).message}`);
    process.exit(1);
  }

  // D3: record qualified slug in manifest
  addToManifest(qualifiedSlug, resolvedVersion, resolvedConnector, registry, meta.forked_from ?? null);

  // ── Done ──────────────────────────────────────────────────────────

  console.log();
  console.log(
    green("✓") +
    ` Installed ${bold(cyan(qualifiedSlug))} @ ${bold(resolvedVersion)}`,
  );
  console.log(dim(`  Config id: ${installedId}`));
  console.log(dim(`  File:      ${outFile}`));
  console.log();

  if (sameSlugEntry && force) {
    console.log(dim("  Reinstalled — server will hot-reload it automatically."));
  } else {
    console.log(dim("  Restart or reload mcp-one to activate the new config."));
  }
  console.log();
}
