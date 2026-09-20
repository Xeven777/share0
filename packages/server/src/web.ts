// Bundled receiver web app — single-file HTML, no build step.
// Ships inside the CLI; keep under ~40KB, system fonts, no external assets.
export function renderReceiverPage(opts: { shareId: string; passwordRequired: boolean }): string {
  const { shareId, passwordRequired } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0b0c0e" />
<title>share0 · ${escapeHtml(shareId)}</title>
<style>
:root { color-scheme: light dark; --bg: #0b0c0e; --bg2: radial-gradient(120% 90% at 50% 0%, #1a2233 0%, #0b0c0e 60%);
  --card: #14171d; --stroke: rgba(255,255,255,.09); --fg: #f2f4f6; --muted: #9aa3ad;
  --accent: #4f8cff; --accent2: #7aa5ff; --ok: #34d399; --danger: #ff6b6b; --radius: 20px; }
@media (prefers-color-scheme: light) { :root { --bg: #eef1f5; --bg2: radial-gradient(120% 90% at 50% 0%, #ffffff 0%, #eef1f5 65%);
  --card: #ffffff; --stroke: rgba(20,23,26,.09); --fg: #14171a; --muted: #66707a; } }
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, Roboto, "Segoe UI", sans-serif;
  background: var(--bg); background-image: var(--bg2); color: var(--fg);
  min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.wrap { width: 100%; max-width: 460px; }
.card { width: 100%; background: var(--card); border: 1px solid var(--stroke); border-radius: var(--radius);
  padding: 26px 22px 20px; box-shadow: 0 18px 60px rgba(0,0,0,.30); text-align: center; }
.brand { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 12px; letter-spacing: .32em;
  color: var(--muted); margin-bottom: 16px; font-weight: 700; }
.brand i { width: 10px; height: 10px; border-radius: 3px; background: linear-gradient(135deg, var(--accent), #a855f7);
  display: inline-block; box-shadow: 0 0 12px rgba(79,140,255,.7); }
.fileicon { width: 58px; height: 58px; margin: 2px auto 10px; border-radius: 16px; display: flex; align-items: center;
  justify-content: center; font-size: 28px; background: rgba(79,140,255,.12); border: 1px solid var(--stroke); }
.name { font-size: 20px; font-weight: 700; word-break: break-all; margin: 4px 0; letter-spacing: -.01em; }
.meta { color: var(--muted); font-size: 13px; margin-bottom: 6px; }
.pills { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin: 10px 0 4px; }
.pill { font-size: 11px; font-weight: 700; letter-spacing: .04em; padding: 5px 10px; border-radius: 999px;
  border: 1px solid var(--stroke); color: var(--muted); background: rgba(127,127,127,.10); }
.pill.live { color: var(--ok); border-color: rgba(52,211,153,.4); }
.btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 52px; padding: 14px;
  border-radius: 14px; border: 0; font-size: 17px; font-weight: 700; background: linear-gradient(180deg, var(--accent2), var(--accent));
  color: #fff; cursor: pointer; text-decoration: none; margin-top: 10px; box-shadow: 0 8px 24px rgba(79,140,255,.35); }
.btn:active { transform: scale(.99); }
.btn.secondary { background: transparent; border: 1px solid var(--muted); color: var(--fg); box-shadow: none; min-height: 48px; font-size: 15px; }
.btn.ghost { background: rgba(127,127,127,.12); box-shadow: none; min-height: 44px; font-size: 14px; color: var(--fg); }
.bar { height: 6px; border-radius: 999px; background: rgba(127,127,127,.2); overflow: hidden; margin-top: 10px; }
.bar > div { height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent), #a855f7); transition: width .2s; }
.preview { margin: 14px 0; border-radius: 14px; overflow: hidden; max-height: 46dvh; display: flex; align-items: center;
  justify-content: center; background: rgba(127,127,127,.12); border: 1px solid var(--stroke); }
.preview img, .preview video { max-width: 100%; max-height: 46dvh; display: block; }
.preview audio { width: 100%; }
.preview iframe, .preview pre { width: 100%; max-height: 46dvh; border: 0; text-align: left; }
pre { padding: 12px; font-size: 12px; overflow: auto; white-space: pre-wrap; margin: 0; }
.filelist { text-align: left; margin: 12px 0 4px; border-top: 1px solid var(--stroke); }
.filelist a { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 12px 4px;
  border-bottom: 1px solid var(--stroke); color: inherit; text-decoration: none; font-size: 14px; min-height: 48px; }
.filelist a span:last-child { color: var(--muted); white-space: nowrap; }
.filelist .fi { width: 30px; height: 30px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center;
  background: rgba(127,127,127,.14); font-size: 15px; flex: none; }
.pwrow { display: flex; gap: 8px; margin-top: 10px; }
input[type=password], input[type=text] { flex: 1; padding: 13px 12px; border-radius: 12px; border: 1px solid var(--muted);
  font-size: 16px; background: transparent; color: inherit; min-height: 48px; }
.err { color: var(--danger); font-size: 13px; min-height: 18px; margin-top: 6px; }
.prog { font-size: 12px; color: var(--muted); min-height: 16px; margin-top: 8px; }
.foot { margin-top: 14px; font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.hash { margin-top: 8px; font-size: 11px; color: var(--muted); word-break: break-all; }
.hint { margin-top: 12px; text-align: center; font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<div class="wrap">
<main class="card">
  <div class="brand"><i></i>SHARE0</div>
  <div id="gate" ${passwordRequired ? "" : 'hidden'}>
    <div class="fileicon">🔒</div>
    <div class="name">Password protected</div>
    <div class="meta">Ask the sender for the short code — e.g. 482-719.</div>
    <div class="pwrow">
      <input id="pw" type="password" inputmode="text" autocomplete="off" placeholder="e.g. 482-719" />
      <button class="btn ghost" id="togglePw" type="button" style="width:auto;padding:0 16px;">Show</button>
    </div>
    <button class="btn" id="unlock">Unlock</button>
    <div class="err" id="gate-err"></div>
  </div>
  <div id="app" ${passwordRequired ? "hidden" : ""}>
    <div class="fileicon" id="fileicon">📄</div>
    <div class="name" id="name">…</div>
    <div class="meta" id="meta">Loading…</div>
    <div class="pills"><span class="pill live" id="live">● live</span><span class="pill" id="expires">…</span></div>
    <div class="preview" id="preview" hidden></div>
    <div class="filelist" id="filelist" hidden></div>
    <a class="btn" id="download">↓ Download</a>
    <div class="bar" id="dlbar" hidden><div id="dlfill"></div></div>
    <a class="btn secondary" id="download-all" hidden>Get all as .zip</a>
    <a class="btn secondary" id="p2p" hidden>⚡ Try direct P2P</a>
    <button class="btn ghost" id="copyLink" type="button">Copy link</button>
    <div class="prog" id="p2p-status"></div>
    <div class="hash" id="hash"></div>
  </div>
  <div class="foot"><span id="foot-id">id ${escapeHtml(shareId)}</span><span>Sent directly · not uploaded</span></div>
</main>
<div class="hint">Open on any phone or laptop — no account, no app.</div>
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
function iconFor(mime, name) {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime === "application/pdf") return "📕";
  if (mime.includes("zip") || /\\.zip$/i.test(name || "")) return "🗜️";
  if (mime.startsWith("text/") || mime.includes("json") || mime.includes("markdown")) return "📝";
  return "📄";
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
  document.getElementById("meta").textContent = fmtBytes(meta.size) + (meta.isDirectory ? " · folder" : "");
  document.getElementById("fileicon").textContent = iconFor(meta.mime || "", meta.name);
  const dl = document.getElementById("download");
  dl.href = "/s/" + SHARE_ID + "/download/" + encodeURIComponent(meta.name) + q();
  dl.download = meta.name;
  if (meta.expiresAt) {
    const tick = () => {
      const ms = meta.expiresAt - Date.now();
      document.getElementById("expires").textContent = ms <= 0 ? "expired" : "expires in " + Math.max(1, Math.round(ms/60000)) + " min";
    };
    tick(); setInterval(tick, 15000);
  } else {
    document.getElementById("expires").textContent = "expires when sender stops";
  }
  if (meta.sha256) document.getElementById("hash").textContent = "sha256 " + meta.sha256.slice(0, 32) + "…";
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
        const icon = document.createElement("span"); icon.className = "fi"; icon.textContent = iconFor(f.mime || "", f.path);
        const l = document.createElement("span"); l.style.flex = "1"; l.textContent = decodeURIComponent(f.path);
        const r = document.createElement("span"); r.textContent = fmtBytes(f.size);
        a.append(icon, l, r); list.append(a);
      }
      const all = document.getElementById("download-all");
      all.hidden = false;
      all.href = "/s/" + SHARE_ID + "/download-all" + q();
      dl.textContent = files.length === 1 ? "↓ Download" : "↓ Download first file";
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
  document.getElementById("fileicon").textContent = iconFor(f.mime || "", f.name);
  if (f.mime.startsWith("image/")) {
    const img = document.createElement("img"); img.src = url; img.alt = f.name; img.loading = "lazy"; box.append(img);
  } else if (f.mime.startsWith("video/")) {
    const v = document.createElement("video"); v.src = url; v.controls = true; v.preload = "metadata"; v.playsInline = true; box.append(v);
  } else if (f.mime.startsWith("audio/")) {
    const a = document.createElement("audio"); a.src = url; a.controls = true; a.preload = "metadata"; box.append(a);
  } else if (f.mime === "application/pdf") {
    const fr = document.createElement("iframe"); fr.src = url; fr.style.height = "40dvh"; box.append(fr);
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
    document.getElementById("gate-err").textContent = e.code === 401 ? "Wrong password, try again." : e.message;
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
    btn.textContent = "Copied ✓";
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
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") p2pSetStatus("P2P failed — use Download above."); };
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
    p2pSetStatus("Signaling done — establishing direct connection…");
  } catch (e) {
    p2pSetStatus("P2P unavailable (" + e.message + ") — use Download above.");
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
