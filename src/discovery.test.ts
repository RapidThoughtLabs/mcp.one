import { describe, it, expect } from "vitest";
import { isSelfReferential } from "./discovery.js";

// ---------------------------------------------------------------------------
// isSelfReferential — unit tests
//
// The guard must:
//   - Return TRUE  for any invocation that would spawn another mcp-one process
//   - Return FALSE for all other MCP servers
//   - Never produce false positives on package names that merely contain "mcp-one"
// ---------------------------------------------------------------------------

describe("isSelfReferential", () => {
  // ── Should be SKIPPED (self-referential) ──────────────────────────────────

  it("detects: npx -y mcp-one start (standard Cursor/Claude config)", () => {
    expect(
      isSelfReferential({ id: "mcp-one", command: "npx", args: ["-y", "mcp-one", "start"] }),
    ).toBe(true);
  });

  it("detects: npx -y mcp-one start ./custom-dir (with config dir arg)", () => {
    expect(
      isSelfReferential({
        id: "mcp-one",
        command: "npx",
        args: ["-y", "mcp-one", "start", "./mcp-configs"],
      }),
    ).toBe(true);
  });

  it("detects: npx mcp-one start (without -y flag)", () => {
    expect(
      isSelfReferential({ id: "mcp-one", command: "npx", args: ["mcp-one", "start"] }),
    ).toBe(true);
  });

  it("detects: mcp-one start (global binary, Unix)", () => {
    expect(
      isSelfReferential({ id: "mcp-one", command: "mcp-one", args: ["start"] }),
    ).toBe(true);
  });

  it("detects: mcp-one.cmd start (global binary, Windows CMD wrapper)", () => {
    expect(
      isSelfReferential({ id: "mcp-one", command: "mcp-one.cmd", args: ["start"] }),
    ).toBe(true);
  });

  it("detects: /usr/local/bin/mcp-one start (absolute path, Unix)", () => {
    expect(
      isSelfReferential({ id: "mcp-one", command: "/usr/local/bin/mcp-one", args: ["start"] }),
    ).toBe(true);
  });

  it("detects: C:\\npm\\mcp-one.cmd start (absolute path, Windows)", () => {
    expect(
      isSelfReferential({
        id: "mcp-one",
        command: "C:\\Users\\user\\AppData\\Roaming\\npm\\mcp-one.cmd",
        args: ["start"],
      }),
    ).toBe(true);
  });

  // ── Should be INCLUDED (not self-referential) ─────────────────────────────

  it("allows: npx -y @upstash/context7-mcp (unrelated server)", () => {
    expect(
      isSelfReferential({
        id: "context7",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
      }),
    ).toBe(false);
  });

  it("allows: node /path/to/other-server.js (unrelated node server)", () => {
    expect(
      isSelfReferential({
        id: "other-server",
        command: "node",
        args: ["/path/to/other-server.js"],
      }),
    ).toBe(false);
  });

  it("allows: cmd /c npx -y @21st-dev/magic@latest (unrelated Windows server)", () => {
    expect(
      isSelfReferential({
        id: "Magic MCP",
        command: "cmd",
        args: ["/c", "npx", "-y", "@21st-dev/magic@latest"],
      }),
    ).toBe(false);
  });

  // ── False-positive regression ─────────────────────────────────────────────

  it("does NOT flag: npx -y mcp-one-extra (name contains mcp-one as substring)", () => {
    // Substring matching would incorrectly flag this. Exact equality must be used.
    expect(
      isSelfReferential({ id: "mcp-one-extra", command: "npx", args: ["-y", "mcp-one-extra"] }),
    ).toBe(false);
  });

  it("does NOT flag: mcp-one-gateway binary (command basename substring match)", () => {
    expect(
      isSelfReferential({ id: "gateway", command: "mcp-one-gateway", args: ["start"] }),
    ).toBe(false);
  });
});
