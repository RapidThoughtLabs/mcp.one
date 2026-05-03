import { loadConfigs } from "../loader.js";
import { loadSystemConfig } from "../system-config.js";
import { resolveConfigDir } from "../lib/resolve-config-dir.js";
import { checkAuthEnvVars, getAuthVarStatuses, getConfigAuth, getConfigBaseUrl } from "../lib/check-auth.js";
import { loadEnvFile } from "../lib/env-writer.js";
import { loadManifest } from "../registry/auth.js";
import { bold, green, red, cyan, dim, table } from "../lib/fmt.js";
import type { McpConfig } from "../types.js";

// ── Auth status badge helpers ─────────────────────────────────────

function authBadge(config: McpConfig): string {
  const auth = getConfigAuth(config);
  if (!auth) return dim("n/a");
  const missing = checkAuthEnvVars(auth);
  return missing.length === 0
    ? green("✅ configured")
    : red("❌ missing");
}

// ── Table view — mcp-one list ─────────────────────────────────────

function renderTable(configs: McpConfig[]): void {
  const rows = configs.map((c) => ({
    id:        c.id,
    name:      c.name,
    connector: dim(c.connector.type),
    tools:     String(c.tools.length),
    status:    authBadge(c),
  }));

  console.log(
    table(
      [
        { header: "ID",          key: "id"        },
        { header: "Name",        key: "name"      },
        { header: "Connector",   key: "connector" },
        { header: "Tools",       key: "tools"     },
        { header: "Auth Status", key: "status"    },
      ],
      rows,
    ),
  );

  const unconfigured = configs.filter((c) => {
    const auth = getConfigAuth(c);
    return auth ? checkAuthEnvVars(auth).length > 0 : false;
  });
  if (unconfigured.length > 0) {
    console.log(
      `\n  ${unconfigured.length} config(s) need auth setup. Run: ${bold("mcp-one auth setup")}`,
    );
  }
}

// ── Detail view — mcp-one list <service> ─────────────────────────

function renderDetail(config: McpConfig): void {
  const auth     = getConfigAuth(config);
  const baseUrl  = getConfigBaseUrl(config);
  const missing  = auth ? checkAuthEnvVars(auth) : [];
  const varStatuses = auth ? getAuthVarStatuses(auth) : [];

  // Look up qualified slug from manifest (D11)
  const manifest   = loadManifest();
  const entry      = manifest.installed.find((e) => {
    const withoutNs = e.slug.replace(/^@[^/]+\//, "");
    const colonIdx  = withoutNs.indexOf(":");
    if (colonIdx === -1) return false;
    const base = withoutNs.slice(0, colonIdx);
    const ct   = withoutNs.slice(colonIdx + 1);
    return `${base}-${ct}` === config.id;
  });

  // Header
  console.log(`\n  ${bold(config.id)}  ${dim("—")}  ${config.name}`);
  if (entry) {
    console.log(`  ${dim("registry:")} ${entry.slug}  ${dim(`@ ${entry.version}`)}`);
  }
  console.log(`  ${dim("connector:")} ${config.connector.type}`);
  if (baseUrl) console.log(`  ${dim("url:")}    ${baseUrl}`);

  // Auth block
  if (auth) {
    console.log(`  ${dim("auth:")}  ${auth.type}`);
    for (const v of varStatuses) {
      const icon = v.set ? green("✅") : red("❌");
      const label = v.set ? dim("set") : red("missing");
      console.log(`          ${icon}  ${v.name}  ${label}`);
    }
  } else {
    console.log(`  ${dim("auth:")}  none`);
  }

  // Missing-auth hint
  if (missing.length > 0) {
    console.log(
      `\n  ${red("Missing:")} ${missing.join(", ")}`,
    );
    console.log(
      `  Run: ${bold(`mcp-one auth setup ${config.id}`)}`,
    );
  }

  // Tools list
  console.log(`\n  ${dim("tools:")}  (${config.tools.length})`);
  for (const t of config.tools) {
    console.log(`    ${cyan(`${config.id}.${t.name}`)}  ${dim("—")}  ${t.description}`);
  }
  console.log();
}

// ── Entry point ───────────────────────────────────────────────────

export async function run(args: string[]): Promise<void> {
  loadEnvFile();
  const systemConfig = loadSystemConfig(process.cwd());
  const configDir = resolveConfigDir(undefined, systemConfig);
  const configs = loadConfigs(configDir);

  if (configs.length === 0) {
    console.error(
      `[mcp-one] No configs found in: ${configDir}\n` +
      `  Place mcp.*.json files there, or set config_dir in mcp-one.config.json`,
    );
    process.exit(1);
  }

  const serviceArg = args[0];

  if (!serviceArg) {
    // Table view
    renderTable(configs);
    return;
  }

  // Detail view
  const config = configs.find((c) => c.id === serviceArg);
  if (!config) {
    console.error(
      `[mcp-one] Config not found: "${serviceArg}"\n` +
      `  Available: ${configs.map((c) => c.id).join(", ")}`,
    );
    process.exit(1);
  }

  renderDetail(config);
}
