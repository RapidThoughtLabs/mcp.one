import express from "express";
import cors from "cors";
import { createMcpClient } from "./mcp-client.js";
import { createApiRouter } from "./api.js";
import { createRegistryRouter } from "./registry-api.js";

const PORT = Number(process.env["PORT"] ?? 3456);

// ── MCP Bridge ─────────────────────────────────────────────────────
// Spawns mcp-one as a child process and communicates over stdio

const mcp = createMcpClient();

// ── Express App ────────────────────────────────────────────────────

const app = express();

// Allow requests from the Vite dev server (localhost:5173) and same-origin
app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"] }));
app.use(express.json());

// Mount all /api routes
app.use("/api", createApiRouter(mcp));

// Mount registry proxy routes
app.use("/api/registry", createRegistryRouter());

// Health ping at root for quick checks
app.get("/", (_req, res) => {
  res.json({ service: "mcp-one-api", version: "0.1.0" });
});

// ── Start ──────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`[server] API listening on http://localhost:${PORT}`);
  console.log(`[server] Health: http://localhost:${PORT}/api/health`);
});

// ── Graceful Shutdown ──────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[server] ${signal} received — shutting down`);
  await mcp.shutdown();
  server.close(() => {
    console.log("[server] HTTP server closed");
    process.exit(0);
  });
  // Force exit after 5s if graceful close hangs
  setTimeout(() => process.exit(1), 5_000);
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT",  () => { void shutdown("SIGINT");  });

// Prevent unhandled rejections from crashing the server
process.on("unhandledRejection", (err) => {
  console.error("[server] Unhandled rejection (non-fatal):", err);
});
