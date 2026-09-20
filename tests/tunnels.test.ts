import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  isPasswordPrompt,
  parseMetricsAddr,
  probeTunnelHealthy,
  QUICKTUNNEL_URL_RE,
  waitForQuickTunnelUrl,
} from "@share/transport/tunnels/base";
import { PINGGY_URL_RE, cloudflaredArgs } from "@share/transport/tunnels/providers";
import { LanTransport } from "@share/transport";

describe("pinggy output parsing", () => {
  test("matches current + legacy hostnames, ignores noise", () => {
    expect(PINGGY_URL_RE.exec("https://nahvo-103-182-107-144.run.pinggy-free.link")?.[1])
      .toBe("https://nahvo-103-182-107-144.run.pinggy-free.link");
    expect(PINGGY_URL_RE.exec("https://oulwr-103-182-107-144.free.pinggy.net")?.[1])
      .toBe("https://oulwr-103-182-107-144.free.pinggy.net");
    expect(PINGGY_URL_RE.exec("https://abc.a.pinggy.link")?.[1]).toBe("https://abc.a.pinggy.link");
    expect(PINGGY_URL_RE.exec("See https://openssh.com/pq.html")).toBeNull();
    expect(PINGGY_URL_RE.exec("https://dashboard.pinggy.io")).toBeNull();
  });
});

describe("ssh password prompt detection", () => {
  test("detects prompts, ignores MOTD noise", () => {
    expect(isPasswordPrompt("a.pinggy.io password: ")).toBe(true);
    expect(isPasswordPrompt("Password:")).toBe(true);
    expect(isPasswordPrompt("Enter passphrase for key '/home/u/.ssh/id_rsa': ")).toBe(true);
    expect(isPasswordPrompt("Allocated port 5 for remote forward")).toBe(false);
    expect(isPasswordPrompt("Your tunnel will expire in 60 minutes")).toBe(false);
  });
});

describe("cloudflared quick-tunnel readiness", () => {
  test("matches current 4-word hostnames in log output", () => {
    const line =
      "2026-09-20T18:26:38Z INF |  https://negotiation-alternatively-attacks-encyclopedia.trycloudflare.com                  |";
    expect(QUICKTUNNEL_URL_RE.exec(line)?.[0]).toBe(
      "https://negotiation-alternatively-attacks-encyclopedia.trycloudflare.com"
    );
  });

  test("parses the metrics address from startup logs", () => {
    expect(parseMetricsAddr("2026-09-20T18:25:48Z INF Starting metrics server on 127.0.0.1:20241/metrics")).toBe(
      "127.0.0.1:20241"
    );
    expect(parseMetricsAddr("no metrics here")).toBeNull();
  });

  test("quick-tunnel args are isolated from user config", () => {
    const args = cloudflaredArgs(8787);
    expect(args).toContain("--no-autoupdate");
    // Empty config: ~/.cloudflared/config.yml (named tunnels) must never hijack routing.
    expect(args).toContain("--config");
    expect(args[args.indexOf("--config") + 1]).toMatch(/dev\/null|NUL/);
    expect(args).toContain("127.0.0.1:0"); // metrics for /ready gating
    expect(args[args.length - 1]).toBe("http://127.0.0.1:8787"); // IPv4 origin, not localhost
  });

  test("waits for /ready before resolving the URL", async () => {
    let ready = false;
    const metrics = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) => {
        const path = new URL(req.url).pathname;
        if (path === "/quicktunnel") return Response.json({ hostname: "demo-host.trycloudflare.com" });
        if (path === "/ready") {
          return ready
            ? Response.json({ status: 200, readyConnections: 1, connectorId: "x" })
            : Response.json({ status: 503, readyConnections: 0, connectorId: "x" }, { status: 503 });
        }
        return new Response("nf", { status: 404 });
      },
    });
    const addr = `127.0.0.1:${metrics.port}`;
    const out = new EventEmitter();
    const err = new EventEmitter();
    const fakeChild = { stdout: out, stderr: err, on: () => {}, kill: () => {} } as never;
    const pending = waitForQuickTunnelUrl(fakeChild, "cloudflared", 10_000);
    // Hostname in logs alone must NOT resolve while /ready is 503…
    out.emit("data", Buffer.from(`INF |  https://demo-host.trycloudflare.com  |\nINF Starting metrics server on ${addr}/metrics\n`));
    await new Promise((r) => setTimeout(r, 1200));
    // …but once the connector is live it resolves to the same hostname.
    ready = true;
    await expect(pending).resolves.toBe("https://demo-host.trycloudflare.com");
    metrics.stop();
  }, 20000);
});

describe("tunnel health probe", () => {
  test("true for a live /health, false for dead port", async () => {
    const srv = Bun.serve({
      port: 18991,
      hostname: "127.0.0.1",
      fetch: (req) => (new URL(req.url).pathname === "/health" ? Response.json({ ok: true }) : new Response("x")),
    });
    expect(await probeTunnelHealthy("http://127.0.0.1:18991", 8000)).toBe(true);
    srv.stop();
    expect(await probeTunnelHealthy("http://127.0.0.1:18992", 3000)).toBe(false);
  }, 20000);
});

describe("lan transport", () => {
  test("exposes primary first, includes all IPv4", async () => {
    const t = new LanTransport();
    const eps = await t.open({ port: 8787 });
    expect(eps.length).toBeGreaterThanOrEqual(1);
    expect(eps[0].kind).toBe("lan");
    expect(eps[0].label).toBe("LAN");
    for (const ep of eps) expect(ep.url).toMatch(/^http:\/\/[^:]+:8787$/);
  });
});
