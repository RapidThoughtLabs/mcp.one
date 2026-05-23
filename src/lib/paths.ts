import os from "node:os";
import path from "node:path";

export function stateDir(): string {
  return process.env.MCP_ONE_STATE_DIR ?? path.join(os.homedir(), ".mcp-one", "state");
}

export function installSentinelDir(): string {
  return path.join(stateDir(), "installs");
}
