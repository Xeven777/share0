import { describe, expect, test } from "bun:test";
import { isPasswordPrompt, probeTunnelHealthy } from "@share/transport/tunnels/base";
import { PINGGY_URL_RE } from "@share/transport/tunnels/providers";
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
