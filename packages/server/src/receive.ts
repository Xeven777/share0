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
        const nodeStream = Readable.fromWeb(req.body as unknown as import("node:stream/web").ReadableStream);
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
<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0A0A0A" media="(prefers-color-scheme: dark)" />
<title>Share0 · Receive</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
:root {
  color-scheme: light dark;
  --canvas: #FFFFFF;
  --ink: #000000;
  --ink-2: rgb(0 0 0 / 64%);
  --ink-3: rgb(0 0 0 / 56%);
  --line: rgb(0 0 0 / 10%);
  --line-strong: rgb(0 0 0 / 18%);
  --wash: rgb(0 0 0 / 4%);
  --hover: rgb(0 0 0 / 5%);
  --pressed: rgb(0 0 0 / 9%);
  --danger: #B42318;
  --ok: #067647;
  --radius: 12px;
  --radius-sm: 10px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --canvas: #0A0A0A;
    --ink: #FFFFFF;
    --ink-2: rgb(255 255 255 / 56%);
    --ink-3: rgb(255 255 255 / 46%);
    --line: rgb(255 255 255 / 12%);
    --line-strong: rgb(255 255 255 / 24%);
    --wash: rgb(255 255 255 / 5%);
    --hover: rgb(255 255 255 / 9%);
    --pressed: rgb(255 255 255 / 14%);
    --danger: #FDA29B;
    --ok: #6CE9A6;
  }
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body {
  margin: 0;
  font-family: "Inter Tight", Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, sans-serif;
  background: var(--canvas); color: var(--ink);
  min-height: 100dvh; display: flex; justify-content: center; align-items: flex-start;
  padding: 40px 24px; font-size: 16px; line-height: 1.6;
}
.wrap { width: 100%; max-width: 520px; margin: 0 auto; }
.card { width: 100%; background: var(--canvas); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; text-align: left; }
.brand { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--ink-2); margin: 0 0 20px; }
.brand i { width: 8px; height: 8px; border-radius: 2px; background: var(--ink); display: inline-block; }
h1 { font-size: 22px; font-weight: 600; line-height: 1.2; letter-spacing: -0.01em; margin: 0; }
.sub { color: var(--ink-2); font-size: 14px; line-height: 1.5; margin: 4px 0 0; }
.drop {
  display: block; margin-top: 16px; padding: 20px 16px; cursor: pointer;
  border: 1px dashed var(--line-strong); border-radius: var(--radius-sm);
  font-size: 14px; line-height: 1.5; color: var(--ink);
  transition: background-color 160ms ease, border-color 160ms ease;
}
.drop small { display: block; margin-top: 4px; font-size: 13px; color: var(--ink-2); }
.drop.over { border-color: var(--ink); background: var(--hover); }
.drop:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.btn {
  display: flex; align-items: center; justify-content: center;
  width: 100%; min-height: 50px; padding: 12px 16px; margin-top: 12px;
  border-radius: var(--radius-sm); border: 1px solid var(--ink);
  background: var(--ink); color: var(--canvas);
  font-family: inherit; font-size: 15px; font-weight: 500; line-height: 1.5;
  cursor: pointer; transition: background-color 160ms ease, border-color 160ms ease;
}
.btn:disabled { background: var(--wash); border-color: var(--line); color: var(--ink-3); cursor: not-allowed; }
.btn:not(:disabled):active { background: var(--pressed); }
.btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
input[type=password] {
  width: 100%; padding: 12px; border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong); font-family: inherit; font-size: 16px; line-height: 1.5;
  margin-top: 16px; min-height: 50px; background: transparent; color: inherit;
}
input[type=password]::placeholder { color: var(--ink-3); }
input[type=password]:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
ul { margin: 12px 0 0; padding: 0; list-style: none; border-top: 1px solid var(--line); font-size: 14px; }
li { padding: 10px 0; border-bottom: 1px solid var(--line); color: var(--ink-2); }
li.bad { color: var(--danger); }
.prog { font-size: 13px; color: var(--ink-2); min-height: 20px; margin-top: 8px; }
.foot { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); font-size: 12px; color: var(--ink-2); }
@media (hover: hover) and (pointer: fine) {
  .btn:not(:disabled):hover { background: var(--hover); color: var(--ink); border-color: var(--ink); }
  .drop:hover { background: var(--hover); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
@media (max-width: 480px) {
  body { padding: 24px 16px; }
  .card { padding: 20px 16px; }
  h1 { font-size: 20px; }
}
</style>
</head>
<body>
<div class="wrap">
<main class="card">
  <div class="brand"><i aria-hidden="true"></i>Share0</div>
  <h1>Send to this device</h1>
  <p class="sub">Files upload directly. Nothing is stored anywhere else.</p>
  ${passwordRequired ? '<input id="pw" type="password" placeholder="Password" aria-label="Receive password" />' : ""}
  <label class="drop" id="drop" tabindex="0">Choose files<input id="pick" type="file" multiple hidden /><small>Tap to browse, or drag files here.</small></label>
  <div class="prog" id="prog" aria-live="polite"></div>
  <button class="btn" id="send" disabled>Upload</button>
  <ul id="done"></ul>
  <div class="foot">Uploads go straight to this device.</div>
</main>
</div>
<script>
let files = [];
const pick = document.getElementById("pick"), drop = document.getElementById("drop"),
      send = document.getElementById("send"), prog = document.getElementById("prog"),
      done = document.getElementById("done");
const pw = () => (document.getElementById("pw") || {}).value || "";
drop.onclick = (e) => { if (e.target !== pick) pick.click(); };
drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick.click(); } };
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
    li.textContent = r.ok ? "Uploaded — " + f.name : "Failed — " + f.name + " (" + r.status + ")";
    if (!r.ok) li.className = "bad";
    done.append(li);
  }
  prog.textContent = "Done.";
  files = []; send.disabled = false;
};
</script>
</body>
</html>`;
}

