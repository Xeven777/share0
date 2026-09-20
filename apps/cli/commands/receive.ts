import { resolve } from "node:path";
import { formatBytes, generateShortPassword, hashPassword } from "@share/core";
import { createReceiveHandler } from "@share/server";

export interface ReceiveFlags {
  port?: number;
  dir?: string;
  password?: string | boolean;
  expires?: string;
}

/** Phase 3 receive mode: advertise an upload endpoint; others push via
 *  `share0 send --to <url>` or the browser upload page. */
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
  let server: { port: number; stop(): void } | null = null;
  for (let i = 0; i < 20 && !server; i++) {
    try {
      server = Bun.serve({ port: actualPort, hostname: "0.0.0.0", fetch: handler });
    } catch (e) {
      if ((e as { code?: string }).code === "EADDRINUSE") actualPort++;
      else throw e;
    }
  }
  if (!server) throw new Error("No free port found");

  const { getLanInfo, advertise } = await import("@share/discovery");
  const lan = getLanInfo().primaryIpv4 ?? "127.0.0.1";
  const url = `http://${lan}:${actualPort}/`;

  let stopAdvertise: (() => void) | null = null;
  try {
    stopAdvertise = await advertise({ kind: "receive", id: `inbox-${actualPort}`, name: `inbox on ${lan}`, port: actualPort });
    console.log("  · advertised on LAN via mDNS (share0 discover)");
  } catch { /* mDNS unavailable */ }

  const ui = await import("@share/ui");
  console.log(ui.header("share0 receive"));
  console.log(`\n  Saving to  ${dir}`);
  console.log(ui.sectionLabel("Upload URL"));
  console.log(`  ${ui.cyan(url)}`);
  if (passwordRaw) console.log(`\n  Password   ${ui.bold(passwordRaw)}`);
  console.log(`\n  Push from another device:\n    share0 send ./file --to ${url}`);
  console.log(`\n  Press Ctrl+C to stop`);

  await ui.printQR("QR · Scan to open inbox", url);
  if (await ui.copyToClipboard(url)) console.log("\nCopied URL to clipboard.");

  if (flags.expires) {
    const { parseExpires } = await import("@share/core");
    const ms = parseExpires(flags.expires);
    setTimeout(() => {
      console.log("\nReceive window expired.");
      process.exit(0);
    }, ms).unref?.();
  }

  const cleanup = () => {
    console.log("\nStopping receiver…");
    try { stopAdvertise?.(); } catch { /* noop */ }
    try { server?.stop(); } catch { /* noop */ }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  await new Promise(() => {});
}
