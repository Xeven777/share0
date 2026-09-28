#!/usr/bin/env bun
// `share0 hub`. Runs the name-to-URL lookup on your own machine.
//
// The hub maps names to live tunnel URLs and never carries file bytes.
//
// packages/hub/src/worker.ts is the same API as a Cloudflare Worker, if you
// would rather host it than run it.
//
// Storage here is in-memory, so a restart clears every name. Receivers
// re-announce within 10 minutes, so they recover on their own.

import { serveHub } from "@share/hub/local";

export interface HubFlags {
  port?: number;
  /** Bind address. Use 0.0.0.0 to accept announcements from other machines. */
  host?: string;
  /** Print the URL other machines should point SHARE0_HUB at. */
  printUrl?: boolean;
}

export async function runHub(flags: HubFlags): Promise<void> {
  const ui = await import("@share/ui");
  const hub = serveHub({ port: flags.port ?? 8790, hostname: flags.host ?? "127.0.0.1" });

  console.log(ui.header("share0 hub"));
  console.log(`  Listening   ${ui.cyan(hub.url)}`);
  console.log(`  Storage     in-memory (cleared on exit)`);
  console.log(`  Live names  ${hub.store.size}`);
  console.log(`\n  Point receivers and senders at it:`);
  console.log(`    export SHARE0_HUB=${hub.url}`);

  if (flags.host && flags.host !== "127.0.0.1" && flags.host !== "localhost") {
    const { getLanInfo } = await import("@share/discovery");
    const ips = getLanInfo().ipv4;
    if (ips.length) {
      console.log(`\n  Reachable on this network at:`);
      for (const ip of ips) console.log(`    http://${ip}:${hub.port}`);
    }
  }

  console.log(`\n  Anyone can publish a name. The hub has no auth, so keep it off the public internet.`);
  console.log(`\nPress Ctrl+C to stop.`);

  // Keep the live name count visible so an operator can see names arriving.
  const { SYMBOLS } = await import("@share/ui");
  const timer = setInterval(() => {
    console.log(`  ${SYMBOLS.idle} ${new Date().toLocaleTimeString()} ${SYMBOLS.arrow} ${hub.store.size} live name(s)`);
  }, 30_000);
  timer.unref?.();

  const cleanup = () => {
    console.log("\nStopping hub…");
    clearInterval(timer);
    try { hub.stop(); } catch { /* noop */ }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  await new Promise(() => {});
}
