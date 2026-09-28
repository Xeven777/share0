// share — core domain layer (no tunnel vendor imports allowed here).
// Pure types + helpers: sessions, passwords, formatting, estimates, hashing.

export interface ShareSession {
  id: string;
  token: string;
  source: { type: "file"; path: string } | { type: "directory"; path: string };
  /** Display name (file name or dir name or archive name). */
  name: string;
  size?: number;
  createdAt: number;
  expiresAt?: number;
  downloads: number;
  maxDownloads?: number;
  password?: { enabled: boolean; hash: string };
  zip?: { enabled: boolean; path: string };
  sha256?: string;
}

export interface ShareOptions {
  expiresMs?: number;
  maxDownloads?: number;
  password?: string; // raw password (will be hashed)
  zip?: boolean;
  zipPassword?: string;
}

const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function nanoid(size = 4): string {
  const buf = new Uint8Array(size);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

export function randomToken(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("hex");
}

// --- Human-readable short passwords: "482-719", "K7F2-X9" ---
const PW_DIGITS = "23456789";
const PW_ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ";

function pick(alphabet: string, n: number): string {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join("");
}

/** Generate a short, sayable password like "482-719" or "K7F2-X9". */
export function generateShortPassword(): string {
  if (Math.random() < 0.5) {
    return `${pick(PW_DIGITS, 3)}-${pick(PW_DIGITS, 3)}`;
  }
  return `${pick(PW_ALPHA + PW_DIGITS, 4)}-${pick(PW_ALPHA.slice(0, 8) + PW_DIGITS, 2)}`;
}

// --- Short handles: "K7M", for hub addresses (`share0 send f --to K7M`) ---

/** Unambiguous alphabet: no 0/O, no 1/I/l. A handle is read aloud and typed
 *  by a human, so the cost of a confusing character beats the extra entropy. */
const CODE_ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 30 symbols, no look-alikes

/** A 3-character handle. 30^3 = 27,000 addresses, which is plenty for a
 *  personal hub and short enough to say on a phone call. Callers that want
 *  something durable should pass a name instead (`receive --as anish`). */
export function generateShortCode(len = 3): string {
  return pick(CODE_ALPHA, len);
}

// --- Password hashing (scrypt via Bun.password or node:crypto fallback) ---
export async function hashPassword(password: string): Promise<string> {
  try {
    // Bun native (fast, argon2/scrypt depending on version)
    if (typeof Bun !== "undefined" && Bun.password?.hash) {
      return await Bun.password.hash(password);
    }
  } catch { /* fall through */ }
  const { scrypt, randomBytes } = await import("node:crypto");
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(`scrypt$${salt}$${(key as Buffer).toString("hex")}`);
    });
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    if (typeof Bun !== "undefined" && Bun.password?.verify) {
      return await Bun.password.verify(password, hash);
    }
  } catch { /* fall through */ }
  if (hash.startsWith("scrypt$")) {
    const { scrypt, timingSafeEqual } = await import("node:crypto");
    const [, salt, expected] = hash.split("$");
    return new Promise((resolve, reject) => {
      scrypt(password, salt, 64, (err, key) => {
        if (err) return reject(err);
        try {
          resolve(timingSafeEqual(Buffer.from((key as Buffer).toString("hex")), Buffer.from(expected)));
        } catch { resolve(false); }
      });
    });
  }
  return false;
}

// --- Formatting ---
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes;
  let u = -1;
  do { v /= 1024; u++; } while (v >= 1024 && u < units.length - 1);
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[u]}`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function parseExpires(input: string): number {
  const m = /^(\d+)\s*(s|sec|m|min|h|hour|d|day)s?$/i.exec(input.trim());
  if (!m) throw new Error(`Invalid --expires value "${input}". Use e.g. 30m, 2h, 90s, 1d.`);
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const mult = unit.startsWith("s") ? 1000 : unit.startsWith("m") ? 60_000 : unit.startsWith("h") ? 3_600_000 : 86_400_000;
  return n * mult;
}

/** Estimate transfer seconds at a given upstream bitrate. */
export function estimateSeconds(sizeBytes: number, upstreamMbps: number): number {
  if (sizeBytes <= 0 || upstreamMbps <= 0) return 0;
  return (sizeBytes * 8) / (upstreamMbps * 1_000_000);
}

export function estimateText(sizeBytes: number, upstreamMbps: number): string {
  const s = estimateSeconds(sizeBytes, upstreamMbps);
  if (s < 60) return `~${Math.ceil(s)}s`;
  const m = s / 60;
  if (m < 60) return `~${Math.round(m)} min`;
  return `~${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
}

// --- SHA-256 of file head (for metadata display; full-file hash streams separately) ---
export async function sha256FileHead(path: string, maxBytes = 4 * 1024 * 1024): Promise<string> {
  const f = Bun.file(path);
  const slice = f.slice(0, Math.min(f.size, maxBytes));
  const buf = await slice.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Buffer.from(digest).toString("hex");
}
