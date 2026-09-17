import { existsSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  formatBytes,
  generateShortPassword,
  hashPassword,
  nanoid,
  parseExpires,
  randomToken,
  sha256FileHead,
  type ShareSession,
} from "@share/core";
import { addRecord } from "@share/core/store";
import { createZip } from "@share/archive";
import { startServer } from "@share/server";
import { selectTransports } from "@share/transport";

export interface SendFlags {
  port?: number;
  expires?: string;
  downloads?: number;
  password?: string | boolean;
  zip?: boolean;
  public?: boolean;
  tunnel?: string;
  /** Push files to a receive endpoint instead of hosting (Phase 3). */
  to?: string;
  /** Request a temporary UPnP/NAT-PMP mapping (Phase 3). Implied by --public. */
  upnp?: boolean;
  /** Disable the automatic WebRTC P2P offer (Phase 4, on by default). */
  noP2p?: boolean;
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) total += await dirSize(full);
    else total += s.size;
  }
  return total;
}

export async function runSend(pathsIn: string[] | string, flags: SendFlags): Promise<void> {
  const paths = Array.isArray(pathsIn) ? pathsIn : [pathsIn];
  if (!paths.length) {
    console.error("Usage: share0 send <file|dir> [more...] [options]");
    process.exit(1);
  }

  // Phase 3 push mode: deliver straight into someone's `share0 receive`.
  if (flags.to) {
    const { pushFiles } = await import("@share/server");
    let endpoint = flags.to.trim();
    if (!/^https?:\/\//i.test(endpoint)) endpoint = `http://${endpoint}`;
    const pw = typeof flags.password === "string" ? flags.password : undefined;
    console.log(`Pushing ${paths.length} file(s) to ${endpoint}…`);
    const done = await pushFiles(endpoint, paths.map((p) => resolve(p)), {
      password: pw,
      onProgress: (f, b) => console.log(`  ✓ ${f} (${formatBytes(b)})`),
    });
    console.log(`Delivered ${done.length} file(s).`);
    return;
  }
  const abs = paths.map((p) => resolve(p));
  for (const p of abs) {
    if (!existsSync(p)) {
      console.error(`No such file or directory: ${p}`);
      process.exit(1);
    }
  }

  const multi = abs.length > 1;
  const firstStat = statSync(abs[0]);
  const isDir = abs.length === 1 && firstStat.isDirectory();

  // --- size ---
  let size = 0;
  for (const p of abs) {
    const s = statSync(p);
    size += s.isDirectory() ? await dirSize(p) : s.size;
  }

  // --- password ---
  let passwordRaw: string | undefined;
  let passwordHash: string | undefined;
  let zipPassword: string | undefined;
  if (flags.password === true) {
    passwordRaw = generateShortPassword();
    passwordHash = await hashPassword(passwordRaw);
  } else if (typeof flags.password === "string" && flags.password.length > 0) {
    passwordRaw = flags.password;
    passwordHash = await hashPassword(passwordRaw);
  }
  if (flags.zip && passwordRaw) zipPassword = passwordRaw;
  if (flags.zip && flags.password === true && !zipPassword) {
    zipPassword = passwordRaw;
  }

  // --- zip ---
  let zipPath: string | undefined;
  let serveName: string;
  let source: ShareSession["source"];
  if (flags.zip) {
    const id = nanoid(4);
    const base = multi ? "share" : basename(abs[0]);
    serveName = base.endsWith(".zip") ? base : `${base}.zip`;
    zipPath = join(tmpdir(), `share-${id}.zip`);
    console.log(`Creating archive ${serveName}…`);
    await createZip(abs, zipPath, zipPassword);
    size = statSync(zipPath).size;
    source = { type: "file", path: zipPath };
  } else if (!multi && !isDir) {
    serveName = basename(abs[0]);
    source = { type: "file", path: abs[0] };
  } else if (!multi && isDir) {
    serveName = basename(abs[0]) + "/";
    source = { type: "directory", path: abs[0] };
  } else {
    serveName = `${abs.length} files`;
    // multi-file without --zip: serve each root; browser lists them
    source = { type: "directory", path: resolve(".") };
    // roots override below — store all abs paths via zip.path hack? No: use roots directly.
  }

  const id = nanoid(4);
  const session: ShareSession = {
    id,
    token: randomToken(),
    source,
    name: serveName,
    size,
    createdAt: Date.now(),
    expiresAt: flags.expires ? Date.now() + parseExpires(flags.expires) : undefined,
    downloads: 0,
    maxDownloads: flags.downloads,
    password: passwordHash ? { enabled: true, hash: passwordHash } : undefined,
    zip: flags.zip && zipPath ? { enabled: true, path: zipPath } : undefined,
  };
  if (!flags.zip && !multi && !isDir) {
    try { session.sha256 = await sha256FileHead(abs[0]); } catch { /* noop */ }
  }

  const roots = flags.zip ? [] : multi ? abs : abs;

  // --- port ---
  let port = flags.port ?? 8787;
  const { getOffer, submitAnswer, closePeer, weriftAvailable } = await import("@share/transport");
  const p2pEnabled = !flags.noP2p && (await weriftAvailable());
  const server = await listenWithFallback(session, roots, port, {
    getOffer: () => getOffer(id),
    submitAnswer: (sdp: string) => submitAnswer(id, sdp),
  });
  port = server.port;

  // --- transports (LAN → IPv6 → UPnP → WebRTC → tunnel) ---
  console.log("\nPreparing share…\n");
  console.log(`  File       ${serveName}`);
  console.log(`  Size       ${formatBytes(size)}`);
  console.log("\nConnectivity\n");
  const sel = await selectTransports(
    port,
    {
      sizeBytes: size,
      public: !!flags.public,
      preferredTunnel: flags.tunnel,
      upnp: !!(flags.upnp || flags.public),
      p2p: p2pEnabled
        ? {
            sessionId: id,
            getFiles: () => p2pFiles(session, roots),
            onEvent: (m) => console.log(`  [p2p] ${m}`),
          }
        : undefined,
    },
    (m) => console.log(m)
  );
  for (const n of sel.notes) console.log(`  · ${n}`);

  // Host firewall blocks phone→laptop LAN traffic while loopback still works
  // (the classic "opens on laptop, nothing on phone"). Warn with the fix.
  try {
    const { detectBlockingFirewall, p2pUdpFix } = await import("@share/discovery");
    const fw = await detectBlockingFirewall(port);
    if (fw.active) {
      console.log(`\n⚠ Host firewall (${fw.tool}) is ACTIVE — phones on Wi-Fi CANNOT reach the LAN URL.`);
      console.log(`  Fix (one command, stays working for future shares):`);
      console.log(`    ${fw.fix}`);
      if (fw.tool) {
        console.log(`  For direct P2P (WebRTC/UDP) also allow:`);
        console.log(`    ${p2pUdpFix(fw.tool)}`);
      }
    }
  } catch { /* noop */ }

  const localUrl = sel.local[0]?.url ?? `http://127.0.0.1:${port}`;
  const shareUrl = (base: string) => `${base}/s/${id}/`;
  const primaryLocal = shareUrl(localUrl);

  console.log(`\nSelected transport: ${sel.public.length ? "tunnel (" + sel.public[0].label + ")" : "LAN"}`);
  console.log(`\nLocal URL\n  ${primaryLocal}`);
  for (const ep of sel.local.slice(1)) {
    // P2P endpoints already carry the full share URL.
    console.log(ep.kind === "p2p" ? `\nDirect P2P\n  ${ep.url}` : `  ${ep.url}/s/${id}/`);
  }
  if (sel.public.length) {
    console.log("\nPublic");
    for (const ep of sel.public) console.log(`  ${shareUrl(ep.url)}`);
    if (sel.public.some((ep) => /pinggy/i.test(ep.label))) {
      console.log("\nNote: free pinggy links show a one-time Pinggy caution page.");
      console.log("Tell the recipient to tap “Enter site” to reach your files.");
    }
  }
  if (passwordRaw) console.log(`\nPassword: ${passwordRaw}`);
  console.log(`\nDownloads: 0${session.maxDownloads ? ` / ${session.maxDownloads}` : ""}`);
  console.log(`Expires: ${session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "when stopped"}`);

  // QR
  try {
    const qr = await import("qrcode-terminal");
    console.log("\nQR");
    qr.default.generate(primaryLocal, { small: true });
  } catch {
    console.log("\n(QR unavailable — install qrcode-terminal)");
  }

  // Clipboard
  try {
    const { default: clipboardy } = await import("clipboardy");
    await clipboardy.write(primaryLocal);
    console.log("\nCopied local URL to clipboard.");
  } catch {
    console.log("\n(Clipboard copy unavailable.)");
  }

  // Registry for `share0 list` / `share0 stop`
  addRecord({
    id,
    name: serveName,
    size,
    url: primaryLocal,
    pid: process.pid,
    port,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    maxDownloads: session.maxDownloads,
    hasPassword: !!passwordHash,
  });

  // Phase 3: advertise on LAN via mDNS so `share0 discover` can find us.
  let stopAdvertise: (() => void) | null = null;
  try {
    const { advertise } = await import("@share/discovery");
    stopAdvertise = await advertise({ kind: "share", id, name: serveName, port });
  } catch { /* mDNS unavailable — LAN URL + QR still work */ }

  // Watch for network changes mid-share (user switches Wi-Fi/hotspot/VPN):
  // the server keeps running on 0.0.0.0, but printed URLs go stale.
  try {
    const { getLanInfo } = await import("@share/discovery");
    let lastIps = new Set(getLanInfo().ipv4);
    const watcher = setInterval(() => {
      const cur = new Set(getLanInfo().ipv4);
      const same = cur.size === lastIps.size && [...cur].every((ip) => lastIps.has(ip));
      if (!same) {
        console.log("\n⚠ Network changed. The share is still running — current addresses:");
        for (const ip of cur) console.log(`  http://${ip}:${port}/s/${id}/`);
        lastIps = cur;
      }
    }, 15000);
    watcher.unref?.();
  } catch { /* noop */ }

  console.log("\nPress Ctrl+C to stop.");

  const cleanup = async () => {
    console.log("\nStopping share…");
    for (const t of sel.opened) {
      try { await t.close(); } catch { /* noop */ }
    }
    try { await closePeer(id); } catch { /* noop */ }
    try { stopAdvertise?.(); } catch { /* noop */ }
    server.stop();
    try {
      const { removeRecord } = await import("@share/core/store");
      removeRecord(id);
    } catch { /* noop */ }
    if (zipPath) {
      try {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(zipPath);
      } catch { /* noop */ }
    }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Live download counter + expiry enforcement
  const timer = setInterval(() => {
    if (session.expiresAt && Date.now() > session.expiresAt) {
      console.log("\nShare expired.");
      clearInterval(timer);
      void cleanup();
    }
    if (session.maxDownloads != null && session.downloads >= session.maxDownloads) {
      console.log(`\nDownload limit reached (${session.downloads}).`);
      clearInterval(timer);
      void cleanup();
    }
  }, 1000);
  timer.unref?.();

  // Keep process alive
  await new Promise(() => {});
}

async function listenWithFallback(
  session: ShareSession,
  roots: string[],
  preferredPort: number,
  webrtc?: { getOffer(): string | null; submitAnswer(sdp: string): Promise<void> }
) {
  let port = preferredPort;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const srv = await startServer(
        {
          session,
          roots,
          webrtc,
          onDownload: () => {
            const max = session.maxDownloads ? ` / ${session.maxDownloads}` : "";
            console.log(`Download #${session.downloads}${max}`);
          },
        },
        port
      );
      return srv;
    } catch (e) {
      if ((e as { code?: string }).code === "EADDRINUSE") {
        port += 1;
        continue;
      }
      throw e;
    }
  }
  throw new Error("No free port found near " + preferredPort);
}

/** Flatten the share into a pumpable file list for the P2P DataChannel. */
async function p2pFiles(
  session: ShareSession,
  roots: string[]
): Promise<Array<{ name: string; path: string; size: number; mime: string }>> {
  const { mimeFor } = await import("@share/server");
  if (session.zip?.enabled && session.zip.path) {
    const s = statSync(session.zip.path);
    return [{ name: session.name, path: session.zip.path, size: s.size, mime: "application/zip" }];
  }
  const out: Array<{ name: string; path: string; size: number; mime: string }> = [];
  const walk = async (dir: string, base: string) => {
    for (const name of await readdir(dir)) {
      const full = join(dir, name);
      const rel = base ? `${base}/${name}` : name;
      const s = await stat(full);
      if (s.isDirectory()) await walk(full, rel);
      else out.push({ name: rel, path: full, size: s.size, mime: mimeFor(name) });
    }
  };
  for (const root of roots) {
    const s = statSync(root);
    if (s.isFile()) out.push({ name: basename(root), path: root, size: s.size, mime: mimeFor(root) });
    else await walk(root, "");
  }
  return out;
}
