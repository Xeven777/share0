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

/** Matches a `*.trycloudflare.com` quick-tunnel hostname in cloudflared logs. */
export const QUICKTUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** Extract `127.0.0.1:20241` from `Starting metrics server on 127.0.0.1:20241/metrics`. */
export function parseMetricsAddr(text: string): string | null {
  const m = /Starting metrics server on ([0-9a-zA-Z.:\[\]-]+)\/metrics/i.exec(text);
  return m ? m[1].trim() : null;
}

async function pollQuickTunnelReady(metricsAddr: string, deadline: number): Promise<string | null> {
  while (Date.now() < deadline) {
    try {
      const q = await fetch(`http://${metricsAddr}/quicktunnel`, { signal: AbortSignal.timeout(1500) });
      const hostname = ((await q.json().catch(() => null)) as { hostname?: string } | null)?.hostname;
      if (hostname) {
        // Hostname is assigned slightly before the connector can carry
        // traffic — wait for a live edge connection too.
        const r = await fetch(`http://${metricsAddr}/ready`, { signal: AbortSignal.timeout(1500) });
        const body = (await r.json().catch(() => null)) as { readyConnections?: number } | null;
        if (r.ok && (body?.readyConnections ?? 0) > 0) return `https://${hostname}`;
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** Resolve a cloudflared quick-tunnel URL only once the local connector
 *  reports ready (`/quicktunnel` hostname + `/ready` connections via the
 *  `--metrics` endpoint). Falls back to the log URL when the metrics
 *  endpoint never appears (older cloudflared); the public `/health` probe
 *  in `selectTransports` remains the final gate either way. */
export function waitForQuickTunnelUrl(child: ChildProcess, name: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    let settled = false;
    let metricsAddr: string | null = null;
    let polling = false;
    let logUrl: string | null = null;
    const deadline = Date.now() + timeoutMs;
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
    };
    const succeed = (url: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(url);
    };
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(e);
    };
    const timer = setTimeout(() => {
      fail(new Error(`${name} timed out waiting for tunnel to be ready`));
      try { child.kill("SIGKILL"); } catch { /* noop */ }
    }, timeoutMs);
    const startPoll = () => {
      if (polling || !metricsAddr) return;
      polling = true;
      void pollQuickTunnelReady(metricsAddr, deadline).then((u) => {
        if (u) succeed(u);
        else if (logUrl) succeed(logUrl); // ready never came; let /health probe decide
      });
    };
    const onData = (d: Buffer) => {
      buf += d.toString();
      if (!metricsAddr) {
        metricsAddr = parseMetricsAddr(buf);
        if (metricsAddr) startPoll();
      }
      if (!logUrl) {
        const m = QUICKTUNNEL_URL_RE.exec(buf);
        if (m) {
          logUrl = m[0];
          // Give the metrics endpoint a moment to confirm readiness; if it
          // never shows up (old binary), use the log URL as fallback.
          setTimeout(() => {
            if (!settled && !metricsAddr && logUrl) succeed(logUrl);
          }, 3000);
        }
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => {
      if (!settled && code !== 0 && code !== null) {
        fail(new Error(`${name} exited (${code}): ${buf.slice(-500)}`));
      }
    });
    child.on("error", (e) => fail(new Error(`${name} failed to start: ${(e as Error).message}`)));
  });
}

/** Probe a tunnel URL until our /health answers (or timeout). Guards against
 *  providers that issue a URL before traffic actually routes (e.g. cloudflare
 *  quick tunnels returning edge 404/530s while the hostname propagates —
 *  measured at 60s+ on some networks, hence the long default). True when healthy. */
export async function probeTunnelHealthy(publicUrl: string, timeoutMs = 60_000): Promise<boolean> {
  const health = publicUrl.replace(/\/$/, "") + "/health";
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(health, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (body?.ok === true) return true;
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
