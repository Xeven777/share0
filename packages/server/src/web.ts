// Bundled receiver web app (Phase 1: single-file HTML, no build step).
// A React+Vite version can live in apps/web/ later; this ships inside the CLI.
export function renderReceiverPage(opts: { shareId: string; passwordRequired: boolean }): string {
  const { shareId, passwordRequired } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>share · ${escapeHtml(shareId)}</title>
<style>
:root { color-scheme: light dark; --bg: #0b0c0e; --card: #15181d; --fg: #f2f4f6; --muted: #9aa3ad; --accent: #4f8cff; }
@media (prefers-color-scheme: light) { :root { --bg: #f4f5f7; --card: #ffffff; --fg: #14171a; --muted: #66707a; } }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, Roboto, sans-serif; background: var(--bg); color: var(--fg); min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.card { width: 100%; max-width: 430px; background: var(--card); border-radius: 20px; padding: 28px 24px; box-shadow: 0 12px 40px rgba(0,0,0,.25); text-align: center; }
.brand { font-size: 12px; letter-spacing: .35em; color: var(--muted); margin-bottom: 14px; }
.name { font-size: 20px; font-weight: 650; word-break: break-all; margin: 4px 0; }
.meta { color: var(--muted); font-size: 13px; margin-bottom: 18px; }
.btn { display: block; width: 100%; padding: 14px; border-radius: 12px; border: 0; font-size: 17px; font-weight: 650; background: var(--accent); color: #fff; cursor: pointer; text-decoration: none; margin-top: 10px; }
.btn.secondary { background: transparent; border: 1px solid var(--muted); color: var(--fg); }
.preview { margin: 14px 0; border-radius: 12px; overflow: hidden; max-height: 46dvh; display: flex; align-items: center; justify-content: center; background: rgba(127,127,127,.12); }
.preview img, .preview video { max-width: 100%; max-height: 46dvh; display: block; }
.preview audio { width: 100%; }
.preview iframe, .preview pre { width: 100%; max-height: 46dvh; border: 0; text-align: left; }
pre { padding: 12px; font-size: 12px; overflow: auto; white-space: pre-wrap; margin: 0; }
.filelist { text-align: left; margin: 12px 0; border-top: 1px solid rgba(127,127,127,.25); }
.filelist a { display: flex; justify-content: space-between; gap: 8px; padding: 10px 2px; border-bottom: 1px solid rgba(127,127,127,.25); color: inherit; text-decoration: none; font-size: 14px; }
.filelist a span:last-child { color: var(--muted); white-space: nowrap; }
input[type=password], input[type=text] { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid var(--muted); font-size: 16px; margin-top: 10px; background: transparent; color: inherit; }
.err { color: #ff6b6b; font-size: 13px; min-height: 18px; }
.prog { font-size: 12px; color: var(--muted); min-height: 16px; margin-top: 8px; }
.expires { margin-top: 14px; font-size: 12px; color: var(--muted); }
.hash { margin-top: 8px; font-size: 11px; color: var(--muted); word-break: break-all; }
</style>
</head>
<body>
<main class="card">
  <div class="brand">SHARE</div>
  <div id="gate" ${passwordRequired ? "" : 'hidden'}>
    <div class="name">Password protected</div>
    <div class="meta">Enter the password the sender gave you.</div>
    <input id="pw" type="password" inputmode="numeric" autocomplete="off" placeholder="e.g. 482-719" />
    <button class="btn" id="unlock">Unlock</button>
    <div class="err" id="gate-err"></div>
  </div>
  <div id="app" ${passwordRequired ? "hidden" : ""}>
    <div class="name" id="name">…</div>
    <div class="meta" id="meta">Loading…</div>
    <div class="preview" id="preview" hidden></div>
    <div class="filelist" id="filelist" hidden></div>
    <a class="btn" id="download">Download</a>
    <a class="btn secondary" id="download-all" hidden>Download all (.zip)</a>
    <a class="btn secondary" id="p2p" hidden>Try direct P2P</a>
    <div class="prog" id="p2p-status"></div>
    <div class="expires" id="expires"></div>
    <div class="hash" id="hash"></div>
  </div>
</main>
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
  document.getElementById("download").href = "/s/" + SHARE_ID + "/download/" + encodeURIComponent(meta.name) + q();
  if (meta.expiresAt) {
    const tick = () => {
      const ms = meta.expiresAt - Date.now();
      document.getElementById("expires").textContent = ms <= 0 ? "Expired" : "Expires in " + Math.max(1, Math.round(ms/60000)) + " min";
    };
    tick(); setInterval(tick, 15000);
  } else {
    document.getElementById("expires").textContent = "Expires when sender stops sharing.";
  }
  if (meta.sha256) document.getElementById("hash").textContent = "sha256 " + meta.sha256.slice(0, 32) + "…";
  // files + preview
  try {
    const files = await api("/api/files");
    if (files.length > 1 || meta.isDirectory) {
      const list = document.getElementById("filelist");
      list.hidden = false;
      list.innerHTML = "";
      for (const f of files) {
        const a = document.createElement("a");
        a.href = "/s/" + SHARE_ID + "/download/" + f.path + q();
        const l = document.createElement("span"); l.textContent = decodeURIComponent(f.path);
        const r = document.createElement("span"); r.textContent = fmtBytes(f.size);
        a.append(l, r); list.append(a);
      }
      const all = document.getElementById("download-all");
      all.hidden = false;
      all.href = "/s/" + SHARE_ID + "/download-all" + q();
      document.getElementById("download").textContent = files.length === 1 ? "Download" : "Download first file";
      if (files.length > 1) document.getElementById("download").href = "/s/" + SHARE_ID + "/download/" + files[0].path + q();
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
  if (f.mime.startsWith("image/")) {
    const img = document.createElement("img"); img.src = url; img.alt = f.name; box.append(img);
  } else if (f.mime.startsWith("video/")) {
    const v = document.createElement("video"); v.src = url; v.controls = true; v.preload = "metadata"; box.append(v);
  } else if (f.mime.startsWith("audio/")) {
    const a = document.createElement("audio"); a.src = url; a.controls = true; box.append(a);
  } else if (f.mime === "application/pdf") {
    const fr = document.createElement("iframe"); fr.src = url; fr.style.height = "40dvh"; box.append(fr);
  } else if (f.mime.startsWith("text/") || f.mime.includes("json") || f.mime.includes("markdown")) {
    fetch(url).then(r => r.text()).then(t => {
      const pre = document.createElement("pre"); pre.textContent = t.slice(0, 20000); box.append(pre);
    }).catch(() => { box.hidden = true; });
  } else { box.hidden = true; }
}
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
// ---- Direct P2P via WebRTC DataChannel (Phase 4) ----
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
