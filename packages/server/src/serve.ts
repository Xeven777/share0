import { createReadStream, existsSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, normalize, relative, resolve, sep } from "node:path";
import type { ShareSession } from "@share/core";
import { verifyPassword } from "@share/core";
import type { FileEntry, ShareMeta } from "@share/protocol";
import { renderReceiverPage } from "./web.ts";

export interface ServeContext {
  session: ShareSession;
  /** Absolute paths of shared roots (files or a single directory). */
  roots: string[];
  onDownload?: (bytes: number) => void;
  /** Phase 4 signaling hooks. File bytes never pass through here — SDP only. */
  webrtc?: {
    getOffer(): string | null;
    submitAnswer(sdp: string): Promise<void>;
  };
}

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".flac": "audio/flac",
  ".pdf": "application/pdf",
  ".txt": "text/plain", ".md": "text/markdown", ".json": "application/json",
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".zip": "application/zip",
};

export function mimeFor(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

export function isExpired(s: ShareSession): boolean {
  if (s.expiresAt && Date.now() > s.expiresAt) return true;
  if (s.maxDownloads != null && s.downloads >= s.maxDownloads) return true;
  return false;
}

async function collectFiles(roots: string[], session: ShareSession): Promise<{ entries: FileEntry[]; totalSize: number }> {
  // Pre-zipped single archive
  if (session.zip?.enabled && session.zip.path) {
    const st = statSync(session.zip.path);
    return {
      entries: [{ name: session.name, path: encodeURIComponent(session.name), size: st.size, mime: "application/zip" }],
      totalSize: st.size,
    };
  }
  const entries: FileEntry[] = [];
  let total = 0;
  for (const root of roots) {
    const st = await stat(root);
    if (st.isFile()) {
      entries.push({ name: basename(root), path: encodeURIComponent(basename(root)), size: st.size, mime: mimeFor(root) });
      total += st.size;
    } else {
      const walk = async (dir: string, base: string) => {
        for (const name of await readdir(dir)) {
          const full = join(dir, name);
          const rel = base ? `${base}/${name}` : name;
          const s = await stat(full);
          if (s.isDirectory()) await walk(full, rel);
          else {
            entries.push({ name, path: rel.split("/").map(encodeURIComponent).join("/"), size: s.size, mime: mimeFor(name) });
            total += s.size;
          }
        }
      };
      await walk(root, "");
    }
  }
  return { entries, totalSize: total };
}

/** Resolve a URL relative path against roots; returns absolute path or null (traversal → null). */
async function resolveFile(roots: string[], session: ShareSession, relEncoded: string): Promise<string | null> {
  if (session.zip?.enabled && session.zip.path) return session.zip.path;
  const rel = relEncoded.split("/").map(decodeURIComponent).join(sep);
  const norm = normalize(rel);
  if (norm.startsWith("..") || resolve(sep, norm) !== resolve(sep, norm)) return null;
  if (norm === "." || norm === "") return null;
  for (const root of roots) {
    const st = await stat(root).catch(() => null);
    if (!st) continue;
    const candidate = st.isFile()
      ? (basename(root) === norm || decodeURIComponent(relEncoded) === basename(root) ? root : null)
      : join(root, norm);
    if (!candidate) continue;
    // Containment check for directory roots
    if (st.isDirectory()) {
      const rel2 = relative(root, resolve(root, norm));
      if (rel2.startsWith("..") || resolve(root, norm) !== join(root, norm)) continue;
    }
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  // Single-file share: allow bare name fallback
  if (roots.length === 1 && statSync(roots[0]).isFile()) {
    const only = roots[0];
    if (basename(only) === decodeURIComponent(relEncoded) || entries_match(only, relEncoded)) return only;
    // Also allow /download/<anything> to serve the single file when only one file exists
    return only;
  }
  return null;
}

function entries_match(abs: string, relEncoded: string): boolean {
  return basename(abs) === relEncoded || basename(abs) === decodeURIComponent(relEncoded);
}

async function checkAuth(session: ShareSession, req: Request): Promise<boolean> {
  if (!session.password?.enabled) return true;
  const url = new URL(req.url);
  const viaQuery = url.searchParams.get("password") ?? "";
  const viaHeader = req.headers.get("x-share-password") ?? "";
  const candidate = viaHeader || viaQuery;
  if (!candidate) return false;
  return verifyPassword(candidate, session.password.hash);
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start = m[1] === "" ? NaN : parseInt(m[1], 10);
  let end = m[2] === "" ? NaN : parseInt(m[2], 10);
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) { start = size - end; end = size - 1; }
  if (Number.isNaN(end)) end = size - 1;
  if (start < 0) start = 0;
  if (end >= size) end = size - 1;
  if (start > end) return null;
  return { start, end };
}

export function createHandler(ctx: ServeContext) {
  const { session, roots } = ctx;

  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const isHead = req.method === "HEAD";

    // Health (no auth, no id needed)
    if (path === "/health") return Response.json({ ok: true, id: session.id });

    const prefix = `/s/${session.id}`;
    if (!path.startsWith(prefix) && path !== "/") {
      return new Response("Not found", { status: 404 });
    }
    const sub = path === "/" ? "/" : path.slice(prefix.length) || "/";

    // Receiver page
    if (sub === "/" || sub === "") {
      if (isExpired(session)) return new Response("Share expired", { status: 410 });
      return new Response(renderReceiverPage({ shareId: session.id, passwordRequired: !!session.password?.enabled }), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // All API/file routes require valid (non-expired) share; auth checked below
    if (isExpired(session)) {
      return Response.json({ error: "Share expired" }, { status: 410 });
    }
    if (!(await checkAuth(session, req))) {
      return Response.json({ error: "Password required" }, { status: 401 });
    }

    if (sub === "/api/share") {
      const { entries, totalSize } = await collectFiles(roots, session);
      const isDir = session.source.type === "directory" && !session.zip?.enabled;
      const meta: ShareMeta = {
        id: session.id,
        name: session.name,
        size: session.size ?? totalSize,
        mime: entries.length === 1 ? entries[0].mime : "application/octet-stream",
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        downloads: session.downloads,
        maxDownloads: session.maxDownloads,
        passwordRequired: !!session.password?.enabled,
        sha256: session.sha256,
        isDirectory: isDir || entries.length > 1,
      };
      return Response.json(meta);
    }

    if (sub === "/api/files") {
      const { entries } = await collectFiles(roots, session);
      return Response.json(entries);
    }

    // Phase 4 signaling: SDP offer/answer only — never file bytes.
    if (sub === "/api/webrtc-offer") {
      const offer = ctx.webrtc?.getOffer() ?? null;
      if (!offer) return Response.json({ error: "P2P not available for this share" }, { status: 501 });
      return Response.json({ offer });
    }

    if (sub === "/api/webrtc-answer" && req.method === "POST") {
      if (!ctx.webrtc) return Response.json({ error: "P2P not available for this share" }, { status: 501 });
      let answer = "";
      try {
        answer = ((await req.json()) as { answer?: string }).answer ?? "";
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      if (!answer) return Response.json({ error: "Missing answer SDP" }, { status: 400 });
      try {
        await ctx.webrtc.submitAnswer(answer);
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 400 });
      }
      return Response.json({ ok: true });
    }

    if (sub === "/download-all") {
      // Dynamic zip of the share (for multi-file/dir without --zip)
      const { entries } = await collectFiles(roots, session);
      if (entries.length <= 1 && !session.source.type.includes("directory")) {
        const f = await resolveFile(roots, session, entries[0]?.path ?? "");
        if (!f) return new Response("Not found", { status: 404 });
        return serveFile(req, f, session.name, "attachment", ctx);
      }
      return streamDynamicZip(req, roots, session.name, ctx);
    }

    const dlMatch = /^\/download\/(.+)$/.exec(sub);
    if (dlMatch) {
      const abs = await resolveFile(roots, session, dlMatch[1]);
      if (!abs) return new Response("Not found", { status: 404 });
      return serveFile(req, abs, basename(abs), "attachment", ctx);
    }

    const pvMatch = /^\/preview\/(.+)$/.exec(sub);
    if (pvMatch) {
      const abs = await resolveFile(roots, session, pvMatch[1]);
      if (!abs) return new Response("Not found", { status: 404 });
      return serveFile(req, abs, basename(abs), "inline", ctx);
    }

    return new Response("Not found", { status: 404 });
  };
}

async function serveFile(
  req: Request, absPath: string, filename: string,
  disposition: "attachment" | "inline", ctx: ServeContext
): Promise<Response> {
  const st = statSync(absPath);
  const size = st.size;
  const mime = mimeFor(absPath);
  const range = parseRange(req.headers.get("range"), size);

  const baseHeaders: Record<string, string> = {
    "accept-ranges": "bytes",
    "content-type": mime,
    "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
  };

  if (req.method === "HEAD") {
    return new Response(null, { headers: { ...baseHeaders, "content-length": String(size) } });
  }

  if (!range) {
    ctx.session.downloads += 1;
    ctx.onDownload?.(size);
    const file = Bun.file(absPath);
    return new Response(file, { headers: { ...baseHeaders, "content-length": String(size) } });
  }

  const { start, end } = range;
  const len = end - start + 1;
  ctx.session.downloads += 1;
  ctx.onDownload?.(len);
  const file = Bun.file(absPath).slice(start, end + 1);
  return new Response(file, {
    status: 206,
    headers: {
      ...baseHeaders,
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": String(len),
    },
  });
}

async function streamDynamicZip(req: Request, roots: string[], name: string, ctx: ServeContext): Promise<Response> {
  // Stream via system `zip -qr - <paths>` to stdout (no temp file, no full buffering).
  const proc = Bun.spawn(["zip", "-qr", "-", ...roots.flatMap((r) => [r])], {
    stdout: "pipe",
    stderr: "pipe",
  });
  ctx.session.downloads += 1;
  const filename = name.endsWith(".zip") ? name : `${name}.zip`;
  const stream = proc.stdout as unknown as ReadableStream;
  void proc.exited.then((code) => {
    if (code !== 0) console.error(`[share] dynamic zip exited with code ${code}`);
  });
  if (req.method === "HEAD") {
    try { proc.kill(); } catch { /* noop */ }
    return new Response(null, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  }
  return new Response(stream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

export async function startServer(ctx: ServeContext, port: number, hostname = "0.0.0.0") {
  const handler = createHandler(ctx);
  const server = Bun.serve({ port, hostname, fetch: handler });
  return server;
}
