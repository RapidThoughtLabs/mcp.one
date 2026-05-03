import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpConnectorConfig, RegisteredTool, ToolDef, ParamDef } from "../types.js";
import type { IConnector, ConnectorResult } from "./base.js";
import { runInstall } from "../lib/install-runner.js";
import { fingerprintInstall, readSentinel, writeSentinel } from "../lib/install-state.js";

interface McpChild {
  client: Client;
  configId: string;
  tools: ToolDef[];
  transport: "stdio" | "sse";
}

export class McpConnector implements IConnector {
  readonly type = "mcp" as const;

  private children = new Map<string, McpChild>();
  private pendingConfigs: Array<{ configId: string; config: McpConnectorConfig }> = [];

  addConfig(configId: string, config: McpConnectorConfig): void {
    this.pendingConfigs.push({ configId, config });
  }

  async init(): Promise<void> {
    const results = await Promise.allSettled(
      this.pendingConfigs.map(({ configId, config }) => this.spawnChild(configId, config)),
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const { configId } = this.pendingConfigs[i];
      if (r.status === "rejected") {
        console.error(`[mcp-connector] Failed to connect to "${configId}":`, r.reason);
      }
    }

    this.pendingConfigs = [];
  }

  async execute(tool: RegisteredTool, args: Record<string, unknown>): Promise<ConnectorResult> {
    const child = this.children.get(tool.configId);
    if (!child) {
      return {
        success: false,
        data: { error: `MCP child "${tool.configId}" not connected` },
      };
    }

    try {
      const result = await child.client.callTool({
        name: tool.tool.name,
        arguments: args,
      });

      // Unwrap the MCP CallToolResult envelope so the LLM receives the actual
      // content rather than a nested { content: [...], isError: bool } blob.
      const content = result.content as Array<{ type: string; text?: string }>;
      const texts = content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text);

      let data: unknown;
      if (texts.length === 1) {
        // Single text block — try to parse as JSON, fall back to plain string
        try { data = JSON.parse(texts[0]!); } catch { data = texts[0]; }
      } else if (texts.length > 1) {
        data = texts.join("\n");
      } else {
        // No text content (image/resource blocks) — return the raw content array
        data = result.content;
      }

      return { success: !result.isError, data };
    } catch (err) {
      return {
        success: false,
        data: { error: (err as Error).message, tool: tool.tool.name },
      };
    }
  }

  async teardown(): Promise<void> {
    for (const [id, child] of this.children) {
      try {
        await child.client.close();
        console.error(`[mcp-connector] Disconnected: ${id}`);
      } catch {
        // already dead
      }
    }
    this.children.clear();
  }

  getDiscoveredTools(configId: string): ToolDef[] {
    return this.children.get(configId)?.tools ?? [];
  }

  // ── Internal ──────────────────────────────────────────────────────

  private async spawnChild(configId: string, config: McpConnectorConfig): Promise<void> {
    if (config.transport === "stdio" && config.install_command) {
      await this.ensureInstalled(configId, config);
    }

    let transport;

    if (config.transport === "stdio") {
      transport = new StdioClientTransport({
        command: config.command!,
        args: config.args,
        env: { ...process.env, ...config.env } as Record<string, string>,
      });
    } else {
      transport = new SSEClientTransport(new URL(config.url!));
    }

    const client = new Client({ name: "mcp-one", version: "0.1.0" }, {});
    await client.connect(transport);

    const toolsResult = await client.listTools();
    const tools: ToolDef[] = toolsResult.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      params: this.schemaToParams(t.inputSchema),
    }));

    this.children.set(configId, { client, configId, tools, transport: config.transport });
    console.error(`[mcp-connector] Connected: ${configId} (${tools.length} tools discovered)`);
  }

  private async ensureInstalled(configId: string, config: McpConnectorConfig): Promise<void> {
    const fp = fingerprintInstall(config);
    const sentinel = readSentinel(configId);
    if (sentinel?.fingerprint === fp) {
      console.error(`[mcp-install:${configId}] already installed (fingerprint match)`);
      return;
    }

    if (config.install_check_command) {
      const probe = await runInstall({
        configId,
        command: config.install_check_command,
        timeoutMs: 30_000,
      });
      if (probe.success) {
        writeSentinel({
          config_id: configId,
          fingerprint: fp,
          installed_at: new Date().toISOString(),
          install_log_tail: [],
          exit_code: 0,
        });
        console.error(`[mcp-install:${configId}] check command passed — skipping install`);
        return;
      }
    }

    console.error(`[mcp-install:${configId}] starting install: ${config.install_command}`);
    const result = await runInstall({
      configId,
      command: config.install_command!,
      args: config.install_args,
      cwd: config.install_cwd,
      env: config.install_env,
      timeoutMs: config.install_timeout_ms ?? 600_000,
      onLine: (line, stream) => {
        console.error(`[mcp-install:${configId}] ${stream === "stderr" ? "!" : ">"} ${line}`);
      },
    });

    if (!result.success) {
      throw new Error(
        `[mcp-install:${configId}] install failed (exit ${result.exitCode}, ${result.durationMs}ms)\n` +
        `Last output:\n${result.logTail.join("\n")}`,
      );
    }

    writeSentinel({
      config_id: configId,
      fingerprint: fp,
      installed_at: new Date().toISOString(),
      install_log_tail: result.logTail,
      exit_code: 0,
    });
    console.error(`[mcp-install:${configId}] install complete (${result.durationMs}ms)`);
  }

  private schemaToParams(schema: unknown): ParamDef[] {
    if (!schema || typeof schema !== "object") return [];
    const s = schema as Record<string, unknown>;
    const properties = s.properties as Record<string, unknown> | undefined;
    if (!properties) return [];

    const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
    const params: ParamDef[] = [];

    for (const [name, prop] of Object.entries(properties)) {
      if (!prop || typeof prop !== "object") continue;
      const p = prop as Record<string, unknown>;
      params.push({
        name,
        type: (
          typeof p.type === "string" &&
          ["string", "number", "boolean", "object", "array"].includes(p.type)
        )
          ? (p.type as ParamDef["type"])
          : "string",
        required: required.has(name),
        description: typeof p.description === "string" ? p.description : name,
        location: "body",
      });
    }

    return params;
  }
}
