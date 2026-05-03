import fs from "node:fs";
import { bold, cyan, yellow, dim, red } from "../lib/fmt.js";
import { confirm } from "../lib/prompt.js";
import { removeFromManifest, type ManifestEntry } from "../registry/auth.js";
import { type ConfigMeta } from "../registry/client.js";
import { collectAuthEnvVars } from "../lib/config-rules.js";

type RelationshipTier = "fork-incoming" | "fork-existing" | "sibling-fork" | "unrelated";

export interface CrossNamespaceConflictOptions {
  incoming: ConfigMeta;
  existing: ManifestEntry;
  outFile: string;
  replace: boolean;
  registry: string;
}

function detectTier(incoming: ConfigMeta, existing: ManifestEntry): RelationshipTier {
  // incoming is a fork of the already-installed config
  if (incoming.forked_from != null && incoming.forked_from === existing.slug) {
    return "fork-incoming";
  }
  // already-installed config is a fork of the incoming (user reinstalling original)
  if (existing.forked_from != null && existing.forked_from === incoming.qualified_slug) {
    return "fork-existing";
  }
  // both are forks of the same parent
  if (
    incoming.forked_from != null &&
    existing.forked_from != null &&
    incoming.forked_from === existing.forked_from
  ) {
    return "sibling-fork";
  }
  return "unrelated";
}

function tierFooter(
  tier: RelationshipTier,
  incoming: ConfigMeta,
  existing: ManifestEntry,
  authVars: Set<string>,
): string {
  const varStr = authVars.size > 0 ? ` (${[...authVars].join(", ")})` : "";

  switch (tier) {
    case "fork-incoming":
      return dim(`  ↳ Incoming is a fork of ${cyan(existing.slug)} — your auth${varStr} will keep working.`);
    case "fork-existing":
      return dim(`  ↳ Installed config is a fork of incoming — your auth${varStr} will keep working.`);
    case "sibling-fork":
      return dim(`  ↳ Both are forks of ${cyan(incoming.forked_from!)} — your auth${varStr} will keep working.`);
    case "unrelated":
      if (authVars.size > 0) {
        return dim(
          `  ↳ Auth env vars may differ. Run ${bold(`mcp-one auth setup ${incoming.qualified_slug}`)} after install if needed.`,
        );
      }
      return dim(`  ↳ No auth configured on the existing config.`);
  }
}

export async function handleCrossNamespaceConflict(opts: CrossNamespaceConflictOptions): Promise<void> {
  const { incoming, existing, outFile, replace, registry } = opts;

  // Read existing config from disk for auth var inspection
  let existingConfig: unknown = null;
  try {
    existingConfig = JSON.parse(fs.readFileSync(outFile, "utf-8"));
  } catch {
    // File unreadable — still proceed, just no auth hint
  }

  const tier = detectTier(incoming, existing);
  const authVars = existingConfig ? collectAuthEnvVars(existingConfig) : new Set<string>();

  // Non-TTY without --replace → hard fail
  if (!process.stdout.isTTY && !replace) {
    console.error(
      red("✗") +
      `  "${incoming.qualified_slug}" conflicts with installed "${existing.slug}".`,
    );
    console.error(`  Use ${bold("--replace")} to replace non-interactively.`);
    process.exit(1);
  }

  // --replace flag → silent replace
  if (replace) {
    removeFromManifest(existing.slug, registry);
    return;
  }

  // Render conflict prompt
  const relPath = outFile.startsWith(process.cwd() + "/")
    ? outFile.slice(process.cwd().length + 1)
    : outFile;

  console.log();
  console.log(yellow("⚠") + `  Conflict at ${bold(relPath)}`);
  console.log();
  console.log(`  Currently installed:  ${bold(cyan(existing.slug))} @ ${dim(existing.version)}`);
  console.log(
    `  Replacing with:       ${bold(cyan(incoming.qualified_slug))} @ ${dim(incoming.latest_version?.version ?? "latest")}`,
  );
  console.log();
  console.log(tierFooter(tier, incoming, existing, authVars));
  console.log();

  const accepted = await confirm("  Replace? [y/N] ");
  if (!accepted) {
    console.log();
    console.error(
      red("✗") + `  Cancelled. Use ${bold("--replace")} to replace non-interactively.`,
    );
    process.exit(1);
  }

  removeFromManifest(existing.slug, registry);
  // Caller (install.ts) continues to download + write + addToManifest
}
