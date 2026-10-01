// share0 hub client.
//
// The hub maps a short name to the public tunnel URL of a machine that is
// currently listening. It never handles file bytes.
//
// Two key namespaces with different lifetimes:
//
//   h:<handle>  Durable. Refreshed on a heartbeat with a short TTL, so a
//               name you reuse every day keeps working while a receiver that
//               exited stops resolving (see ANNOUNCE_TTL / HEARTBEAT).
//   c:<code>    Ephemeral, no heartbeat. The sender-minted case.
//
// No auth, no accounts, no storage beyond a key/value store with TTLs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** How long a name survives without a refresh. A stopped receiver stops
 *  refreshing and its name disappears on its own, with no cleanup to run.
 *
 *  Three heartbeat intervals, so two consecutive missed beats are survivable
 *  before a live inbox is evicted. */
export const ANNOUNCE_TTL = 1800;

/** How often a receiver re-announces. Ten minutes costs 144 writes per
 *  receiver per day, which is what makes the Cloudflare free tier (1,000
 *  writes/day) workable: a 30s heartbeat needs 2,880 and blows through the
 *  budget in about eight hours. */
export const HEARTBEAT_INTERVAL = 600;

/** Stops a process from writing forever. At one heartbeat every 10 minutes,
 *  900 writes covers roughly six days, which is well past the point where the
 *  daily free-tier cap would have bitten anyway. */
export const MAX_HEARTBEAT_WRITES = 900;

export type HubKeyKind = "handle" | "code";

export interface AnnounceInput {
  /** Durable name (`h:` namespace) or short code (`c:` namespace). */
  name: string;
  /** Public base URL of the listening machine, e.g. https://x.trycloudflare.com */
  url: string;
  /** Human label shown to the sender, e.g. "anish (receive)". */
  label?: string;
  kind?: HubKeyKind;
  /** Override the TTL (seconds). Defaults to ANNOUNCE_TTL. */
  ttl?: number;
}

export interface Resolved {
  name: string;
  url: string;
  label?: string;
  kind: HubKeyKind;
}

export class HubError extends Error {}

function hubConfigPath(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "share0", "hub")
    : join(homedir(), ".config", "share0", "hub");
}

/** Resolve the hub base URL: $SHARE0_HUB wins, then the config file. */
export function hubUrl(): string | null {
  const env = process.env.SHARE0_HUB?.trim();
  if (env) return env.replace(/\/+$/, "");
  const p = hubConfigPath();
  try {
    if (!existsSync(p)) return null;
    const v = readFileSync(p, "utf8").trim();
    return v ? v.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

/** Persist the hub URL so the user configures it once. */
export function saveHubUrl(url: string): void {
  const p = hubConfigPath();
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, url.replace(/\/+$/, "") + "\n");
}

/** Strip a URL down to a base with no trailing slash. */
export function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/** True when a `--to` value is meant as a literal endpoint rather than a
 *  handle to look up. Anything with a scheme, or that looks like host:port,
 *  is a URL; a bare word is a handle. Keeping this explicit avoids sending to
 *  `http://anish` because someone typed a name. */
export function isAbsolutePushTarget(value: string): boolean {
  const v = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return true;
  if (v.startsWith("//")) return true;
  // host:port or a dotted host, e.g. 192.168.1.10:8788
  if (/^[\w.-]+:\d+(\/|$)/.test(v)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(v)) return true;
  return false;
}

function keyFor(name: string, kind: HubKeyKind): string {
  return `${kind === "handle" ? "h" : "c"}:${name}`;
}

/** Announce that `name` currently answers at `url`. Idempotent. */
export async function announce(base: string, input: AnnounceInput): Promise<void> {
  const kind = input.kind ?? "handle";
  const res = await fetch(`${normalizeBase(base)}/a`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key: keyFor(input.name, kind),
      url: normalizeBase(input.url),
      label: input.label,
      ttl: input.ttl ?? ANNOUNCE_TTL,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new HubError(
      `hub announce failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`
    );
  }
}

/** Look up a handle or code. Throws HubError when unknown/expired so callers
 *  can print an actionable message instead of a generic failure. */
export async function resolve(base: string, name: string, kind?: HubKeyKind): Promise<Resolved> {
  const order: HubKeyKind[] = kind ? [kind] : ["handle", "code"];
  for (const k of order) {
    const res = await fetch(`${normalizeBase(base)}/r/${encodeURIComponent(keyFor(name, k))}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new HubError(`hub lookup failed (${res.status})`);
    const body = (await res.json()) as Resolved;
    if (body?.url) return { ...body, kind: k };
  }
  throw new HubError(`"${name}" is not available right now.`);
}

/** Remove an announcement immediately (used on clean shutdown so a handle
 *  doesn't linger for the rest of its TTL). */
export async function retract(base: string, name: string, kind: HubKeyKind = "handle"): Promise<void> {
  try {
    await fetch(`${normalizeBase(base)}/a/${encodeURIComponent(keyFor(name, kind))}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    /* best effort; the TTL is the real guarantee */
  }
}

/** Check that a resolved inbox is actually answering.
 *
 *  The hub entry outlives a dead tunnel, since the receiver refreshes it every
 *  10 minutes and the entry lives for 30. Probing turns a stale name into a
 *  clear error instead of a push that hangs. Returns true on any 2xx, which
 *  covers both the upload page and /health. */
export async function inboxAnswers(url: string, timeoutMs = 8000): Promise<boolean> {
  const base = normalizeBase(url);
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Keep a name fresh until stopped. Returns a stop function.
 *
 *  Writes are capped per process: a tunnel that dies but leaves the loop
 *  running would otherwise keep announcing a dead URL and quietly eat the
 *  free-tier write budget. */
export function startHeartbeat(
  base: string,
  input: AnnounceInput,
  opts: { intervalMs?: number; maxWrites?: number; onError?: (e: Error) => void } = {}
): () => void {
  const interval = opts.intervalMs ?? HEARTBEAT_INTERVAL * 1000;
  const maxWrites = opts.maxWrites ?? MAX_HEARTBEAT_WRITES;
  let writes = 0;
  let stopped = false;

  const beat = async () => {
    if (stopped) return;
    if (writes >= maxWrites) {
      stopped = true;
      clearInterval(timer);
      opts.onError?.(
        new HubError(`heartbeat write cap reached (${maxWrites}) — handle expires in ~${ANNOUNCE_TTL}s`)
      );
      return;
    }
    writes += 1;
    try {
      await announce(base, input);
    } catch (e) {
      opts.onError?.(e as Error);
    }
  };

  const timer = setInterval(() => void beat(), interval);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

