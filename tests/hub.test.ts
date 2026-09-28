import { describe, expect, test } from "bun:test";
import { generateShortCode } from "@share/core";
import { serveHub, MemoryStore } from "@share/hub/local";
import { handleRequest } from "@share/hub/worker";
import {
  ANNOUNCE_TTL,
  HEARTBEAT_INTERVAL,
  HubError,
  announce,
  isAbsolutePushTarget,
  normalizeBase,
  resolve,
  retract,
  startHeartbeat,
} from "@share/hub";

describe("hub protocol", () => {
  test("announce then resolve a handle", async () => {
    const hub = serveHub();
    try {
      await announce(hub.url, { name: "anish", url: "https://x.trycloudflare.com", label: "anish laptop" });
      const got = await resolve(hub.url, "anish");
      expect(got.url).toBe("https://x.trycloudflare.com");
      expect(got.label).toBe("anish laptop");
      expect(got.kind).toBe("handle");
    } finally {
      hub.stop();
    }
  });

  test("handles and codes live in separate namespaces", async () => {
    const hub = serveHub();
    try {
      await announce(hub.url, { name: "abc", url: "https://handle.example", kind: "handle" });
      await announce(hub.url, { name: "abc", url: "https://code.example", kind: "code" });
      // Same name, both namespaces must resolve independently.
      expect((await resolve(hub.url, "abc", "handle")).url).toBe("https://handle.example");
      expect((await resolve(hub.url, "abc", "code")).url).toBe("https://code.example");
    } finally {
      hub.stop();
    }
  });

  test("unknown name throws a message a human can act on", async () => {
    const hub = serveHub();
    try {
      await expect(resolve(hub.url, "nobody")).rejects.toThrow(/not available right now/);
    } finally {
      hub.stop();
    }
  });

  test("retract removes a handle immediately", async () => {
    const hub = serveHub();
    try {
      await announce(hub.url, { name: "gone", url: "https://gone.example" });
      await retract(hub.url, "gone");
      await expect(resolve(hub.url, "gone")).rejects.toThrow(HubError);
    } finally {
      hub.stop();
    }
  });

  test("re-announcing refreshes rather than duplicating", async () => {
    const hub = serveHub();
    try {
      await announce(hub.url, { name: "flip", url: "https://one.example" });
      await announce(hub.url, { name: "flip", url: "https://two.example" });
      expect((await resolve(hub.url, "flip")).url).toBe("https://two.example");
      expect(hub.store.size).toBe(1);
    } finally {
      hub.stop();
    }
  });
});

describe("hub expiry, which is what inbox mode depends on", () => {
  test("a handle vanishes once its TTL passes, with no heartbeat", async () => {
    const store = new MemoryStore();
    await store.put("h:anish", JSON.stringify({ url: "https://dead.example" }), { expirationTtl: 1 });
    expect(await store.get("h:anish")).not.toBeNull();
    // Wait past it rather than faking the clock so MemoryStore's lazy-expiry
    // path is genuinely exercised.
    await new Promise((r) => setTimeout(r, 1100));
    expect(await store.get("h:anish")).toBeNull();
  });

  test("heartbeat keeps a name alive; stopping lets it die", async () => {
    const srv = serveHub();
    try {
      // Short TTL so "alive past the TTL" is observable inside a test.
      const stop = startHeartbeat(
        srv.url,
        { name: "beat", url: "https://live.example", ttl: 1 },
        { intervalMs: 200 }
      );
      await new Promise((r) => setTimeout(r, 900));
      // Refreshed repeatedly, so still resolvable long past a single TTL.
      expect((await resolve(srv.url, "beat")).url).toBe("https://live.example");
      stop();
      await new Promise((r) => setTimeout(r, 1200));
      // No more announces: the last one's TTL runs out and it 404s. This is
      // exactly how a crashed receiver stops advertising itself.
      await expect(resolve(srv.url, "beat")).rejects.toThrow(HubError);
    } finally {
      srv.stop();
    }
  });

  test("write budget fits the Cloudflare free tier", () => {
    // Free tier allows 1,000 KV writes/day. At a 10 minute interval the
    // heartbeat spends 144/day, so several receivers fit. A 30s heartbeat
    // needed 2,880 and exhausted the budget in about eight hours, which is why
    // the interval is 10 minutes and not 30 seconds.
    expect(86_400 / HEARTBEAT_INTERVAL).toBeLessThanOrEqual(200);
    // Three intervals of TTL, so two missed beats do not evict a live inbox.
    expect(ANNOUNCE_TTL).toBeGreaterThan(HEARTBEAT_INTERVAL * 2);
  });

  test("the worker's default TTL matches the client", async () => {
    // The client always sends an explicit ttl, but a hand-written PUT falls
    // back to the worker's default. If these drift, a name announced by curl
    // dies far sooner than one announced by share0.
    const store = new MemoryStore();
    const res = await handleRequest(
      new Request("http://h/a", {
        method: "PUT",
        body: JSON.stringify({ key: "h:x", url: "https://a.example" }),
      }),
      store
    );
    expect(((await res.json()) as { ttl: number }).ttl).toBe(ANNOUNCE_TTL);
  });

  test("heartbeat stops writing once the free-tier cap is reached", async () => {
    const srv = serveHub();
    const errors: Error[] = [];
    try {
      const stop = startHeartbeat(
        srv.url,
        { name: "capped", url: "https://capped.example" },
        { intervalMs: 50, maxWrites: 1, onError: (e) => errors.push(e) }
      );
      await new Promise((r) => setTimeout(r, 300));
      stop();
      expect(errors.some((e) => /write cap/.test(e.message))).toBe(true);
    } finally {
      srv.stop();
    }
  });

  test("default TTL is long enough to survive a missed beat", () => {
    // Three heartbeat intervals of TTL, so two consecutive failures are
    // survivable before a live receiver drops off the hub.
    expect(ANNOUNCE_TTL).toBeGreaterThanOrEqual(HEARTBEAT_INTERVAL * 2);
  });
});

