import type { McpClientInstance } from "./mcp-client.js";

export class AdminUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminUnavailableError";
  }
}

function getAdminBase(mcp: McpClientInstance): string {
  const { endpoint } = mcp.getStatus();
  if (!endpoint) throw new AdminUnavailableError("mcp-one not connected");
  // Derive admin base from MCP endpoint: http://host:port/mcp → http://host:port/admin
  const url = new URL(endpoint);
  url.pathname = "/admin";
  return url.toString();
}

async function request<T>(
  mcp: McpClientInstance,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const base = getAdminBase(mcp);
  const url = `${base}${path}`;

  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new AdminUnavailableError(`Cannot reach mcp-one admin API: ${(err as Error).message}`);
  }

  const data = await res.json() as T;
  if (!res.ok) {
    const errMsg = (data as Record<string, unknown>)["error"] as string | undefined;
    const err = new Error(errMsg ?? `mcp-one admin returned ${res.status}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }

  return data;
}

export function createAdminClient(mcp: McpClientInstance) {
  return {
    get<T = unknown>(path: string): Promise<T> {
      return request<T>(mcp, "GET", path);
    },
    post<T = unknown>(path: string, body: unknown): Promise<T> {
      return request<T>(mcp, "POST", path, body);
    },
    put<T = unknown>(path: string, body: unknown): Promise<T> {
      return request<T>(mcp, "PUT", path, body);
    },
    delete<T = unknown>(path: string): Promise<T> {
      return request<T>(mcp, "DELETE", path);
    },
  };
}
