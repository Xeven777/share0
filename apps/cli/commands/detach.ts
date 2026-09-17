import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// `share send --detach`: re-launch the same command in the background so the
// share survives the terminal closing (the #1 "both links suddenly dead"
// cause). Child output goes to a log file; the parent streams it until the
// share URLs are printed, then exits while the share keeps running.

export function buildDetachedArgs(): { cmd: string; args: string[] } | null {
  // bun mode → [bun, <cli-path>, ...rest]; compiled binary → [bin, ...rest]
  const [exec, second, ...rest] = process.argv;
  if (!second) return null;
  const filtered = rest.filter((a) => a !== "--detach");
  return { cmd: exec, args: [second, ...filtered, "--detached-child"] };
}

function logDir(): string {
  const dir = process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, "share", "logs")
    : join(homedir(), ".local", "share", "share", "logs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Returns true when the parent handled (and should exit). */
export async function maybeDetachParent(): Promise<boolean> {
  const inv = buildDetachedArgs();
  if (!inv) {
    console.error("--detach: cannot determine launcher");
    process.exit(1);
  }
  const log = join(logDir(), `send-${Date.now()}.log`);
  const outFd = openSync(log, "a");
  const child = spawn(inv.cmd, inv.args, {
    detached: true,
    stdio: ["ignore", outFd, outFd],
    cwd: process.cwd(),
    env: process.env,
  });
  child.unref();
  console.log(`Share starting in background (pid ${child.pid}). Log: ${log}`);
  const ready = await waitForReady(log);
  let content = "";
  try { content = readFileSync(log, "utf8"); } catch { /* noop */ }
  // Re-print the child's output (URLs, QR) now that they're final.
  console.log(content);
  if (!ready) {
    console.error(`\nShare did not become ready in time. See log: ${log}`);
    console.error(`Stop it with: share stop <id> (see log for the id)`);
    process.exit(1);
  }
  console.log(`Running in background. Stop with: share stop <id>`);
  return true;
}

async function waitForReady(log: string, timeoutMs = 150_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1000));
    let content = "";
    try { content = readFileSync(log, "utf8"); } catch { continue; }
    if (/Press Ctrl\+C to stop/.test(content)) return true;
    if (/No such file|Invalid --|Unknown tunnel provider|No free port found/i.test(content)) return false;
  }
  return false;
}
