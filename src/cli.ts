#!/usr/bin/env node
// Static imports — tsup (splitting: false, noExternal) bundles into one file.
// Dynamic imports would produce unresolvable paths in the bundle.
import { run as runStart } from "./commands/start.js";
import { run as runList } from "./commands/list.js";
import { run as runAuth } from "./commands/auth.js";
import { run as runDiscover } from "./commands/discover.js";
import { run as runLogin } from "./commands/login.js";
import { run as runPublish } from "./commands/publish.js";
import { run as runFork } from "./commands/fork.js";
import { run as runInstall } from "./commands/install.js";
import { run as runUninstall } from "./commands/uninstall.js";
import { run as runUpdate } from "./commands/update.js";
import { checkForUpdate } from "./lib/update-check.js";

// ── Parse command ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] ?? "start";

// ── Update check (fire-and-forget, safe for all commands) ─────────
// Skip for the `update` command itself — it does its own check.
if (command !== "update") {
  checkForUpdate();
}

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

  case "discover":
    await runDiscover();
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
  mcp-one — one server. any REST API. any LLM.

  Usage:
    mcp-one start [config-dir]           Start the MCP server (stdio)
    mcp-one start --http                 Start with stdio + HTTP transport
    mcp-one start --http --port <n>      HTTP on a custom port (default 3333)
    mcp-one list                         List all configs with auth status
    mcp-one list <service>               Show tools for a specific config
    mcp-one auth status                  Show auth health for all configs
    mcp-one auth setup [service]         Interactive credential setup wizard
    mcp-one install <target>             Install a config from the registry
    mcp-one uninstall <target>           Remove an installed registry config
    mcp-one login                        Log in to the mcp.rtl.space registry
    mcp-one logout                       Log out of the registry
    mcp-one publish [file]               Publish a config to the registry
    mcp-one fork <namespace/slug>        Fork a registry config into your namespace
    mcp-one discover                     Show auto-discoverable MCP servers
    mcp-one update                       Update mcp-one to the latest version
    mcp-one help                         Show this message

  HTTP mode:
    When --http is set, mcp-one binds a second transport at /mcp on the
    given port (default 3333) alongside stdio. The UI dashboard and any
    HTTP MCP client can connect there. Claude Desktop continues to use
    stdio as normal — zero config change required.
  `);
}
