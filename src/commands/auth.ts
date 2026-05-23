import fs from "node:fs";
import path from "node:path";
import { loadConfigs } from "../loader.js";
import { loadSystemConfig } from "../system-config.js";
import { resolveConfigDir } from "../lib/resolve-config-dir.js";
import { checkAuthEnvVars, getAuthVarStatuses, getAuthVarNames, getConfigAuth, getConfigBaseUrl } from "../lib/check-auth.js";
import { bold, green, red, yellow, dim, cyan } from "../lib/fmt.js";
import { ask, askMasked, confirm } from "../lib/prompt.js";
import { writeConfigEnv, isEnvInGitignore } from "../lib/env-writer.js";
import { resolveEnv, loadAllConfigEnvs } from "../lib/env-store.js";
import { isPlaceholderUrl } from "../lib/base-url.js";
import type { McpConfig, AuthConfig } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────

/** Returns {varName, masked} tuples for all vars an auth block references. */
function getVarPrompts(auth: AuthConfig): { key: string; masked: boolean }[] {
  switch (auth.type) {
    case "bearer":
    case "oauth2_static":
      return [{ key: auth.token_env, masked: true }];
    case "basic":
      return [
        { key: auth.username_env, masked: false },
        { key: auth.token_env,    masked: true  },
      ];
    case "api_key":
      return [{ key: auth.key_env, masked: true }];
  }
}

/** Returns a one-line auth-type help string shown at the top of each wizard section. */
function authTypeHelp(auth: AuthConfig): string {
  switch (auth.type) {
    case "bearer":
      return "Requires a personal access token.";
    case "basic":
      return "Requires a username/email and an API token.";
    case "api_key":
      return `Requires an API key. It will be sent as: ${cyan(auth.header_name)}`;
    case "oauth2_static":
      return (
        "Requires a pre-acquired OAuth2 access token.\n" +
        `  ${yellow("⚠️  Note: this token may expire. You'll need to refresh it manually.")}`
      );
  }
}

// ── auth status ───────────────────────────────────────────────────

async function runStatus(configs: McpConfig[]): Promise<void> {
  const SEP = "─".repeat(44);

  console.log(`\n  Auth Status:`);
  console.log(`  ${SEP}`);

  let totalMissing = 0;
  const missingConfigs: string[] = [];

  for (const config of configs) {
    const auth = getConfigAuth(config);
    if (!auth) continue; // skip connectors with no auth (cli, file, mcp)
    const statuses = getAuthVarStatuses(auth, config.id);
    const firstRow = true;

    statuses.forEach((v, i) => {
      const icon  = v.set ? green("✅") : red("❌");
      const label = v.set ? dim("set") : red("missing");

      if (i === 0) {
        // First row: show config id + auth type
        const idPart   = config.id.padEnd(12);
        const typePart = auth.type.padEnd(14);
        console.log(`  ${idPart} ${typePart} ${icon}  ${v.name}  ${label}`);
        void firstRow; // suppress unused warning
      } else {
        // Subsequent rows: indent to align under the first
        const indent = " ".repeat(28);
        console.log(`  ${indent} ${icon}  ${v.name}  ${label}`);
      }

      if (!v.set) {
        totalMissing++;
        if (!missingConfigs.includes(config.id)) {
          missingConfigs.push(config.id);
        }
      }
    });
  }


  console.log(`  ${SEP}`);

  if (totalMissing === 0) {
    console.log(`\n  ${green("All configs are authenticated.")} \n`);
  } else {
    console.log(
      `\n  ${totalMissing} env var(s) missing across ${missingConfigs.length} config(s).`,
    );
    const hint = missingConfigs.length === 1
      ? `mcp-one auth setup ${missingConfigs[0]}`
      : "mcp-one auth setup";
    console.log(`  Run: ${bold(hint)}\n`);
  }
}

// ── Base URL update helper ─────────────────────────────────────────

