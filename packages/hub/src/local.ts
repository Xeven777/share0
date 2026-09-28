import { handleRequest, type KvStore } from "./worker.ts";

// Self-hosted hub: the same routing logic as the Worker, over an in-memory
// map with lazy TTL expiry. Two uses:
//   - `share0 hub` for anyone who'd rather not depend on Cloudflare
//   - the test suite, which needs a hub with no external dependency
//
// In-memory means a restart clears every handle. For a rendezvous that is
// acceptable (clients re-announce every 10 minutes) but it is the reason
// this is the "try it" option and not the default.

interface Entry {
  value: string;
  expiresAt: number;
}

export class MemoryStore implements KvStore {
  private map = new Map<string, Entry>();

  async get(key: string): Promise<unknown> {
    const e = this.map.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return e.value;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    const ttl = opts?.expirationTtl ?? 120;
    this.map.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  /** Live key count, expired entries pruned. Used by the status line. */
  get size(): number {
    const now = Date.now();
    for (const [k, e] of this.map) if (now > e.expiresAt) this.map.delete(k);
    return this.map.size;
  }
}

export interface ServeOptions {
  port?: number;
  hostname?: string;
}

export interface HubServer {
  port: number;
  url: string;
  store: MemoryStore;
  stop(): void;
}

/** Start a hub on this machine. Used by `share0 hub` and by tests. */
export function serveHub(opts: ServeOptions = {}): HubServer {
  const store = new MemoryStore();
  let port = opts.port ?? 8790;
  let server: ReturnType<typeof Bun.serve> | null = null;
  for (let i = 0; i < 20 && !server; i++) {
    try {
      server = Bun.serve({
        port,
        hostname: opts.hostname ?? "127.0.0.1",
        fetch: (req: Request) => handleRequest(req, store),
      });
    } catch (e) {
      if ((e as { code?: string }).code === "EADDRINUSE") port += 1;
      else throw e;
    }
  }
  if (!server) throw new Error("No free port found for the hub");
  const actualPort = server.port ?? port;
  return {
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    store,
    stop: () => server!.stop(),
  };
}
