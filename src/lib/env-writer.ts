import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Paths ─────────────────────────────────────────────────────────
// Home-relative so all invocations (CLI, server, any CWD) share one file.

const ENV_PATH    = path.join(os.homedir(), ".mcp-one.env");
const BACKUP_PATH = path.join(os.homedir(), ".mcp-one.env.backup");
const GITIGNORE_PATH = path.join(process.cwd(), ".gitignore");

// ── Internal helpers ──────────────────────────────────────────────

/** Parse raw .env content, returning all lines (preserves comments/blanks). */
function parseLines(content: string): string[] {
  // Handle both \r\n and \n
  return content.split(/\r?\n/);
}

/** Returns the index of the line that defines `key`, or -1 if not found. */
function findKeyLine(lines: string[], key: string): number {
  return lines.findIndex((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed === "") return false;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return false;
    return trimmed.slice(0, eq).trim() === key;
  });
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Read .env and load its vars into process.env.
 *
 * @param override  If false (default), skip vars already in process.env
 *                  (preserves shell env at startup).
 *                  If true, overwrite existing values (hot-reload after auth setup).
 * @returns Number of vars set or updated.
 */
export function loadEnvFile(override = false): number {
  if (!fs.existsSync(ENV_PATH)) return 0;

  const content = fs.readFileSync(ENV_PATH, "utf-8");
  let count = 0;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");

    if (override || !process.env[key]) {
      process.env[key] = val;
      count++;
    }
  }

  return count;
}

/** Read the project's .env file. Returns "" if it doesn't exist. */
export function readEnvFile(): string {
  return fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
}

/** Copy .env → .env.backup before any write (no-op if .env doesn't exist). */
export function backupEnvFile(): void {
  if (fs.existsSync(ENV_PATH)) {
    fs.copyFileSync(ENV_PATH, BACKUP_PATH);
  }
}

export interface EnvEntry {
  key: string;
  value: string;
}

export interface AppendResult {
  written: string[];
  skipped: string[];
}

/**
 * Append new env vars to .env with a service comment header.
 *
 * - Backs up .env before writing (no-op if file doesn't exist yet).
 * - Skips vars already present unless `overwrite` is true.
 * - When overwriting, replaces the existing line in-place.
 * - Appends new vars as a block with a comment header.
 * - Sets process.env immediately so same-session checks see the new values.
 * - Never writes an empty value (key= with no value).
 */
export function appendEnvVars(
  serviceId: string,
  entries: EnvEntry[],
  overwrite = false,
): AppendResult {
  const written: string[] = [];
  const skipped: string[] = [];

  // Filter out entries with empty values — never write KEY= to disk
  const valid = entries.filter((e) => e.value.length > 0);
  if (valid.length === 0) return { written, skipped };

  const content = readEnvFile();
  const lines = content ? parseLines(content) : [];

  // Remove trailing empty line(s) that would cause extra blank lines on append
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  const toAppend: EnvEntry[] = [];

  for (const entry of valid) {
    const existing = findKeyLine(lines, entry.key);
    if (existing !== -1 && !overwrite) {
      skipped.push(entry.key);
      continue;
    }
    if (existing !== -1 && overwrite) {
      // Replace the line in-place
      lines[existing] = `${entry.key}=${entry.value}`;
      written.push(entry.key);
      process.env[entry.key] = entry.value;
    } else {
      // New var — queue for append block
      toAppend.push(entry);
    }
  }

  // Build the new content
  let result = lines.join("\n");

  if (toAppend.length > 0) {
    // Add blank line separator if there's existing content
    if (result.length > 0) result += "\n\n";
    result += `# ${serviceId} (added by mcp-one auth setup)\n`;
    for (const e of toAppend) {
      result += `${e.key}=${e.value}\n`;
      written.push(e.key);
      process.env[e.key] = e.value;
    }
  } else if (overwrite && written.length > 0) {
    // In-place overwrites only — just ensure trailing newline
    result += "\n";
  }

  if (written.length > 0) {
    backupEnvFile();
    fs.writeFileSync(ENV_PATH, result, "utf-8");
  }

  return { written, skipped };
}

/**
 * Returns true if ".env" appears in the project's .gitignore.
 * Checks for exact ".env", ".env*", or "*.env" patterns.
 */
export function isEnvInGitignore(): boolean {
  if (!fs.existsSync(GITIGNORE_PATH)) return false;
  const content = fs.readFileSync(GITIGNORE_PATH, "utf-8");
  return content.split(/\r?\n/).some((line) => {
    const t = line.trim();
    return t === ".env" || t === ".env*" || t === "*.env" || t === "/.env";
  });
}
