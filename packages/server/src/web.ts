export function renderReceiverPage(opts: { shareId: string; passwordRequired: boolean }): string {
  const { shareId, passwordRequired } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0A0A0A" media="(prefers-color-scheme: dark)" />
<title>Share0 · ${escapeHtml(shareId)}</title>
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
  --track: rgb(0 0 0 / 8%);
  --danger: #B42318;
  --ok: #067647;
  --radius: 12px;
  --radius-sm: 10px;
  --btn-hover: #262626;
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
    --track: rgb(255 255 255 / 12%);
    --danger: #FDA29B;
    --ok: #6CE9A6;
    --btn-hover: #E6E6E6;
  }
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  font-family: "Inter Tight", Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, "Segoe UI", sans-serif;
  background: var(--canvas);
  color: var(--ink);
  min-height: 100dvh;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 40px 24px;
  font-size: 16px;
  line-height: 1.6;
  letter-spacing: 0;
}
.wrap { width: 100%; max-width: 520px; margin: 0 auto; }
.card {
  width: 100%;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 24px;
  text-align: left;
}
.brand {
  display: flex; align-items: center; justify-content: flex-start; gap: 8px;
  font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--ink-2); margin: 0 0 20px;
}
.brand i { width: 8px; height: 8px; border-radius: 2px; background: var(--ink); display: inline-block; flex: none; }
.filehead { display: flex; gap: 12px; align-items: flex-start; }
.filebadge {
  width: 40px; height: 40px; border-radius: var(--radius-sm); flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 500; letter-spacing: .02em;
  color: var(--ink-2); background: var(--wash); border: 1px solid var(--line);
}
.filename { min-width: 0; flex: 1; }
.name { font-size: 22px; font-weight: 600; line-height: 1.2; letter-spacing: -0.01em; margin: 0; word-break: break-word; }
.meta { color: var(--ink-2); font-size: 14px; line-height: 1.5; margin: 4px 0 0; word-break: break-word; }
.status {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 16px 0 0; padding: 12px 0;
  border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
  font-size: 13px; line-height: 1.5; color: var(--ink-2);
}
.status .dot { width: 7px; height: 7px; border-radius: 999px; background: var(--ok); flex: none; }
.status .sep { color: var(--ink-3); }
.btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; min-height: 50px; padding: 12px 16px;
  border-radius: var(--radius-sm);
  font-family: inherit; font-size: 15px; font-weight: 500; line-height: 1.5;
  cursor: pointer; text-decoration: none; text-align: center;
  transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease;
}
.btn.primary { background: var(--ink); border: 1px solid var(--ink); color: var(--canvas); margin-top: 16px; }
.btn.secondary { background: transparent; border: 1px solid var(--line-strong); color: var(--ink); margin-top: 8px; }
.btn.quiet { background: var(--wash); border: 1px solid transparent; color: var(--ink); margin-top: 8px; min-height: 48px; font-size: 14px; }
.btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.bar { height: 4px; border-radius: 999px; background: var(--track); overflow: hidden; margin-top: 12px; }
.bar > div { height: 100%; width: 0%; background: var(--ink); transition: width .2s ease; }
.preview {
  margin: 16px 0 0; border-radius: var(--radius-sm); overflow: hidden;
  max-height: 46dvh; display: flex; align-items: center; justify-content: center;
  background: var(--wash); border: 1px solid var(--line);
}
.preview img, .preview video { max-width: 100%; max-height: 46dvh; display: block; }
.preview audio { width: 100%; }
.preview iframe, .preview pre { width: 100%; max-height: 46dvh; border: 0; text-align: left; }
pre { padding: 12px; font-size: 13px; line-height: 1.6; overflow: auto; white-space: pre-wrap; margin: 0; color: var(--ink); }
.filelist { margin: 8px 0 0; border-top: 1px solid var(--line); }
.filelist a {
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  padding: 12px 0; border-bottom: 1px solid var(--line);
  color: inherit; text-decoration: none; font-size: 14px; line-height: 1.5; min-height: 52px;
  border-radius: 4px;
}
.filelist a span:last-child { color: var(--ink-2); white-space: nowrap; }
.filelist .fi {
  width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
  background: var(--wash); border: 1px solid var(--line);
  font-size: 10px; font-weight: 500; color: var(--ink-2); flex: none;
}
.filelist .fname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gate-title { font-size: 22px; font-weight: 600; line-height: 1.2; letter-spacing: -0.01em; margin: 0; }
.gate-sub { color: var(--ink-2); font-size: 14px; line-height: 1.5; margin: 4px 0 0; }
.pwrow { display: flex; gap: 8px; margin-top: 16px; }
.pwrow input[type=password], .pwrow input[type=text] {
  flex: 1; min-width: 0; padding: 12px; border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  font-family: inherit; font-size: 16px; line-height: 1.5;
  background: transparent; color: inherit; min-height: 50px;
}
.pwrow input::placeholder { color: var(--ink-3); }
.pwrow input:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.pwrow .btn { width: auto; margin-top: 0; padding: 12px 16px; flex: none; }
.err { color: var(--danger); font-size: 13px; line-height: 1.5; min-height: 20px; margin-top: 8px; }
.prog { font-size: 13px; line-height: 1.5; color: var(--ink-2); min-height: 20px; margin-top: 8px; }
.foot {
  margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line);
  font-size: 12px; line-height: 1.5; color: var(--ink-2);
  display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  text-align: left;
}
.hash { margin-top: 8px; font-size: 12px; line-height: 1.5; color: var(--ink-2); word-break: break-all; text-align: left; }
.hint { margin-top: 16px; text-align: left; font-size: 13px; line-height: 1.5; color: var(--ink-2); }
@media (hover: hover) and (pointer: fine) {
  .btn.primary:hover { background: var(--btn-hover); border-color: var(--btn-hover); }
  .btn.secondary:hover { background: var(--hover); }
  .btn.quiet:hover { background: var(--hover); }
  .filelist a:hover { background: var(--hover); }
}
.btn.primary:active, .btn.secondary:active, .btn.quiet:active { background: var(--pressed); border-color: var(--line-strong); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
@media (max-width: 480px) {
  body { padding: 24px 16px; }
  .card { padding: 20px 16px; }
  .name, .gate-title { font-size: 20px; }
}
</style>
</head>
<body>
<div class="wrap">
<main class="card">
  <div class="brand"><i aria-hidden="true"></i>Share0</div>
  <div id="gate" ${passwordRequired ? "" : 'hidden'}>
    <h1 class="gate-title">Password protected</h1>
    <p class="gate-sub">Ask the sender for the short code.</p>
    <div class="pwrow">
      <input id="pw" type="password" inputmode="text" autocomplete="off" placeholder="Short code" aria-label="Share password" />
      <button class="btn quiet" id="togglePw" type="button">Show</button>
    </div>
    <button class="btn primary" id="unlock">Unlock</button>
    <div class="err" id="gate-err" role="alert"></div>
  </div>
  <div id="app" ${passwordRequired ? "hidden" : ""}>
    <div class="filehead">
      <span class="filebadge" id="fileicon" aria-hidden="true">File</span>
      <div class="filename">
        <h1 class="name" id="name">…</h1>
        <p class="meta" id="meta">Loading…</p>
      </div>
    </div>
    <div class="status"><span class="dot" aria-hidden="true"></span><span id="live">Live</span><span class="sep" aria-hidden="true">·</span><span id="expires">…</span></div>
    <div class="preview" id="preview" hidden></div>
    <div class="filelist" id="filelist" hidden></div>
    <a class="btn primary" id="download">Download</a>
    <div class="bar" id="dlbar" hidden><div id="dlfill"></div></div>
    <a class="btn secondary" id="download-all" hidden>Get all as .zip</a>
    <a class="btn secondary" id="p2p" hidden>Try direct P2P</a>
    <button class="btn quiet" id="copyLink" type="button">Copy link</button>
    <div class="prog" id="p2p-status" aria-live="polite"></div>
    <div class="hash" id="hash"></div>
  </div>
  <div class="foot"><span id="foot-id">ID ${escapeHtml(shareId)}</span><span>Sent directly · Not uploaded</span></div>
</main>
<div class="hint">Open on any phone or laptop. No account, no app.</div>
</div>
<script>
const SHARE_ID = ${JSON.stringify(shareId)};
let password = sessionStorage.getItem("share-pw-" + SHARE_ID) || "";
const q = () => (password ? "?password=" + encodeURIComponent(password) : "");
async function api(path) {
  const r = await fetch("/s/" + SHARE_ID + path + q(), { headers: password ? { "x-share-password": password } : {} });
  if (r.status === 401) throw Object.assign(new Error("bad password"), { code: 401 });
  if (r.status === 410) throw Object.assign(new Error("expired"), { code: 410 });
  if (!r.ok) throw new Error("request failed: " + r.status);
  return r.json();
}
function fmtBytes(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  const u = ["KB","MB","GB","TB"]; let v = n, i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + " " + u[i];
}
function labelFor(mime, name) {
  const base = (name || "").split("/").pop() || "";
  const ext = base.includes(".") ? base.split(".").pop().toUpperCase().slice(0, 4) : "";
  if (ext && /^[A-Z0-9]{2,4}$/.test(ext)) return ext;
  mime = mime || "";
  if (mime.startsWith("image/")) return "IMG";
  if (mime.startsWith("video/")) return "VID";
  if (mime.startsWith("audio/")) return "AUD";
  if (mime === "application/pdf") return "PDF";
  if (mime.includes("zip")) return "ZIP";
  if (mime.startsWith("text/") || mime.includes("json") || mime.includes("markdown")) return "TXT";
  return "File";
}
function showGate() {
  document.getElementById("gate").hidden = false;
  document.getElementById("app").hidden = true;
}
function showApp() {
  document.getElementById("gate").hidden = true;
  document.getElementById("app").hidden = false;
}
async function load() {
  const meta = await api("/api/share");
  document.getElementById("name").textContent = meta.name;
  document.getElementById("meta").textContent = fmtBytes(meta.size) + (meta.isDirectory ? " · Folder" : "");
  document.getElementById("fileicon").textContent = labelFor(meta.mime || "", meta.name);
  const dl = document.getElementById("download");
  dl.href = "/s/" + SHARE_ID + "/download/" + encodeURIComponent(meta.name) + q();
  dl.download = meta.name;
  if (meta.expiresAt) {
    const tick = () => {
      const ms = meta.expiresAt - Date.now();
      document.getElementById("expires").textContent = ms <= 0 ? "Expired" : "Expires in " + Math.max(1, Math.round(ms/60000)) + " min";
    };
    tick(); setInterval(tick, 15000);
  } else {
    document.getElementById("expires").textContent = "Expires when sender stops";
  }
  if (meta.sha256) document.getElementById("hash").textContent = "SHA-256 " + meta.sha256.slice(0, 32) + "…";
  try {
    const files = await api("/api/files");
    if (files.length > 1 || meta.isDirectory) {
      const list = document.getElementById("filelist");
      list.hidden = false;
      list.innerHTML = "";
      for (const f of files) {
        const a = document.createElement("a");
        a.href = "/s/" + SHARE_ID + "/download/" + f.path + q();
        a.download = decodeURIComponent(f.path).split("/").pop();
        const icon = document.createElement("span"); icon.className = "fi"; icon.setAttribute("aria-hidden", "true"); icon.textContent = labelFor(f.mime || "", f.path);
        const l = document.createElement("span"); l.className = "fname"; l.textContent = decodeURIComponent(f.path);
        const r = document.createElement("span"); r.textContent = fmtBytes(f.size);
        a.append(icon, l, r); list.append(a);
      }
      const all = document.getElementById("download-all");
      all.hidden = false;
      all.href = "/s/" + SHARE_ID + "/download-all" + q();
      dl.textContent = files.length === 1 ? "Download" : "Download first file";
      if (files.length > 1) dl.href = "/s/" + SHARE_ID + "/download/" + files[0].path + q();
    } else if (files.length === 1) {
      renderPreview(files[0]);
    }
  } catch (e) { /* single-file fallback below */ }
  p2pCheckOffer();
}
function renderPreview(f) {
  const box = document.getElementById("preview");
  const url = "/s/" + SHARE_ID + "/preview/" + f.path + q();
  box.hidden = false; box.innerHTML = "";
  document.getElementById("fileicon").textContent = labelFor(f.mime || "", f.name);
  if (f.mime.startsWith("image/")) {
    const img = document.createElement("img"); img.src = url; img.alt = f.name; img.loading = "lazy"; box.append(img);
  } else if (f.mime.startsWith("video/")) {
    const v = document.createElement("video"); v.src = url; v.controls = true; v.preload = "metadata"; v.playsInline = true; box.append(v);
  } else if (f.mime.startsWith("audio/")) {
    const a = document.createElement("audio"); a.src = url; a.controls = true; a.preload = "metadata"; box.append(a);
  } else if (f.mime === "application/pdf") {
    const fr = document.createElement("iframe"); fr.src = url; fr.title = f.name; fr.style.height = "40dvh"; box.append(fr);
  } else if (f.mime.startsWith("text/") || f.mime.includes("json") || f.mime.includes("markdown")) {
    fetch(url).then(r => r.text()).then(t => {
      const pre = document.createElement("pre"); pre.textContent = t.slice(0, 20000); box.append(pre);
    }).catch(() => { box.hidden = true; });
  } else { box.hidden = true; }
}
document.getElementById("togglePw").onclick = () => {
  const inp = document.getElementById("pw");
  const show = inp.type === "password";
  inp.type = show ? "text" : "password";
  document.getElementById("togglePw").textContent = show ? "Hide" : "Show";
  inp.focus();
};
document.getElementById("unlock").onclick = async () => {
  password = document.getElementById("pw").value.trim();
  try {
    await api("/api/share");
    sessionStorage.setItem("share-pw-" + SHARE_ID, password);
    showApp(); await load();
  } catch (e) {
    document.getElementById("gate-err").textContent = e.code === 401 ? "Wrong password. Try again." : e.message;
  }
};
document.getElementById("pw").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("unlock").click();
});
document.getElementById("copyLink").onclick = async (e) => {
  e.preventDefault();
  const btn = document.getElementById("copyLink");
  try {
    await navigator.clipboard.writeText(location.href);
    btn.textContent = "Copied";
  } catch {
    btn.textContent = "Copy failed — long-press the URL";
  }
  setTimeout(() => { btn.textContent = "Copy link"; }, 2000);
};
// Download with progress bar (falls back to plain navigation on failure).
document.getElementById("download").addEventListener("click", async (e) => {
  const a = e.currentTarget;
  if (a.dataset.direct === "1") return; // second click = plain download
  if (!a.href) return;
  e.preventDefault();
  const bar = document.getElementById("dlbar"), fill = document.getElementById("dlfill");
  try {
    bar.hidden = false; fill.style.width = "2%";
    const r = await fetch(a.href);
    if (!r.ok || !r.body) throw new Error("fetch failed");
    const total = Number(r.headers.get("content-length") || 0);
    const reader = r.body.getReader();
    const chunks = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (total) fill.style.width = Math.min(100, Math.round(100 * got / total)) + "%";
    }
    const blob = new Blob(chunks);
    const url = URL.createObjectURL(blob);
    const tmp = document.createElement("a");
    tmp.href = url; tmp.download = a.download || "download";
    document.body.append(tmp); tmp.click(); tmp.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    fill.style.width = "100%";
    setTimeout(() => { bar.hidden = true; }, 1500);
  } catch {
    a.dataset.direct = "1";
    location.href = a.href;
  }
});
// ---- Direct P2P via WebRTC DataChannel ----
const p2pBtn = document.getElementById("p2p"), p2pStatus = document.getElementById("p2p-status");
function p2pSetStatus(t) { p2pStatus.textContent = t; }
async function p2pCheckOffer() {
  try {
    const r = await fetch("/s/" + SHARE_ID + "/api/webrtc-offer" + q(), { headers: password ? { "x-share-password": password } : {} });
    if (r.ok) { p2pBtn.hidden = false; return true; }
  } catch (e) { /* P2P unavailable — HTTP download remains */ }
  return false;
}
p2pBtn.onclick = () => { p2pBtn.hidden = true; p2pStart(); };
async function p2pStart() {
  p2pSetStatus("Connecting peer-to-peer…");
  try {
    const offer = (await api("/api/webrtc-offer")).offer;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    let meta = null, chunks = [], received = 0;
    pc.ondatachannel = (ev) => {
      const ch = ev.channel;
      ch.binaryType = "arraybuffer";
      ch.onmessage = (m) => {
        if (typeof m.data === "string") {
          const msg = JSON.parse(m.data);
          if (msg.t === "meta") { meta = msg; chunks = []; received = 0; p2pSetStatus("Receiving " + msg.name + "…"); }
          else if (msg.t === "end" && meta) {
            const blob = new Blob(chunks, { type: "application/octet-stream" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob); a.download = meta.name; a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 60000);
            p2pSetStatus("Saved " + meta.name + " via P2P.");
            meta = null; chunks = [];
          }
          else if (msg.t === "bye") { p2pSetStatus("P2P transfer complete."); try { pc.close(); } catch (e) {} }
        } else {
          chunks.push(m.data); received += m.data.byteLength;
          if (meta && meta.size) p2pSetStatus("Receiving " + meta.name + "… " + Math.round(100 * received / meta.size) + "%");
        }
      };
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") p2pSetStatus("P2P failed. Use Download above."); };
    await pc.setRemoteDescription({ type: "offer", sdp: offer });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await new Promise((res) => {
      if (pc.iceGatheringState === "complete") return res();
      const t = setTimeout(res, 8000);
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } };
    });
    const post = await fetch("/s/" + SHARE_ID + "/api/webrtc-answer" + q(), {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, password ? { "x-share-password": password } : {}),
      body: JSON.stringify({ answer: pc.localDescription.sdp }),
    });
    if (!post.ok) throw new Error("signaling failed: " + post.status);
    p2pSetStatus("Signaling done. Establishing direct connection…");
  } catch (e) {
    p2pSetStatus("P2P unavailable (" + e.message + "). Use Download above.");
    p2pBtn.hidden = false;
  }
}
(async () => {
  try { await load(); }
  catch (e) {
    if (e.code === 401) { showGate(); }
    else document.getElementById("meta").textContent = e.code === 410 ? "This share has expired." : "Could not load share.";
  }
  if (!document.getElementById("app").hidden) {
    await p2pCheckOffer();
    if (new URLSearchParams(location.search).get("p2p") === "1") p2pStart();
  }
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
