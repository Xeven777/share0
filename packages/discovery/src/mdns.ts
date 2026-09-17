import { hostname } from "node:os";

// mDNS / Bonjour device + share discovery (Phase 3).
// Uses bonjour-service when installed; every entry point degrades gracefully.

export const SHARE_SERVICE = "share";
export const RECEIVE_SERVICE = "share-recv";

export interface NearbyNode {
  kind: "share" | "receive";
  id: string;
  name: string;
  host: string;
  port: number;
  device: string;
}

interface BonjourLike {
  publish(opts: Record<string, unknown>): { stop(): void };
  find(opts: Record<string, unknown>, onUp?: (s: unknown) => void): { stop(): void; services: unknown[] };
  destroy(): void;
}

async function loadBonjour(): Promise<BonjourLike | null> {
  try {
    const mod = (await import("bonjour-service")) as Record<string, unknown>;
    const Ctor =
      (mod.Bonjour as new () => BonjourLike) ??
      (mod.default as new () => BonjourLike) ??
      (mod as unknown as new () => BonjourLike);
    if (typeof Ctor !== "function") return null;
    return new Ctor();
  } catch {
    return null;
  }
}

export function mdnsAvailable(): Promise<boolean> {
  return loadBonjour().then((b) => {
    if (!b) return false;
    try { b.destroy(); } catch { /* noop */ }
    return true;
  });
}

/** Advertise a share/receive endpoint. Resolves to a stop function. No-op (null-safe) if mDNS unavailable. */
export async function advertise(opts: {
  kind: "share" | "receive";
  id: string;
  name: string;
  port: number;
}): Promise<() => void> {
  const b = await loadBonjour();
  if (!b) return () => {};
  const type = opts.kind === "share" ? SHARE_SERVICE : RECEIVE_SERVICE;
  const svc = b.publish({
    name: `${opts.kind === "share" ? "share" : "receive"} ${opts.id} on ${hostname()}`,
    type,
    port: opts.port,
    txt: { id: opts.id, name: opts.name, v: "1", device: hostname() },
  });
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    try { svc.stop(); } catch { /* noop */ }
    try { b.destroy(); } catch { /* noop */ }
  };
}

interface FoundService {
  name?: string;
  host?: string;
  port?: number;
  txt?: Record<string, string>;
  addresses?: string[];
}

/** Browse for nearby shares/receivers for `timeoutMs`. */
export async function browse(timeoutMs = 4000, kinds: Array<"share" | "receive"> = ["share", "receive"]): Promise<NearbyNode[]> {
  const b = await loadBonjour();
  if (!b) return [];
  const out = new Map<string, NearbyNode>();
  const browsers: Array<{ stop(): void }> = [];
  const collect = (kind: "share" | "receive") => (s: unknown) => {
    const svc = s as FoundService;
    const id = svc.txt?.id ?? svc.name ?? "unknown";
    const key = `${kind}:${id}:${svc.port}`;
    if (out.has(key)) return;
    out.set(key, {
      kind,
      id,
      name: svc.txt?.name ?? svc.name ?? "share",
      host: svc.host ?? svc.addresses?.[0] ?? "",
      port: svc.port ?? 0,
      device: svc.txt?.device ?? "",
    });
  };
  try {
    for (const kind of kinds) {
      const type = kind === "share" ? SHARE_SERVICE : RECEIVE_SERVICE;
      browsers.push(b.find({ type }, collect(kind)));
    }
    await new Promise((r) => setTimeout(r, timeoutMs));
  } finally {
    for (const br of browsers) {
      try { br.stop(); } catch { /* noop */ }
    }
    try { b.destroy(); } catch { /* noop */ }
  }
  return [...out.values()];
}
