import os from "node:os";
import path from "node:path";
import { bold, cyan, dim, green, red, yellow } from "../lib/fmt.js";
import { loadSystemConfig } from "../system-config.js";
import { resolveConfigDir } from "../lib/resolve-config-dir.js";
import { VERSION } from "../lib/version.js";
import { stateDir } from "../lib/paths.js";

function isWindows(): boolean {
  return process.platform === "win32";
}

function formatPathList(raw: string | undefined): string[] {
  if (!raw) return [];
  const delimiter = isWindows() ? ";" : ":";
  return raw
    .split(delimiter)
    .map((p) => p.trim())
    .filter(Boolean);
}

function getExpectedGlobalBinDir(): string | null {
  if (isWindows()) {
    // Default npm global "bin" location on Windows.
    const appData = process.env.APPDATA;
    if (!appData) return null;
    return path.join(appData, "npm");
  }

  // Cross-platform global bin differs by install method (brew, nvm, asdf, system node).
  // We only provide guidance, not an assertion.
  return null;
}

export async function run(): Promise<void> {
  const systemConfig = loadSystemConfig(process.cwd());
  const configDir = resolveConfigDir(undefined, systemConfig);

  const expectedBinDir = getExpectedGlobalBinDir();
  const pathEntries = formatPathList(process.env.PATH);
  const hasExpectedBinOnPath = expectedBinDir ? pathEntries.includes(expectedBinDir) : false;

  console.log();
  console.log(bold("mcp-one doctor"));
  console.log(dim(`Version: ${VERSION}`));
  console.log();

  console.log(bold("Paths"));
  console.log(`  Config dir: ${cyan(configDir)}`);
  console.log(`  State dir:  ${cyan(stateDir())}`);
  console.log(`  Platform:   ${dim(`${os.platform()} ${os.release()}`)}`);
  console.log();

  console.log(bold("Global command availability"));
  if (isWindows()) {
    if (!expectedBinDir) {
      console.log(`${yellow("⚠")}  Could not determine npm global bin directory (APPDATA missing).`);
      console.log(dim("  If `mcp-one` is not recognized, add your npm global prefix to PATH and restart the terminal."));
    } else if (hasExpectedBinOnPath) {
      console.log(`${green("✓")}  npm global bin is on PATH: ${dim(expectedBinDir)}`);
    } else {
      console.log(`${red("✗")}  npm global bin is NOT on PATH: ${dim(expectedBinDir)}`);
      console.log();
      console.log(dim("  Fix (PowerShell, user scope):"));
      console.log(dim(`    [Environment]::SetEnvironmentVariable("Path", $env:Path + ";${expectedBinDir}", "User")`));
      console.log(dim("    # then close & reopen your terminal"));
    }
  } else {
    console.log(dim("  Run `which mcp-one` to confirm the command resolves on your PATH."));
  }

  console.log();
  console.log(bold("Try"));
  console.log(`  ${dim("$")} ${bold("mcp-one start")}`);
  console.log(`  ${dim("$")} ${bold("mcp-one start --http")}`);
  console.log();
}

