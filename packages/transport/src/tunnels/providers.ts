import { spawn } from "node:child_process";
import { platform } from "node:os";
import { defineTunnelAdapter, sshTunnel, waitForQuickTunnelUrl } from "./base.ts";

/** Args for an isolated quick tunnel. `--config <null>` is load-bearing:
 *  a `~/.cloudflared/config.yml` (named tunnel + ingress rules) makes
 *  TryCloudflare unsupported per Cloudflare docs and can hijack routing —
 *  pointing at an empty config keeps the quick tunnel self-contained. */
export function cloudflaredArgs(port: number): string[] {
  const nullConfig = platform() === "win32" ? "NUL" : "/dev/null";
  return [
    "tunnel",
    "--no-autoupdate",
    "--config", nullConfig,
    "--metrics", "127.0.0.1:0",
    "--url", `http://127.0.0.1:${port}`,
  ];
}

// Cloudflare Quick Tunnel: `cloudflared tunnel --url http://127.0.0.1:PORT`
// The edge assigns the hostname slightly before it can route traffic, so the
// URL resolves only after the local `--metrics` endpoint reports a hostname
// AND a live edge connection (`/ready`). `--no-autoupdate` skips the slow
// startup update check; explicit 127.0.0.1 avoids `localhost` resolving to
// ::1 on hosts where the server listens on IPv4 only.
export const cloudflareTunnel = defineTunnelAdapter({
  name: "cloudflare",
  priority: 60,
  binary: "cloudflared",
  installHint: "Install: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/",
  capabilities: {
    supportsHttps: true,
    supportsCustomHost: false,
    supportsLongLivedSessions: false, // quick tunnels are dev/test oriented
  },
  start: (port: number) => {
    const child = spawn("cloudflared", cloudflaredArgs(port), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { child, url: waitForQuickTunnelUrl(child, "cloudflared", 60_000) };
  },
});

// Pinggy free: unlimited data, ~60 min session (per product.md §7).
// Current SSH form (verified 2026): `ssh -p 443 -R0:localhost:PORT free.pinggy.io`.
// If ssh prompts for a password, the documented answer is an empty line —
// the adapter sends it automatically (see tunnels/base.ts).
export const PINGGY_URL_RE = /(https:\/\/[a-z0-9-]+\.(run\.pinggy-free\.link|free\.pinggy\.net|a\.pinggy\.link))/i;
export const pinggyTunnel = sshTunnel(
  "pinggy",
  50,
  {
    maxSessionDuration: 60 * 60,
    supportsHttps: true,
    supportsCustomHost: false,
    supportsLongLivedSessions: false,
  },
  (port) => ["-p", "443", "-R0:localhost:" + port, "-o", "StrictHostKeyChecking=no", "-o", "ServerAliveInterval=30", "-o", "NumberOfPasswordPrompts=1", "free.pinggy.io"],
  PINGGY_URL_RE,
  "Free, no signup (60-min sessions). If ssh asks for a password, just press Enter — share answers it automatically."
);

// localhost.run: ssh-based, free with speed limits.
export const localhostRunTunnel = sshTunnel(
  "localhost.run",
  80,
  {
    supportsHttps: true,
    supportsCustomHost: true,
    supportsLongLivedSessions: false,
  },
  (port) => ["-R", `80:localhost:${port}`, "-o", "StrictHostKeyChecking=no", "-o", "ServerAliveInterval=30", "nokey@localhost.run"],
  /(https:\/\/[a-z0-9-]+\.lhrtunnel\.link|https:\/\/[a-z0-9-]+\.localhost\.run)/i,
  "No install needed (uses ssh). See https://localhost.run"
);

// LocalXpose: `loclx tunnel http --to localhost:PORT`
export const localxposeTunnel = defineTunnelAdapter({
  name: "localxpose",
  priority: 55,
  binary: "loclx",
  installHint: "Install: https://localxpose.io/docs",
  capabilities: { supportsHttps: true, supportsCustomHost: false, supportsLongLivedSessions: true },
  start: (port: number) => {
    const child = spawn("loclx", ["tunnel", "http", "--to", `localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const url = new Promise<string>((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error("loclx timed out")), 30_000);
      const re = /(https:\/\/[a-z0-9-./]+\.(loclx\.io|localxpose\.io)[^\s]*)/i;
      const onData = (d: Buffer) => {
        buf += d.toString();
        const m = re.exec(buf);
        if (m) {
          clearTimeout(timer);
          child.stdout?.off("data", onData);
          child.stderr?.off("data", onData);
          resolve(m[1]);
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`loclx exited (${code}): ${buf.slice(-500)}`));
      });
    });
    return { child, url };
  },
});

// localtunnel: `npx localtunnel --port PORT`
export const localtunnelTunnel = defineTunnelAdapter({
  name: "localtunnel",
  priority: 70,
  binary: "npx",
  installHint: "npm i -g localtunnel",
  capabilities: { supportsHttps: true, supportsCustomHost: true, supportsLongLivedSessions: false },
  start: (port: number) => {
    const child = spawn("npx", ["-y", "localtunnel", "--port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const url = new Promise<string>((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error("localtunnel timed out")), 30_000);
      const re = /(https:\/\/[a-z0-9-]+\.loca\.lt)/i;
      const onData = (d: Buffer) => {
        buf += d.toString();
        const m = re.exec(buf);
        if (m) {
          clearTimeout(timer);
          child.stdout?.off("data", onData);
          child.stderr?.off("data", onData);
          resolve(m[1]);
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`localtunnel exited (${code}): ${buf.slice(-500)}`));
      });
    });
    return { child, url };
  },
});

// zrok: `zrok share public localhost:PORT` (5 GB/day free — small shares only)
export const zrokTunnel = defineTunnelAdapter({
  name: "zrok",
  priority: 75,
  binary: "zrok",
  installHint: "Install: https://zrok.io/docs/getting-started/",
  capabilities: {
    dailyTransferLimit: 5 * 1024 ** 3,
    supportsHttps: true,
    supportsCustomHost: false,
    supportsLongLivedSessions: true,
  },
  start: (port: number) => {
    const child = spawn("zrok", ["share", "public", `localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const url = new Promise<string>((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error("zrok timed out")), 30_000);
      const re = /(https:\/\/[a-z0-9-.]+\.(share\.zrok\.io|zrok\.io)[^\s]*)/i;
      const onData = (d: Buffer) => {
        buf += d.toString();
        const m = re.exec(buf);
        if (m) {
          clearTimeout(timer);
          child.stdout?.off("data", onData);
          child.stderr?.off("data", onData);
          resolve(m[1]);
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`zrok exited (${code}): ${buf.slice(-500)}`));
      });
    });
    return { child, url };
  },
});

export const allTunnelAdapters = [
  pinggyTunnel,
  localxposeTunnel,
  cloudflareTunnel,
  localtunnelTunnel,
  localhostRunTunnel,
  zrokTunnel,
];
