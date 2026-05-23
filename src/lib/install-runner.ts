import { spawn } from "node:child_process";

export interface InstallResult {
  success: boolean;
  exitCode: number;
  durationMs: number;
  logTail: string[];
  error?: string;
}

export interface RunInstallOpts {
  configId: string;
  command: string;
  args?: string[];
  cwd?: string;
  env: Record<string, string>;
  timeoutMs: number;
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
}

const MAX_TAIL = 50;

export async function runInstall(opts: RunInstallOpts): Promise<InstallResult> {
  const { configId, command, args, cwd, env, timeoutMs, onLine } = opts;
  const start = Date.now();
  const logTail: string[] = [];

  function recordLine(line: string, stream: "stdout" | "stderr"): void {
    logTail.push(line);
    if (logTail.length > MAX_TAIL) logTail.shift();
    onLine?.(line, stream);
  }

  const child = args !== undefined
    ? spawn(command, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      })
    : spawn(command, [], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }, 5_000);
  }, timeoutMs);

  function attachLineReader(stream: NodeJS.ReadableStream, label: "stdout" | "stderr"): void {
    let buf = "";
    stream.setEncoding("utf-8");
    stream.on("data", (chunk: string) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) recordLine(line, label);
    });
    stream.on("end", () => {
      if (buf.length > 0) { recordLine(buf, label); buf = ""; }
    });
  }

  attachLineReader(child.stdout!, "stdout");
  attachLineReader(child.stderr!, "stderr");

  return new Promise((resolve) => {
    child.on("close", (code) => {
      clearTimeout(timer);
      const exitCode = code ?? 1;
      const durationMs = Date.now() - start;

      if (timedOut) {
        resolve({
          success: false,
          exitCode: -1,
          durationMs,
          logTail,
          error: `install_command for "${configId}" timed out after ${timeoutMs}ms`,
        });
        return;
      }

      resolve({
        success: exitCode === 0,
        exitCode,
        durationMs,
        logTail,
        ...(exitCode !== 0 ? { error: `exited with code ${exitCode}` } : {}),
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        exitCode: -1,
        durationMs: Date.now() - start,
        logTail,
        error: err.message,
      });
    });
  });
}
