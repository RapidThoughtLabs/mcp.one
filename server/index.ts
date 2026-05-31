import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { createMcpClient } from "./mcp-client.js";
import { createApiRouter } from "./api.js";
import { createRegistryRouter } from "./registry-api.js";

export async function startBridge(options: {
  port?: number;
  /** If provided, auto-connect to this mcp-one endpoint on startup. */
  endpoint?: string;
}): Promise<{ shutdown: () => Promise<void> }> {
  const port = options.port ?? 3456;
  const mcp = createMcpClient();

  const app = express();

  app.use(cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://console.rapidthoughtlabs.space",
    ],
  }));
  app.use(express.json());

  app.use("/api", createApiRouter(mcp));
  app.use("/api/registry", createRegistryRouter());

  app.get("/", (_req, res) => {
    res.json({ service: "mcp-one-api", version: "0.1.0" });
  });

  const server = app.listen(port, () => {
    console.error(`[bridge] console API on http://localhost:${port}`);
  });

  if (options.endpoint) {
    try {
      await mcp.connectToEndpoint(options.endpoint);
    } catch {
      // MCP client will auto-reconnect via its backoff loop
    }
  }

  return {
    shutdown: async () => {
      await mcp.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ── Standalone entry (npm run dev:server) ──────────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const port = Number(process.env["PORT"] ?? 3456);
  const bridge = await startBridge({ port });

  async function shutdown(signal: string): Promise<void> {
    console.error(`\n[bridge] ${signal} received — shutting down`);
    await bridge.shutdown();
    process.exit(0);
  }

  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.once("SIGINT",  () => { void shutdown("SIGINT");  });
  process.on("unhandledRejection", (err) => {
    console.error("[bridge] Unhandled rejection (non-fatal):", err);
  });
}