async function promptBaseUrl(config: McpConfig, configDir: string): Promise<void> {
  const baseUrl = getConfigBaseUrl(config);
  if (!baseUrl || !isPlaceholderUrl(baseUrl)) return;

  console.log(
    `\n  ${yellow("⚠️  base_url looks like a placeholder:")} ${dim(baseUrl)}`,
  );

  const yes = await confirm("  Set your actual base URL now? (y/n): ");
  if (!yes) return;

  const newUrl = await ask("  Enter base URL: ");
  if (!newUrl) {
    console.error(`  ${yellow("Skipped — no URL entered.")}`);
    return;
  }

  // Find the mcp.<id>.json file in the config dir
  const candidates = [`mcp.${config.id}.json`];
  let filePath: string | undefined;
  for (const name of candidates) {
    const candidate = path.join(configDir, name);
    if (fs.existsSync(candidate)) {
      filePath = candidate;
      break;
    }
  }

  // Fallback: scan for any file containing the config id
  if (!filePath) {
    try {
      const entries = fs.readdirSync(configDir);
      for (const entry of entries) {
        if (entry.startsWith("mcp.") && entry.endsWith(".json")) {
          const candidate = path.join(configDir, entry);
          try {
            const raw = JSON.parse(fs.readFileSync(candidate, "utf-8")) as Record<string, unknown>;
            if (raw.id === config.id) {
              filePath = candidate;
              break;
            }
          } catch {
            // skip unparseable files
          }
        }
      }
    } catch {
      // ignore readdir errors
    }
  }

  if (!filePath) {
    console.error(`  ${red("Could not locate config file for")} "${config.id}". Update base_url manually.`);
    return;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    raw.base_url = newUrl;
    fs.writeFileSync(filePath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
    console.log(`  ${green("✅")} base_url updated → ${newUrl}`);
    console.log(`  ${dim("(hot-reload watcher will pick this up automatically)")}`);
  } catch (err) {
    console.error(`  ${red("Failed to write config file:")} ${(err as Error).message}`);
  }
}

// ── Per-config wizard ─────────────────────────────────────────────

async function setupConfig(config: McpConfig, configDir: string): Promise<void> {
  // Section header
  console.log(`\n  ${dim("───")} ${bold(`${config.id}`)} ${dim(`(${config.name})`)} ${dim("───")}`);

  const auth = getConfigAuth(config);
  if (!auth) {
    console.log(`  ${dim("(no auth required for this connector type)")}`);
    return;
  }

  // Auth-type contextual help
  console.log(`  ${authTypeHelp(auth)}`);

  // Service-specific description (e.g. required scopes, token type)
  if (auth.description) {
    console.log(`  ${dim(auth.description)}`);
  }

  // Optional credentials URL
  if (auth.auth_url) {
    console.log(`  Get your credentials at: ${cyan(auth.auth_url)}`);
  }

  console.log();

  // Prompt for each var
  const prompts = getVarPrompts(auth);
  const entries: { key: string; value: string }[] = [];
  const overwriteKeys = new Set<string>();

  for (const { key, masked } of prompts) {
    const alreadySet = !!resolveEnv(config.id, key);

    if (alreadySet) {
      const overwrite = await confirm(`  ${key} is already set. Overwrite? (y/n): `);
      if (!overwrite) {
        console.log(`  ${dim(`Keeping existing ${key}.`)}`);
        continue;
      }
      overwriteKeys.add(key);
    }

    const question = `  ${key}: `;
    const value = masked ? await askMasked(question) : await ask(question);

    if (!value) {
      console.error(`  ${yellow(`⚠️  Skipping ${key} — empty input will not be written.`)}`);
      continue;
    }

    entries.push({ key, value });
  }

  if (entries.length > 0) {
    const overwriteEntries = entries.filter((e) => overwriteKeys.has(e.key));
    const newEntries       = entries.filter((e) => !overwriteKeys.has(e.key));

    if (newEntries.length > 0) {
      writeConfigEnv(configDir, config.id, newEntries, false);
    }
    if (overwriteEntries.length > 0) {
      writeConfigEnv(configDir, config.id, overwriteEntries, true);
    }

    console.log(
      `  ${green("✅")} Wrote: ${entries.map((e) => e.key).join(", ")} → mcp.${config.id}.env`,
    );
  } else {
    console.log(`  ${dim("No vars written.")}`);
  }

  // Base URL placeholder check
  await promptBaseUrl(config, configDir);
}

// ── auth setup ────────────────────────────────────────────────────

async function runSetup(args: string[], configs: McpConfig[], configDir: string): Promise<void> {
  // .gitignore advisory check
  if (!isEnvInGitignore()) {
    console.error(
      `  ${yellow("⚠️  mcp.*.env files do not appear to be in your .gitignore.")}` +
      `\n  Add 'mcp.*.env' to .gitignore to avoid committing secrets.`,
    );
  }

  const serviceArg = args[0];
  let targets: McpConfig[];

  if (serviceArg) {
    // Specific service requested
    const found = configs.find((c) => c.id === serviceArg);
    if (!found) {
      console.error(
        `[mcp-one] Config not found: "${serviceArg}"\n` +
        `  Available: ${configs.map((c) => c.id).join(", ")}`,
      );
      process.exit(1);
    }
    targets = [found];
  } else {
    // All configs that have missing auth
    targets = configs.filter((c) => {
      const a = getConfigAuth(c);
      return a ? checkAuthEnvVars(a, c.id).length > 0 : false;
    });
  }

  if (targets.length === 0) {
    console.log(`\n  ${green("All configs are already authenticated.")} Nothing to do.\n`);
    return;
  }

  for (const config of targets) {
    await setupConfig(config, configDir);
  }

  console.log(`\n  ${green("✅ All done!")} Your credentials have been saved to ${bold("mcp.{config-id}.env")} in your config dir.\n`);
}

// ── Entry point ───────────────────────────────────────────────────

export async function run(args: string[]): Promise<void> {
  const subcommand = args[0];

  const systemConfig = loadSystemConfig(process.cwd());
  const configDir    = resolveConfigDir(undefined, systemConfig);
  loadAllConfigEnvs(configDir);
  const configs      = loadConfigs(configDir);

  if (configs.length === 0) {
    console.error(
      `[mcp-one] No configs found in: ${configDir}\n` +
      `  Place mcp.*.json files there, or set config_dir in mcp-one.config.json`,
    );
    process.exit(1);
  }

  switch (subcommand) {
    case "status":
      await runStatus(configs);
      break;

    case "setup":
      await runSetup(args.slice(1), configs, configDir);
      break;

    case undefined:
    default:
      console.error(
        `[mcp-one] Unknown auth subcommand: "${subcommand ?? ""}".\n` +
        `  Usage: mcp-one auth status | mcp-one auth setup [service]`,
      );
      process.exit(1);
  }
}
