# heku

> One server. Any REST API. Any LLM.

**heku** is a single dynamic [Model Context Protocol](https://modelcontextprotocol.io) server that turns JSON config files into working API tools. No code to write — drop a config, and your LLM gets the tools instantly.

Stop building one MCP server per API. Build one config.

---

## Features

- **7 connector types** — HTTP, gRPC, GraphQL, CLI, File, child-MCP, and Internal (self-management)
- **Hot-reload** — add or edit a config, tools update live without restart
- **Auto-discovery** — gRPC reflection, GraphQL introspection, and child MCP tool listing fill in tools automatically
- **Built-in console UI** — React dashboard for chat, config editing, and registry browsing
- **Registry** — publish and install community configs from [app.rapidthoughtlabs.space](https://app.rapidthoughtlabs.space)
- **Auth handled** — bearer, basic, API key, and OAuth2 with `.env`-based credential management
- **Self-managing** — the server can create and edit its own configs via internal tools

---

## Install

Requires **Node.js ≥ 20**.

```bash
npx @rapidthoughtlabs/heku start
```

Or install globally:

```bash
npm install -g @rapidthoughtlabs/heku
heku start
```

---

## Quick start

Create a config in `mcp-configs/mcp.github.json`:

```json
{
  "id": "github",
  "name": "GitHub API",
  "connector": {
    "type": "http",
    "base_url": "https://api.github.com",
    "auth": { "type": "bearer", "token_env": "GITHUB_TOKEN" }
  },
  "tools": [
    {
      "name": "list_repos",
      "description": "List repositories for the authenticated user",
      "method": "GET",
      "path": "/user/repos",
      "params": [
        { "name": "per_page", "type": "number", "required": false, "location": "query", "description": "Results per page" }
      ]
    }
  ]
}
```

Set your token:

```bash
heku auth setup github
```

Start the server:

```bash
heku start
```

Your LLM now has a `github.list_repos` tool. That's it.

---

## Connector types

| Type | Use case |
|---|---|
| `http` | REST APIs — define method, path, params, response mapping |
| `grpc` | gRPC services — load via `.proto` file or server reflection; tools auto-discovered |
| `graphql` | GraphQL APIs — introspection-based auto-discovery, or define operations manually |
| `cli` | Wrap any shell command as a tool with templated args/stdin |
| `file` | Filesystem operations: read, write, append, delete, list |
| `mcp` | Spawn another MCP server (stdio or SSE) and proxy its tools through heku |
| `internal` | heku's own management surface — create configs, install from registry, set auth |

---

## CLI commands

```text
heku start [config-dir]      Start the MCP server (stdio by default)
                             Flags: --http, --port <n>, --debug

heku list [service]          List loaded configs + auth status
heku auth                    Check or set up credentials interactively
heku auth status             Show per-service auth health
heku auth setup [service]    Walk through env-var setup, write to .env

heku login                   Authenticate with the registry
heku logout                  Clear stored registry credentials

heku install <target>        Install a config from the registry
                             Target: @ns/slug or @ns/slug@version
heku uninstall <target>      Remove an installed registry config
heku publish [file]          Publish a local config to the registry
heku fork <namespace/slug>   Fork a published config into your namespace

heku discover                Scan Claude Desktop / Cursor for MCP servers
heku update                  Update heku to the latest version
heku help                    Show usage
```

Run with `--http` to start the console UI alongside the stdio server:

```bash
heku start --http --port 3456
```

---

## Configuration

### Config file shape

Configs live in `mcp-configs/mcp.{id}.json`:

```typescript
{
  id: string;                  // becomes the tool namespace prefix
  name: string;
  description?: string;        // shown to the LLM
  connector: ConnectorConfig;  // one of 7 types
  tools: ToolDef[];            // empty for auto-discovery (grpc/graphql/mcp)
  overlays?: {                 // override tool descriptions without editing the config
    [toolName: string]: { description?: string }
  };
}
```

### Auth types

All credentials read from environment variables — `heku auth setup` writes them to `.env`:

- **`bearer`** — `Authorization: Bearer {token}`
- **`basic`** — base64(username:token)
- **`api_key`** — custom header (e.g. `X-API-Key`)
- **`oauth2_static`** — pre-acquired OAuth2 access token

### System config (optional)

Drop `heku.config.json` in your config directory:

```json
{
  "log_level": "info",
  "rate_limits": {
    "github": { "requests_per_minute": 60 }
  },
  "self_config": true
}
```

---

## Console UI

The dashboard is a React + Vite app that talks to the heku server:

- **Chat** — test tools through a model of your choice
- **Configs** — visual editor for connector and tool definitions
- **Registry** — browse, install, and publish configs
- **Auth** — see credential status across all configs at a glance

Built with React 19, TailwindCSS v4, Zustand, and the MCP SDK.

---

## Registry

[**app.rapidthoughtlabs.space**](https://app.rapidthoughtlabs.space) is the default registry for sharing configs.

```bash
heku install @rtl/github
heku install @rtl/slack@1.2.0
heku publish my-config.json
```

Use `--registry` to point at a different one.

---

## Development

```bash
git clone https://github.com/RapidThoughtLabs/heku
cd heku
npm install

npm run dev          # client (5173) + console server (3456) in parallel
npm run dev:mcp      # MCP stdio server only — for testing with Claude Desktop
npm run build        # bundle CLI to dist/cli.js via tsup
npm run typecheck    # tsc --noEmit
npm test             # vitest
```

### Layout

```
src/             MCP server core (CLI, connectors, auth, loader, executor)
server/          Express backend for the console UI
client/          React + Vite dashboard
protos/          Example .proto files for gRPC connector testing
scripts/         Registry seed scripts
mcp-configs/     Local config files (gitignored)
```

---

## Tech stack

TypeScript · Node.js (ESM) · `@modelcontextprotocol/sdk` · Express · React 19 · Vite · TailwindCSS · Zustand · `@grpc/grpc-js` · GraphQL · tsup · Vitest

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).
