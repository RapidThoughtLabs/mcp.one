#!/usr/bin/env node
// Static imports — tsup (splitting: false, noExternal) bundles into one file.
// Dynamic imports would produce unresolvable paths in the bundle.
import { run as runStart } from "./commands/start.js";
import { run as runList } from "./commands/list.js";
import { run as runAuth } from "./commands/auth.js";
import { run as runLogin } from "./commands/login.js";
import { run as runPublish } from "./commands/publish.js";
import { run as runFork } from "./commands/fork.js";
import { run as runInstall } from "./commands/install.js";
import { run as runUninstall } from "./commands/uninstall.js";
import { run as runUpdate } from "./commands/update.js";

// ── Parse command ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] ?? "start";

// ── Route ─────────────────────────────────────────────────────────

switch (command) {
  case "start":
    await runStart(args.slice(1));
    break;

  case "list":
    await runList(args.slice(1));
    break;

  case "auth":
    await runAuth(args.slice(1));
    break;

  case "login":
  case "logout":
    await runLogin(command === "logout" ? ["logout", ...args.slice(1)] : args.slice(1));
    break;

  case "install":
    await runInstall(args.slice(1));
    break;

  case "uninstall":
  case "remove":
  case "rm":
    await runUninstall(args.slice(1));
    break;

  case "publish":
    await runPublish(args.slice(1));
    break;

  case "fork":
    await runFork(args.slice(1));
    break;

  case "update":
    await runUpdate(args.slice(1));
    break;

  case "help":
  case "--help":
  case "-h":
    printUsage();
    break;

  default:
    console.error(`Unknown command: "${command}"`);
    printUsage();
    process.exit(1);
}

// ── Usage ─────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
  heku — one server. any REST API. any LLM.

  Usage:
    heku start [config-dir]           Start the MCP server (stdio)
    heku start --http                 Start with stdio + HTTP transport
    heku start --http --port <n>      HTTP on a custom port (default 3333)
    heku list                         List all configs with auth status
    heku list <service>               Show tools for a specific config
    heku auth status                  Show auth health for all configs
    heku auth setup [service]         Interactive credential setup wizard
    heku install <target>             Install a config from the registry
    heku uninstall <target>           Remove an installed registry config
    heku update                       Update all installed configs to latest versions
    heku update <config>              Update a specific config (e.g. github-http or @ns/github:http)
    heku login                        Log in to the mcp.rtl.space registry
    heku logout                       Log out of the registry
    heku publish [file]               Publish a config to the registry
    heku fork <namespace/slug>        Fork a registry config into your namespace
    heku help                         Show this message

  HTTP mode:
    When --http is set, heku binds a second transport at /mcp on the
    given port (default 3333) alongside stdio. The UI dashboard and any
    HTTP MCP client can connect there. Claude Desktop continues to use
    stdio as normal — zero config change required.
  `);
}
