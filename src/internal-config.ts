import type { McpConfig } from "./types.js";

/** Built-in self-management config — always present, cannot be deleted or overridden from disk. */
export const INTERNAL_CONFIG: McpConfig = {
  id: "one",
  name: "mcp.one Self-Management",
  description:
    "Create configs, add tools, install from registry, manage auth — mcp.one's own management interface for LLM agents.",
  connector: { type: "internal" },
  tools: [
    {
      name: "create_config",
      description:
        "Create a new mcp.one config file for any connector type (http, cli, file, grpc, graphql, mcp, sql, mongodb). The config is hot-reloaded automatically — for GraphQL/gRPC/MCP connectors, pass tools: [] and tools are auto-discovered from the endpoint or proto file. For sql/mongodb, each tool must declare a named query or operation.",
      params: [
        { name: "id",          type: "string",  required: true,  description: "Config ID — becomes the filename mcp.{id}.json and the tool namespace prefix" },
        { name: "name",        type: "string",  required: true,  description: "Human-readable name for this config" },
        { name: "connector",   type: "object",  required: true,  description: "Connector config object. Must include type: 'http'|'cli'|'file'|'grpc'|'graphql'|'mcp'|'sql'|'mongodb' plus type-specific fields (base_url+auth for http, endpoint for grpc/graphql, dialect+database for sql, database for mongodb, etc.)" },
        { name: "tools",       type: "array",   required: false, description: "Array of tool definitions. Required for http/cli/file connectors. Omit or pass [] for grpc/graphql/mcp — tools are auto-discovered." },
        { name: "description", type: "string",  required: false, description: "Description shown to the LLM for namespace discovery" },
        { name: "force",       type: "boolean", required: false, description: "Overwrite an existing config with the same id (default: false)" },
      ],
    },
    {
      name: "get_config",
      description: "Read the full config definition for a given config ID, including connector settings and all tool definitions.",
      params: [
        { name: "config_id", type: "string", required: true, description: "The config ID to retrieve (e.g. 'github', 'slack')" },
      ],
    },
    {
      name: "list_configs",
      description:
        "**Start here.** Returns the names of all active configs as a flat array. " +
        "Config IDs follow the pattern `<base>-<connector>` where connector is one of: " +
        "http, cli, file, grpc, graphql, mcp, sql, mongodb. " +
        "Use these names to scope `one.search` or `one.list_tools`.",
      params: [],
    },
    {
      name: "search",
      description:
        "Find tools by name or intent across all configs (or within a specific one). " +
        "Returns matching tools with full schemas grouped by match quality: " +
        "exact name match first, then partial, then description, then related. " +
        "Indexes both native `one.*` self-management tools and all service tools. " +
        "Pass config for exact-first matching: 'github-http' returns only github-http tools; " +
        "'github' matches both github-http and github-cli.",
      params: [
        {
          name: "query",
          type: "string",
          required: true,
          description: "Tool name, intent, or keyword. E.g. 'create_issue', 'send message', 'list repos'",
        },
        {
          name: "config",
          type: "string",
          required: false,
          description: "Config filter — exact match first, then substring. 'github-http' matches only github-http; 'github' matches github-http and github-cli. Omit to search all configs.",
        },
      ],
    },
    {
      name: "invoke",
      description: "Execute any registered tool by its qualified name (config_id.tool_name). Use after one.search or one.list_tools to run the tool you found. Works for all service tools (open-meteo-http.get_forecast, github-http.create_issue, etc.) and all one.* self-management tools.",
      params: [
        {
          name: "tool",
          type: "string",
          required: true,
          description: "Qualified tool name in the format config_id.tool_name (e.g. 'open-meteo-http.get_forecast', 'github-http.create_issue', 'one.server_status')"
        },
        {
          name: "args",
          type: "object",
          required: false,
          description: "Arguments for the tool, as an object matching its parameter schema. Omit or pass {} for tools with no required params."
        }
      ]
    },
    {
      name: "update_config",
      description: "Update an existing config's name, description, or connector settings. Changes are hot-reloaded automatically.",
      params: [
        { name: "config_id",   type: "string", required: true,  description: "Config ID to update" },
        { name: "name",        type: "string", required: false, description: "New display name" },
        { name: "description", type: "string", required: false, description: "New description" },
        { name: "connector",   type: "object", required: false, description: "Partial connector config to merge (e.g. update base_url or auth)" },
      ],
    },
    {
      name: "delete_config",
      description: "Delete a config file and unregister all its tools. Cannot delete the 'one' self-management config — use self_config: false in mcp-one.config.json instead.",
      params: [
        { name: "config_id", type: "string", required: true, description: "Config ID to delete" },
      ],
    },
    {
      name: "validate_config",
      description: "Dry-run validation of a config object without writing it to disk. Returns validation errors if any.",
      params: [
        { name: "config", type: "object", required: true, description: "Full config object to validate" },
      ],
    },
    {
      name: "add_tool",
      description: "Add a new tool definition to an existing HTTP, CLI, or File config. The tool is hot-reloaded and immediately available.",
      params: [
        { name: "config_id", type: "string", required: true, description: "Config ID to add the tool to" },
        { name: "tool",      type: "object", required: true, description: "Tool definition object with name, description, params, and connector-specific fields (method+path for http, command/args_template for cli, operation+path_template for file)" },
      ],
    },
    {
      name: "remove_tool",
      description: "Remove a tool from a config by name. The change is hot-reloaded automatically.",
      params: [
        { name: "config_id", type: "string", required: true, description: "Config ID" },
        { name: "tool_name", type: "string", required: true, description: "Name of the tool to remove" },
      ],
    },
    {
      name: "update_tool",
      description: "Update an existing tool's definition (params, path, method, description, etc.). Changes are hot-reloaded.",
      params: [
        { name: "config_id", type: "string", required: true, description: "Config ID" },
        { name: "tool_name", type: "string", required: true, description: "Name of the tool to update" },
        { name: "updates",   type: "object", required: true, description: "Partial tool definition with fields to update (merged with existing)" },
      ],
    },
    {
      name: "list_tools",
      description:
        "Returns tools with full schemas ready to call. " +
        "No args: returns only the native `one.*` self-management surface. " +
        "With config_id: returns all tools in that config. " +
        "For targeted lookup by name or intent, use `one.search` instead.",
      params: [
        { name: "config_id", type: "string", required: false, description: "Config ID to list tools for. Omit to list only native one.* tools." },
      ],
    },
    {
      name: "get_tool",
      description:
        "Returns the full schema for a single tool by qualified name (config_id.tool_name). " +
        "Use when you already know the tool name.",
      params: [
        { name: "qualified_name", type: "string", required: true, description: "Qualified tool name in format config_id.tool_name (e.g. 'github.create_issue')" },
      ],
    },
    {
      name: "registry_search",
      description: "Search the mcp.one registry for published configs by keyword, tags, category, or connector type.",
      params: [
        { name: "query",          type: "string",  required: false, description: "Search query string" },
        { name: "tags",           type: "string",  required: false, description: "Comma-separated tag filter (e.g. 'productivity,git')" },
        { name: "category",       type: "string",  required: false, description: "Category filter" },
        { name: "connector_type", type: "string",  required: false, description: "Filter by connector type: http, cli, grpc, graphql, file" },
        { name: "limit",          type: "number",  required: false, description: "Max results to return (default: 20)" },
        { name: "registry",       type: "string",  required: false, description: "Registry source name (default: 'default')" },
      ],
    },
    {
      name: "registry_browse",
      description: "Browse configs from the registry by popularity, recency, or editorial selection.",
      params: [
        { name: "mode",     type: "string", required: false, description: "Browse mode: 'featured' (default), 'popular', or 'recent'" },
        { name: "limit",    type: "number", required: false, description: "Max results (default: 20)" },
        { name: "registry", type: "string", required: false, description: "Registry source name (default: 'default')" },
      ],
    },
    {
      name: "registry_install",
      description: "Install a config from the registry into the local mcp-configs directory. The config is hot-reloaded and its tools become immediately available.",
      params: [
        { name: "target",   type: "string",  required: true,  description: "Registry slug in format namespace/slug or namespace/slug@version (e.g. 'mcp-one/github' or 'mcp-one/slack@1.2.0')" },
        { name: "force",    type: "boolean", required: false, description: "Reinstall even if already installed (default: false)" },
        { name: "registry", type: "string",  required: false, description: "Registry source name (default: 'default')" },
      ],
    },
    {
      name: "registry_check_updates",
      description: "Check all installed configs for available updates from the registry.",
      params: [
        { name: "registry", type: "string", required: false, description: "Registry source name (default: 'default')" },
      ],
    },
    {
      name: "auth_status",
      description: "Check which configs have missing or misconfigured credentials. Returns per-config auth status and the specific env vars that are missing.",
      params: [
        { name: "config_id", type: "string", required: false, description: "Check a specific config only (default: all configs)" },
      ],
    },
    {
      name: "auth_set",
      description: "Set an environment variable / credential. Written to the .env file and loaded into process.env immediately so the same-session auth checks pass without restart.",
      params: [
        { name: "key",   type: "string", required: true, description: "Environment variable name (e.g. 'GITHUB_TOKEN', 'OPENAI_API_KEY')" },
        { name: "value", type: "string", required: true, description: "Value to set" },
      ],
    },
    {
      name: "server_status",
      description: "Get mcp.one server health information: uptime, total tool count, loaded configs, and config directory path.",
      params: [],
    },
  ],
};