describe("hub input handling", () => {
  const put = (body: unknown, store = new MemoryStore()) =>
    handleRequest(new Request("http://h/a", { method: "PUT", body: JSON.stringify(body) }), store);

  test("rejects non-http(s) targets", async () => {
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "not-a-url"]) {
      expect((await put({ key: "h:x", url: bad })).status).toBe(400);
    }
  });

  test("requires key and url", async () => {
    expect((await put({ url: "https://a.example" })).status).toBe(400);
    expect((await put({ key: "h:x" })).status).toBe(400);
  });

  test("clamps a hostile TTL into range", async () => {
    const res = await put({ key: "h:x", url: "https://a.example", ttl: 9_999_999 });
    const body = (await res.json()) as { ttl: number };
    expect(body.ttl).toBeLessThanOrEqual(86_400);
  });

  test("rejects an oversized key", async () => {
    expect((await put({ key: "h:" + "a".repeat(500), url: "https://a.example" })).status).toBe(400);
  });

  test("unknown routes 404 and health answers", async () => {
    const store = new MemoryStore();
    const health = await handleRequest(new Request("http://h/health"), store);
    expect(health.status).toBe(200);
    expect(((await health.json()) as { ok: boolean }).ok).toBe(true);
    expect((await handleRequest(new Request("http://h/nope"), store)).status).toBe(404);
  });
});

describe("hub url helpers", () => {
  test("normalizeBase strips trailing slashes and whitespace", () => {
    expect(normalizeBase("  https://a.example///  ")).toBe("https://a.example");
    expect(normalizeBase("https://a.example")).toBe("https://a.example");
  });
});

describe("push target detection", () => {
  test("URLs and host:port are endpoints, bare words are handles", () => {
    // Anything with a scheme is a literal URL. `--to http://anish` must not
    // be mistaken for a handle called "anish".
    expect(isAbsolutePushTarget("http://192.168.1.10:8788")).toBe(true);
    expect(isAbsolutePushTarget("https://x.trycloudflare.com")).toBe(true);
    expect(isAbsolutePushTarget("//host/path")).toBe(true);
    // Existing users paste these; both must keep working.
    expect(isAbsolutePushTarget("192.168.1.10:8788")).toBe(true);
    expect(isAbsolutePushTarget("mybox.lan:8788/")).toBe(true);
    expect(isAbsolutePushTarget("10.0.0.5")).toBe(true);
    // Bare names go to the hub.
    expect(isAbsolutePushTarget("anish")).toBe(false);
    expect(isAbsolutePushTarget("K7M")).toBe(false);
    expect(isAbsolutePushTarget("  bob  ")).toBe(false);
  });
});

describe("short codes", () => {
  test("are 3 unambiguous characters", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateShortCode();
      expect(c).toHaveLength(3);
      // No look-alikes: 0/O and 1/I/l are excluded so a code read aloud is
      // never ambiguous.
      expect(c).not.toMatch(/[01OIl]/);
    }
  });

  test("vary between calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateShortCode());
    // Collisions are fine at this size, but the generator must not be stuck.
    expect(seen.size).toBeGreaterThan(150);
  });
});


