import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { verifyPassword } from "@share/core";

// Phase 3 — receive mode: a device advertises an upload endpoint so another
// device can push files directly to it. Browser + CLI (`share send --to`) clients.

export interface ReceiveOptions {
  dir: string;
  passwordHash?: string;
  onReceive?: (filename: string, bytes: number) => void;
}

export function sanitizeFilename(raw: string): string | null {
  const name = basename(raw.trim());
  if (!name || name === "." || name === "..") return null;
  if (name.includes(sep) || /[<>:"|?*\x00-\x1f]/.test(name)) return null;
  const norm = normalize(name);
  if (norm !== name || norm.startsWith("..")) return null;
  return name;
}

async function checkAuth(passwordHash: string | undefined, req: Request): Promise<boolean> {
  if (!passwordHash) return true;
  const url = new URL(req.url);
  const candidate = req.headers.get("x-share-password") ?? url.searchParams.get("password") ?? "";
  if (!candidate) return false;
  return verifyPassword(candidate, passwordHash);
}

export function createReceiveHandler(opts: ReceiveOptions) {
  const dir = resolve(opts.dir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/health") return Response.json({ ok: true, mode: "receive" });

    if (req.method === "GET" && (path === "/" || path === "")) {
      return new Response(renderUploadPage(!!opts.passwordHash), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (!(await checkAuth(opts.passwordHash, req))) {
      return Response.json({ error: "Password required" }, { status: 401 });
    }

    if (req.method === "GET" && path === "/api/receive") {
      const files: Array<{ name: string; size: number }> = [];
      for (const name of await readdir(dir).catch(() => [] as string[])) {
        const s = await stat(join(dir, name)).catch(() => null);
        if (s?.isFile()) files.push({ name, size: s.size });
      }
      return Response.json({ dir, files, count: files.length });
    }

    // PUT /upload/:filename — raw body streamed straight to disk (no buffering).
    if ((req.method === "PUT" || req.method === "POST") && path.startsWith("/upload/")) {
      const raw = decodeURIComponent(path.slice("/upload/".length));
      const name = sanitizeFilename(raw);
      if (!name) return Response.json({ error: "Invalid filename" }, { status: 400 });
      const dest = join(dir, name);
      if (!dest.startsWith(dir + sep) && dest !== join(dir, name)) {
        return Response.json({ error: "Invalid filename" }, { status: 400 });
      }
      if (!req.body) return Response.json({ error: "Empty body" }, { status: 400 });
      let bytes = 0;
      try {
        const nodeStream = Readable.fromWeb(req.body as import("node:stream/web").ReadableStream);
        await new Promise<void>((resolveP, rejectP) => {
          const out = createWriteStream(dest + ".part");
          nodeStream.on("data", (c: Buffer) => (bytes += c.length));
          nodeStream.on("error", rejectP);
          out.on("error", rejectP);
          out.on("finish", () => resolveP());
          nodeStream.pipe(out);
        });
        const { renameSync } = await import("node:fs");
        renameSync(dest + ".part", dest);
      } catch (e) {
        return Response.json({ error: `Upload failed: ${(e as Error).message}` }, { status: 500 });
      }
      opts.onReceive?.(name, bytes);
      return Response.json({ ok: true, name, size: bytes }, { status: 201 });
    }

    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "PUT" && req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    return new Response("Not found", { status: 404 });
  };
}

/** Push local files to a receive endpoint (used by `share send --to <url>`). */
export async function pushFiles(
  endpoint: string,
  paths: string[],
  opts: { password?: string; onProgress?: (file: string, bytes: number) => void } = {}
): Promise<Array<{ name: string; size: number }>> {
  const base = endpoint.replace(/\/$/, "");
  const results: Array<{ name: string; size: number }> = [];
  for (const p of paths) {
    const st = await stat(p);
    if (!st.isFile()) throw new Error(`--to only supports files (got directory: ${p}). Zip it first with --zip, or share normally.`);
    const name = basename(p);
    const file = Bun.file(p);
    const res = await fetch(`${base}/upload/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(st.size),
        ...(opts.password ? { "x-share-password": opts.password } : {}),
      },
      body: file as unknown as BodyInit,
    });
    if (res.status === 401) throw new Error(`Receive endpoint rejected the password (401).`);
    if (!res.ok) throw new Error(`Upload of ${name} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { name: string; size: number };
    opts.onProgress?.(body.name, body.size);
    results.push(body);
  }
  return results;
}

function renderUploadPage(passwordRequired: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>share · receive</title>
<style>
:root { color-scheme: light dark; --bg: #0b0c0e; --card: #15181d; --fg: #f2f4f6; --muted: #9aa3ad; --accent: #34c77b; }
@media (prefers-color-scheme: light) { :root { --bg: #f4f5f7; --card: #ffffff; --fg: #14171a; --muted: #66707a; } }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, Inter, Roboto, sans-serif; background: var(--bg); color: var(--fg); min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.card { width: 100%; max-width: 430px; background: var(--card); border-radius: 20px; padding: 28px 24px; box-shadow: 0 12px 40px rgba(0,0,0,.25); text-align: center; }
.brand { font-size: 12px; letter-spacing: .35em; color: var(--muted); margin-bottom: 6px; }
h1 { font-size: 20px; margin: 6px 0 4px; }
.sub { color: var(--muted); font-size: 13px; margin-bottom: 16px; }
.drop { border: 2px dashed var(--muted); border-radius: 14px; padding: 26px 12px; cursor: pointer; }
.drop.over { border-color: var(--accent); }
.btn { display: block; width: 100%; padding: 14px; border-radius: 12px; border: 0; font-size: 17px; font-weight: 650; background: var(--accent); color: #fff; cursor: pointer; margin-top: 12px; }
input[type=password] { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid var(--muted); font-size: 16px; margin-top: 10px; background: transparent; color: inherit; }
ul { text-align: left; font-size: 13px; color: var(--muted); padding-left: 18px; }
.prog { font-size: 13px; color: var(--muted); min-height: 18px; margin-top: 10px; }
</style>
</head>
<body>
<main class="card">
  <div class="brand">SHARE</div>
  <h1>Send to this device</h1>
  <div class="sub">Files upload directly — nothing is stored anywhere else.</div>
  ${passwordRequired ? '<input id="pw" type="password" placeholder="Password" />' : ""}
  <label class="drop" id="drop">Tap to choose files<input id="pick" type="file" multiple hidden /></label>
  <div class="prog" id="prog"></div>
  <button class="btn" id="send" disabled>Upload</button>
  <ul id="done"></ul>
</main>
<script>
let files = [];
const pick = document.getElementById("pick"), drop = document.getElementById("drop"),
      send = document.getElementById("send"), prog = document.getElementById("prog"),
      done = document.getElementById("done");
const pw = () => (document.getElementById("pw") || {}).value || "";
drop.onclick = () => pick.click();
pick.onchange = () => { files = [...pick.files]; send.disabled = !files.length; prog.textContent = files.length ? files.length + " file(s) selected" : ""; };
["dragover","dragenter"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add("over"); }));
["dragleave","drop"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", ev => { files = [...ev.dataTransfer.files]; send.disabled = !files.length; prog.textContent = files.length + " file(s) selected"; });
send.onclick = async () => {
  send.disabled = true;
  for (const f of files) {
    prog.textContent = "Uploading " + f.name + "…";
    const r = await fetch("/upload/" + encodeURIComponent(f.name), {
      method: "PUT", body: f,
      headers: Object.assign({ "content-type": "application/octet-stream" }, pw() ? { "x-share-password": pw() } : {}),
    });
    const li = document.createElement("li");
    li.textContent = r.ok ? "✓ " + f.name : "✗ " + f.name + " (" + r.status + ")";
    done.append(li);
  }
  prog.textContent = "Done.";
  files = []; send.disabled = false;
};
</script>
</body>
</html>`;
}

