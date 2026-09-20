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
  qr?: string;
  noClipboard?: boolean;
  quiet?: boolean;
  json?: boolean;
  yes?: boolean;
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

  // --- interactive scope + tunnel picker (TTY only) ---
  const ui = await import("@share/ui");
  const interactive = ui.isInteractive({ yes: flags.yes, quiet: flags.quiet, json: flags.json });
  let wantPublic = !!flags.public;
  let tunnelOpt = flags.tunnel;
  const tunnelLower = tunnelOpt?.toLowerCase();
  if (tunnelOpt && tunnelLower !== "auto" && tunnelLower !== "ask") wantPublic = true;
  if (interactive && !wantPublic && !tunnelOpt && !flags.to) {
    wantPublic = await ui.confirm("Expose publicly via tunnel? (LAN-only otherwise)", false);
  }
  if (wantPublic && (!tunnelOpt || tunnelLower === "ask") && interactive) {
    const { allTunnelAdapters } = await import("@share/transport");
    const { fitsSession } = await import("@share/transfer");
    const { guessUpstreamMbps } = await import("@share/discovery");
    const upstream = guessUpstreamMbps();
    type Cand = { name: string; available: boolean; detail?: string; priority: number; caps?: unknown };
    const cands: Cand[] = [];
    for (const t of allTunnelAdapters) {
      try {
        const st = await t.detect();
        cands.push({
          name: t.name,
          available: st.available,
          detail: st.detail,
          priority: t.priority,
          caps: (t as unknown as { capabilities?: unknown }).capabilities,
        });
      } catch {
        cands.push({ name: t.name, available: false, detail: "detect failed", priority: t.priority });
      }
    }
    cands.sort((a, b) => a.priority - b.priority);
    const fitNote = (c: Cand): string => {
      if (!c.available) return c.detail ?? "unavailable";
      try {
        const fits = fitsSession(size, upstream, c.caps as never);
        return `${c.detail ?? "ready"} · ${fits ? "fits this file" : "may not fit long transfer"}`;
      } catch {
        return c.detail ?? "ready";
      }
    };
    const ready = cands.filter((c) => c.available);
    if (ready.length > 1) {
      const pick = await ui.select("Which tunnel provider?", [
        { value: "__auto__", label: "Auto (recommended)", hint: "pick fastest healthy" },
        ...cands.map((c) => ({
          value: c.name,
          label: `${c.available ? "✓ " : "✗ "}${c.name}`,
          hint: fitNote(c),
        })),
      ]);
      tunnelOpt = pick === "__auto__" ? undefined : pick;
    } else if (ready.length === 1) {
      console.log(`\n${ui.dim(`Only ${ready[0]!.name} is available — using it.`)}`);
      tunnelOpt = ready[0]!.name;
    } else {
      console.log(ui.warnLine("No tunnel provider available — sharing LAN-only."));
      wantPublic = false;
      tunnelOpt = undefined;
    }
  } else if (tunnelLower === "auto" || tunnelLower === "ask") {
    // Non-interactive --tunnel ask/auto both mean automatic selection.
    tunnelOpt = undefined;
  }
  const server = await listenWithFallback(session, roots, port, {
    getOffer: () => getOffer(id),
    submitAnswer: (sdp: string) => submitAnswer(id, sdp),
  });
  port = server.port ?? port;

  // --- transports (LAN → IPv6 → UPnP → WebRTC → tunnel) ---
  const quiet = !!flags.quiet;
  const jsonMode = !!flags.json;
  if (!quiet && !jsonMode) {
    console.log(ui.header());
    console.log(`  ${ui.bold("File")}  ${serveName}  ${ui.dim(formatBytes(size))}`);
  }
  const logFn = quiet || jsonMode ? () => {} : (m: string) => console.log(m);
  if (!quiet && !jsonMode) console.log(ui.sectionLabel("Connectivity"));
  let sel;
  try {
    sel = await selectTransports(
      port,
      {
        sizeBytes: size,
        public: wantPublic,
        preferredTunnel: tunnelOpt,
        upnp: !!(flags.upnp || wantPublic),
        p2p: p2pEnabled
          ? {
              sessionId: id,
              getFiles: () => p2pFiles(session, roots),
              onEvent: (m) => { if (!quiet && !jsonMode) console.log(`  [p2p] ${m}`); },
            }
          : undefined,
      },
      logFn
    );
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    try { server.stop(); } catch { /* noop */ }
    process.exit(1);
  }
  if (!quiet && !jsonMode) {
    for (const n of sel.notes) console.log(`  ${ui.dim("· " + n)}`);
  }

  // Host firewall blocks phone→laptop LAN traffic while loopback still works
  // (the classic "opens on laptop, nothing on phone"). Warn with the fix.
  try {
    const { detectBlockingFirewall, p2pUdpFix } = await import("@share/discovery");
    const fw = await detectBlockingFirewall(port);
    if (fw.active && !quiet && !jsonMode) {
      console.log(ui.warnLine(`Host firewall (${fw.tool}) is ACTIVE — phones on Wi-Fi CANNOT reach the LAN URL.`));
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
  const primaryPublic = sel.public.length ? shareUrl(sel.public[0]!.url) : undefined;
  const p2pUrl = sel.local.find((e) => e.kind === "p2p")?.url;

  if (jsonMode) {
    console.log(JSON.stringify({
      id, name: serveName, size,
      local: primaryLocal,
      extraLocal: sel.local.filter((e) => e.kind !== "p2p").slice(1).map((e) => `${e.url}/s/${id}/`),
      public: primaryPublic ?? null,
      p2p: p2pUrl ?? null,
      password: passwordRaw ?? null,
      expiresAt: session.expiresAt ?? null,
      maxDownloads: session.maxDownloads ?? null,
    }));
  } else if (quiet) {
    console.log(primaryLocal);
    if (primaryPublic) console.log(primaryPublic);
  } else {
    console.log(`\nSelected transport: ${sel.public.length ? "tunnel (" + sel.public[0]!.label + ")" : "LAN"}`);
    console.log(ui.sectionLabel("Local"));
    console.log(`  ${ui.cyan(primaryLocal)}`);
    for (const ep of sel.local.slice(1)) {
      // P2P endpoints already carry the full share URL.
      if (ep.kind === "p2p") console.log(ui.sectionLabel("Direct P2P"), `\n  ${ui.cyan(ep.url)}`);
      else console.log(`  ${ui.dim(`${ep.url}/s/${id}/`)}  ${ui.dim(`(${ep.label})`)}`);
    }
    if (sel.public.length) {
      console.log(ui.sectionLabel("Public"));
      for (const ep of sel.public) console.log(`  ${ui.cyan(shareUrl(ep.url))}  ${ui.dim(`(via ${ep.label})`)}`);
      if (sel.public.some((ep) => /pinggy/i.test(ep.label))) {
        console.log(`\nNote: free pinggy links show a one-time Pinggy caution page.`);
        console.log("Tell the recipient to tap “Enter site” to reach your files.");
      }
    }
    if (passwordRaw) console.log(`\nPassword: ${ui.bold(passwordRaw)}`);
    console.log(`\nDownloads: 0${session.maxDownloads ? ` / ${session.maxDownloads}` : ""}`);
    console.log(`Expires: ${session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "when stopped"}`);

    // QR — Local + Public by default; --qr controls scope.
    const qrMode = (flags.qr ?? "smart").toLowerCase();
    const showQr = qrMode !== "off";
    if (showQr) {
      const narrow = (process.stdout.columns ?? 80) < 70;
      await ui.printQR("QR · Local — scan on same Wi-Fi", primaryLocal);
      if (primaryPublic && qrMode !== "local") {
        await ui.printQR("QR · Public — scan from anywhere", primaryPublic);
      }
      if (qrMode === "all" && p2pUrl && !narrow) {
        await ui.printQR("QR · Direct P2P", p2pUrl);
      } else if (p2pUrl && qrMode === "all" && narrow) {
        console.log(ui.sectionLabel("Direct P2P (QR skipped — narrow terminal)"));
        console.log(`  ${ui.cyan(p2pUrl)}`);
      }
    }

    // Clipboard — prefer public URL when shared publicly.
    if (!flags.noClipboard) {
      const toCopy = primaryPublic ?? primaryLocal;
      const ok = await ui.copyToClipboard(toCopy);
      console.log(ok ? `\nCopied ${primaryPublic ? "public" : "local"} URL to clipboard.` : "\n(Clipboard copy unavailable.)");
    }
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
