import { spawn, type ChildProcess } from "node:child_process";
import type { Endpoint, OpenOptions, Transport, TransportStatus } from "../types.ts";
import type { ProviderCapabilities } from "../types.ts";

export interface TunnelAdapterOptions {
  name: string;
  priority: number;
  capabilities: ProviderCapabilities;
  /** Binary that must exist (checked via `which`). Null = no binary needed. */
  binary: string | null;
  /** Spawn the tunnel; resolve with public URL once known. */
  start: (port: number) => { child: ChildProcess; url: Promise<string> };
  /** Optional extra install hint for doctor output. */
  installHint?: string;
}

async function hasBinary(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = spawn("which", [bin]);
    c.on("close", (code) => resolve(code === 0));
    c.on("error", () => resolve(false));
  });
}

export function defineTunnelAdapter(opts: TunnelAdapterOptions): Transport & { capabilities: ProviderCapabilities; installHint?: string } {
  let child: ChildProcess | null = null;
  return {
    name: opts.name,
    priority: opts.priority,
    capabilities: opts.capabilities,
    installHint: opts.installHint,
    async detect(): Promise<TransportStatus> {
      if (!opts.binary) return { available: true };
      const ok = await hasBinary(opts.binary);
      return ok
        ? { available: true, detail: `${opts.binary} found` }
        : { available: false, detail: `${opts.binary} not installed` };
    },
    async open(options: OpenOptions): Promise<Endpoint[]> {
      const started = opts.start(options.port);
      child = started.child;
      const url = await started.url;
      return [{ url, kind: "tunnel", label: opts.name }];
    },
    async close(): Promise<void> {
      try { child?.kill("SIGTERM"); } catch { /* noop */ }
      child = null;
    },
  };
}

export function sshTunnel(name: string, priority: number, caps: ProviderCapabilities, sshArgs: (port: number) => string[], urlRegex: RegExp, installHint?: string) {
  return defineTunnelAdapter({
    name,
    priority,
    capabilities: caps,
    binary: "ssh",
    installHint,
    start: (port: number) => {
      // No GUI askpass: without a TTY, ssh would otherwise spawn ssh-askpass
      // and hang forever. With SSH_ASKPASS_REQUIRE=never the prompt (if any)
      // falls back to stdin, which is a pipe we auto-answer once below.
      // (e.g. pinggy free documents an empty password = "just press enter".)
      const child = spawn("ssh", sshArgs(port), {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, DISPLAY: "", SSH_ASKPASS: "", SSH_ASKPASS_REQUIRE: "never" },
      });
      let answered = false;
      const maybeAnswerPassword = (d: Buffer) => {
        if (answered) return;
        if (isPasswordPrompt(d.toString())) {
          answered = true;
          try { child.stdin?.write("\n"); } catch { /* noop */ }
        }
      };
      const url = new Promise<string>((resolve, reject) => {
        let buf = "";
        const timer = setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* noop */ }
          reject(new Error(`${name} timed out waiting for URL`));
        }, 25_000);
        const onData = (d: Buffer) => {
          buf += d.toString();
          maybeAnswerPassword(d);
          const m = urlRegex.exec(buf);
          if (m) {
            clearTimeout(timer);
            child.stdout?.off("data", onData);
            child.stderr?.off("data", onData);
            resolve(m[1] ?? m[0]);
          }
        };
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        child.on("exit", (code) => {
          clearTimeout(timer);
          if (code !== 0 && code !== null) reject(new Error(`${name} exited with code ${code}: ${buf.slice(-500)}`));
        });
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(new Error(`${name} failed to start: ${(e as Error).message}`));
        });
      });
      return { child, url };
    },
  });
}

/** True when a chunk of ssh output is an interactive password prompt. */
export function isPasswordPrompt(text: string): boolean {
  return /(^|\s)(password|passphrase)( for |:)/i.test(text);
}

/** Probe a tunnel URL until our /health answers (or timeout). Guards against
 *  providers that issue a URL before traffic actually routes (e.g. cloudflare
 *  quick tunnels returning edge 404s). Returns true when healthy. */
export async function probeTunnelHealthy(publicUrl: string, timeoutMs = 20_000): Promise<boolean> {
  const health = publicUrl.replace(/\/$/, "") + "/health";
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(health, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (body?.ok === true) return true;
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
