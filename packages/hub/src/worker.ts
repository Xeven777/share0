// share0 hub. Maps names to live tunnel URLs, nothing more.
//
// Three routes, no more:
//   PUT    /a             {key, url, label?, ttl?}   publish/refresh
//   GET    /r/:key                               resolve
//   DELETE /a/:key                               retract
//   GET    /health                               liveness
//
// Storage is Workers KV, where every key can carry its own TTL, so "expire on
// its own" is a storage feature rather than a cron job we have to maintain.
// The hub holds no file bytes and no accounts; a client that stops refreshing
// disappears within `ttl` seconds.
//
// Deliberately unauthenticated. See the README: this is a side project, and
// the value of adding a token here is low enough that the extra config is
// not worth the friction. Anyone can publish a handle; assume it.

export interface Env {
  /** KV namespace binding named SHARE0. Declared structurally so this file
   *  type-checks (and runs) without Cloudflare's ambient worker types; when
   *  deployed, the real binding satisfies this shape. */
  SHARE0: KvStore;
}

/** The slice of the KV API this hub actually uses. Narrowing it keeps the
 *  routing logic testable against a plain in-memory map. */
export interface KvStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Must match ANNOUNCE_TTL in ./index.ts (30 minutes). The client always sends
 *  an explicit ttl, so this only applies to hand-written requests. */
const DEFAULT_TTL = 1800;
const MAX_TTL = 86_400;
/** KV key size limit is 512 bytes; we keep ours far below it. */
const MAX_KEY_LEN = 128;
const MAX_URL_LEN = 512;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return handleRequest(req, env.SHARE0);
  },
};

/** The whole hub, as a function of a KV store. Exported so tests (and the
 *  self-hosted Bun variant) can run the real logic without Workers. */
export async function handleRequest(req: Request, store: KvStore): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "GET" && (path === "/health" || path === "/")) {
      return json({ ok: true, service: "share0-hub" });
    }

    // PUT /a. Publish or refresh a name.
    if (req.method === "PUT" && path === "/a") {
      let body: { key?: string; url?: string; label?: string; ttl?: number };
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid JSON" }, 400);
      }
      const key = String(body.key ?? "").trim();
      const target = String(body.url ?? "").trim();
      if (!key || !target) return json({ error: "key and url are required" }, 400);
      if (key.length > MAX_KEY_LEN) return json({ error: "key too long" }, 400);
      if (target.length > MAX_URL_LEN) return json({ error: "url too long" }, 400);
      // Only http(s): the resolved URL is fetched by the client, and a
      // file:// or javascript: target would be a foot-gun in a shared hub.
      let parsed: URL;
      try {
        parsed = new URL(target);
      } catch {
        return json({ error: "url is not a valid absolute URL" }, 400);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return json({ error: "url must be http(s)" }, 400);
      }
      // Strip the trailing slash URL.toString() adds for a bare origin: the
      // resolved base gets concatenated with paths by the client, and a
      // doubled slash would leak into those requests.
      const clean = parsed.toString().replace(/\/+$/, "");
      const requested = Number(body.ttl ?? DEFAULT_TTL);
      const ttl = Number.isFinite(requested)
        ? Math.min(Math.max(Math.round(requested), 1), MAX_TTL)
        : DEFAULT_TTL;
      await store.put(
        key,
        JSON.stringify({ url: clean, label: body.label, at: Date.now() }),
        { expirationTtl: ttl }
      );
      return json({ ok: true, key, ttl });
    }

    // GET /r/:key. Resolve a name to its current URL.
    if (req.method === "GET" && path.startsWith("/r/")) {
      const key = decodeURIComponent(path.slice(3));
      const raw = await store.get(key);
      let rec: { url?: string; label?: string; at?: number } | null = null;
      if (typeof raw === "string") {
        try { rec = JSON.parse(raw); } catch { rec = null; }
      } else if (raw && typeof raw === "object") {
        rec = raw as { url?: string; label?: string; at?: number };
      }
      if (!rec?.url) return json({ error: "not found" }, 404);
      return json({
        name: key.includes(":") ? key.slice(key.indexOf(":") + 1) : key,
        key,
        url: rec.url,
        label: rec.label,
        kind: key.startsWith("c:") ? "code" : "handle",
      });
    }

    // DELETE /a/:key. Retract immediately.
    if (req.method === "DELETE" && path.startsWith("/a/")) {
      await store.delete(decodeURIComponent(path.slice(3)));
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
}
