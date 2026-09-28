import { resolve } from "node:path";
import { formatBytes, generateShortCode, generateShortPassword, hashPassword } from "@share/core";
import { createReceiveHandler } from "@share/server";

export interface ReceiveFlags {
  port?: number;
  dir?: string;
  password?: string | boolean;
  expires?: string;
  /** Expose the inbox via a tunnel so a sender on another network can reach it. */
  public?: boolean;
  /** Tunnel provider (auto, ask, pinggy, localxpose, cloudflare, localtunnel, localhost.run, zrok). */
  tunnel?: string;
  quiet?: boolean;
  yes?: boolean;
  json?: boolean;
  /** Publish this inbox on a hub under this name, so senders can use
   *  `share0 send <file> --to <name>` with no URL at all. */
  as?: string;
  /** Hub to publish to. Defaults to $SHARE0_HUB. */
  hub?: string;
  /** Generate a short 3-character handle instead of naming one. */
  code?: boolean;
}

/** Phase 3 receive mode: advertise an upload endpoint; others push via
 *  `share0 send --to <url>` or the browser upload page.
 *
 *  With `--public` the inbox also gets a verified tunnel URL, which is what
 *  makes it reachable from another network rather than just the LAN. */
export async function runReceive(flags: ReceiveFlags): Promise<void> {
  const dir = resolve(flags.dir ?? "./share-inbox");
  const port = flags.port ?? 8788;

  let passwordRaw: string | undefined;
  let passwordHash: string | undefined;
  if (flags.password === true) {
    passwordRaw = generateShortPassword();
    passwordHash = await hashPassword(passwordRaw);
  } else if (typeof flags.password === "string" && flags.password.length > 0) {
    passwordRaw = flags.password;
    passwordHash = await hashPassword(passwordRaw);
  }

  const handler = createReceiveHandler({
    dir,
    passwordHash,
    onReceive: (name, bytes) => console.log(`  ✓ received ${name} (${formatBytes(bytes)}) → ${dir}`),
  });

  let actualPort = port;
  let server: ReturnType<typeof Bun.serve> | null = null;
  for (let i = 0; i < 20 && !server; i++) {
    try {
      server = Bun.serve({ port: actualPort, hostname: "0.0.0.0", fetch: handler });
    } catch (e) {
      if ((e as { code?: string }).code === "EADDRINUSE") actualPort++;
      else throw e;
    }
  }
  if (!server) throw new Error("No free port found");
  // Bun.serve types `port` as possibly-undefined; the loop above guarantees it.
  actualPort = server.port ?? actualPort;

  const { getLanInfo, advertise } = await import("@share/discovery");
  const lan = getLanInfo().primaryIpv4 ?? "127.0.0.1";
  const url = `http://${lan}:${actualPort}/`;

  let stopAdvertise: (() => void) | null = null;
  try {
    stopAdvertise = await advertise({ kind: "receive", id: `inbox-${actualPort}`, name: `inbox on ${lan}`, port: actualPort });
    console.log("  · advertised on LAN via mDNS (share0 discover)");
  } catch { /* mDNS unavailable */ }

  // --- tunnel (--public) ---
  // A LAN-only inbox is unreachable from another network, which is the whole
  // point of sharing with someone far away. Reuse the same provider selection
  // `send` uses, so both directions fail and fall back identically.
  const ui = await import("@share/ui");
  const quiet = !!flags.quiet;
  const interactive = ui.isInteractive({ yes: flags.yes, quiet, json: flags.json });
  let wantPublic = !!flags.public;
  let tunnelOpt = flags.tunnel;
  const tunnelLower = tunnelOpt?.toLowerCase();
  if (tunnelOpt && tunnelLower !== "auto" && tunnelLower !== "ask") wantPublic = true;
  if (interactive && !wantPublic && !tunnelOpt) {
    wantPublic = await ui.confirm("Expose this inbox publicly via a tunnel? (LAN-only otherwise)", false);
  }
  if (wantPublic && (!tunnelOpt || tunnelLower === "ask") && interactive) {
    const { detectTunnels } = await import("@share/transport");
    const { ready } = await detectTunnels(quiet ? () => {} : (m) => console.log(m));
    if (ready.length > 1) {
      const pick = await ui.select("Which tunnel provider?", [
        { value: "__auto__", label: "Auto (recommended)", hint: "pick fastest healthy" },
        ...ready.map((c) => ({ value: c.name, label: `✓ ${c.name}`, hint: c.detail ?? "ready" })),
      ]);
      tunnelOpt = pick === "__auto__" ? undefined : pick;
    } else if (ready.length === 1) {
      console.log(`\n${ui.dim(`Only ${ready[0]!.name} is available — using it.`)}`);
      tunnelOpt = ready[0]!.name;
    } else {
      console.log(ui.warnLine("No tunnel provider available — inbox stays LAN-only."));
      wantPublic = false;
      tunnelOpt = undefined;
    }
  } else if (tunnelLower === "auto" || tunnelLower === "ask") {
    tunnelOpt = undefined;
  }

  let tunnelUrl: string | undefined;
  let tunnelLabel = "";
  let opened: Array<{ close(): Promise<void> }> = [];
  if (wantPublic) {
    const { openTunnel } = await import("@share/transport");
    const t = await openTunnel({
      port: actualPort,
      // No payload to size against: a receiver takes many pushes of unknown
      // size, so prefer whatever provider answers first.
      preferredTunnel: tunnelOpt,
      onLog: quiet ? () => {} : (m) => console.log(m),
    });
    for (const n of t.notes) if (!quiet) console.log(`  ${ui.dim("· " + n)}`);
    opened = t.opened;
    if (t.url) {
      tunnelUrl = t.url;
      tunnelLabel = t.label;
    } else if (!quiet) {
      console.log(ui.warnLine("No tunnel routed traffic — inbox is LAN-only."));
    }
  }

  // --- hub publish (--as / --code) ---
  // Publishes this inbox so senders can use a name instead of a URL. The
  // entry is refreshed on a heartbeat and the hub drops anything unrefreshed
  // after 30 minutes, so a stopped process stops resolving without cleanup.
  let stopHeartbeat: (() => void) | null = null;
  let published: { name: string; kind: "handle" | "code" } | null = null;
  const wantName = flags.as?.trim() || (flags.code ? generateShortCode() : "");
  if (wantName) {
    if (!tunnelUrl) {
      console.log(
        ui.warnLine("Cannot publish without a public URL — add --public so senders outside this network can reach you.")
      );
    } else {
      const { hubUrl, announce, startHeartbeat, HubError } = await import("@share/hub");
      const base = flags.hub ?? hubUrl();
      if (!base) {
        console.log(
          ui.warnLine("No hub configured, so the handle was not published. Set SHARE0_HUB or pass --hub <url>.")
        );
      } else {
        // 3-char codes live in their own namespace; a named handle is durable.
        const kind: "handle" | "code" = flags.as?.trim() ? "handle" : "code";
        const input = {
          name: wantName,
          url: tunnelUrl!,
          label: `${wantName} (receive)`,
          kind,
        };
        try {
          await announce(base, input);
          stopHeartbeat = startHeartbeat(base, input, {
            onError: (e) => console.log(`  ${ui.dim("· hub: " + e.message)}`),
          });
          published = { name: wantName, kind };
        } catch (e) {
          const msg = e instanceof HubError ? e.message : (e as Error).message;
          console.log(ui.warnLine(`Could not publish to hub: ${msg}`));
        }
      }
    }
  }

  console.log(ui.header("share0 receive"));
  console.log(`\n  Saving to  ${dir}`);
  console.log(ui.sectionLabel("Upload URL"));
  console.log(`  ${ui.cyan(url)}`);
  if (tunnelUrl) {
    console.log(ui.sectionLabel("Public"));
    console.log(`  ${ui.cyan(tunnelUrl)}  ${ui.dim(`(via ${tunnelLabel})`)}`);
  }
  if (passwordRaw) console.log(`\n  Password   ${ui.bold(passwordRaw)}`);
  if (published) {
    console.log(ui.sectionLabel("Send to this inbox"));
    console.log(`  ${ui.bold(ui.cyan(`share0 send ./file --to ${published.name}`))}`);
    if (published.kind === "code") {
      console.log(`  ${ui.dim("Temporary code — expires when you stop.")}`);
    } else {
      console.log(`  ${ui.dim("This name keeps working every time you run this command.")}`);
    }
  } else {
    console.log(`\n  Push from another device:\n    share0 send ./file --to ${tunnelUrl ?? url}`);
  }
  console.log(`\n  Press Ctrl+C to stop`);

  await ui.printQR("QR · Scan to open inbox", tunnelUrl ?? url);
  if (await ui.copyToClipboard(tunnelUrl ?? url)) console.log("\nCopied URL to clipboard.");

  if (flags.expires) {
    const { parseExpires } = await import("@share/core");
    const ms = parseExpires(flags.expires);
    const expireTimer = setTimeout(() => {
      console.log("\nReceive window expired.");
      void cleanup();
    }, ms);
    expireTimer.unref?.();
  }

  const cleanup = async () => {
    console.log("\nStopping receiver…");
    try { stopAdvertise?.(); } catch { /* noop */ }
    // Stop refreshing first, then pull the handle: a clean exit shouldn't
    // leave a name resolving to a machine that is about to be gone.
    try { stopHeartbeat?.(); } catch { /* noop */ }
    if (published && tunnelUrl) {
      try {
        const { hubUrl, retract } = await import("@share/hub");
        const base = flags.hub ?? hubUrl();
        if (base) await retract(base, published.name, published.kind);
        console.log(`  handle "${published.name}" is no longer published.`);
      } catch { /* best effort — the TTL is the real guarantee */ }
    }
    // Close the tunnel before the server: a leftover adapter process would
    // keep forwarding to a dead port and hold its own resources.
    for (const t of opened) {
      try { await t.close(); } catch { /* noop */ }
    }
    try { server?.stop(); } catch { /* noop */ }
    process.exit(0);
  };
  process.on("SIGINT", () => void cleanup());
  process.on("SIGTERM", () => void cleanup());
  await new Promise(() => {});
}
