import { spawn } from "node:child_process";
import type { CliConnectorConfig, RegisteredTool, ToolDef } from "../types.js";
import type { IConnector, ConnectorResult } from "./base.js";
import { buildChildEnv } from "../lib/env-store.js";

export class CliConnector implements IConnector {
  readonly type = "cli" as const;

  async execute(tool: RegisteredTool, args: Record<string, unknown>): Promise<ConnectorResult> {
    const config = tool.connectorConfig as CliConnectorConfig;
    const timeout = config.timeout_ms ?? 30_000;

    const { cmd, cmdArgs, stdin } = this.buildCommand(tool.tool, args);

    return new Promise((resolve, reject) => {
      const child = spawn(cmd, cmdArgs, {
        cwd: config.cwd,
        env: buildChildEnv(tool.configId, config.env),
        shell: config.shell ?? true,
        timeout,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d: Buffer) => { stdout += d; });
      child.stderr.on("data", (d: Buffer) => { stderr += d; });

      if (stdin) {
        child.stdin.write(stdin);
        child.stdin.end();
      }

      child.on("close", (code: number | null) => {
        const exitCode = code ?? 1;
        let data: unknown = { stdout: stdout.trim(), stderr: stderr.trim() };

        if (tool.tool.output_as === "json") {
          try { data = JSON.parse(stdout); } catch { /* keep raw */ }
        }

        resolve({ success: exitCode === 0, status: exitCode, data });
      });

      child.on("error", (err: Error) => reject(err));
    });
  }

  private buildCommand(
    tool: ToolDef,
    args: Record<string, unknown>,
  ): { cmd: string; cmdArgs: string[]; stdin?: string } {
    // args_template: safer — no shell injection, each arg interpolated individually
    if (tool.args_template && tool.args_template.length > 0) {
      const interpolated = tool.args_template.map((t) =>
        t.replace(/\{\{(\w+)\}\}/g, (_, key) => {
          const val = args[key];
          return val !== undefined ? String(val) : "";
        }),
      );
      const parts = (tool.command ?? "").split(/\s+/).filter(Boolean);
      return { cmd: parts[0] || interpolated[0], cmdArgs: interpolated };
    }

    // command string interpolation — runs through shell
    const command = (tool.command ?? "").replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = args[key];
      return val !== undefined ? String(val) : "";
    });

    const stdin = tool.stdin_template?.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = args[key];
      return val !== undefined ? String(val) : "";
    });

    return { cmd: command, cmdArgs: [], stdin };
  }
}
