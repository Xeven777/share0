#!/usr/bin/env bun
import { CAC } from "cac";
import { runSend } from "./commands/send.ts";
import { runList } from "./commands/list.ts";
import { runStop } from "./commands/stop.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runReceive } from "./commands/receive.ts";
import { runDiscover } from "./commands/discover.ts";
import { maybeDetachParent } from "./commands/detach.ts";

const cli = new CAC("share0");

// `--no-qr` is an alias for `--qr off`. cac can't model a negated
// value-option, so normalize before parsing.
{
  const idx = process.argv.indexOf("--no-qr");
  if (idx !== -1) process.argv.splice(idx, 1, "--qr", "off");
}

cli
  .command("send <paths...>", "Share files/directories")
  .option("--port <port>", "Port to listen on", { default: 8787 })
  .option("--expires <duration>", "Expiration e.g. 30m, 2h")
  .option("--downloads <n>", "Max downloads")
  .option("--password [value]", "Protect with password (generates one if no value)")
  .option("--zip", "Serve as a ZIP archive")
  .option("--public", "Expose via a tunnel provider")
  .option("--tunnel <name>", "Tunnel provider (auto, ask, pinggy, localxpose, cloudflare, localtunnel, localhost.run, zrok)")
  .option("--qr <mode>", "QR codes: all, local, public, off (or pass --no-qr)")
  .option("--no-clipboard", "Do not copy URL to clipboard")
  .option("--quiet", "Print URLs only (scriptable)")
  .option("--json", "Print share info as JSON")
  .option("--yes", "Skip interactive prompts")
  .option("--upnp", "Request temporary UPnP/NAT-PMP port mapping (implied by --public)")
  .option("--no-p2p", "Disable the automatic WebRTC direct-P2P offer")
  .option("--to <url>", "Push files to a `share0 receive` endpoint instead of hosting")
  .option("--detach", "Run in background (survives terminal close)")
  .option("--detached-child", "Internal: marker for backgrounded child")
  .action(async (paths: string[], options: Record<string, unknown>) => {
    if (options.detach && !options["detached-child"]) {
      await maybeDetachParent();
      return;
    }
    await runSend(paths, {
      port: options.port != null ? Number(options.port) : undefined,
      expires: options.expires as string | undefined,
      downloads: options.downloads != null ? Number(options.downloads) : undefined,
      password: options.password as string | boolean | undefined,
      zip: !!options.zip,
      public: !!options.public,
      tunnel: options.tunnel as string | undefined,
      qr: process.argv.includes("--no-qr") ? "off" : (options.qr as string | undefined),
      noClipboard: !!options["no-clipboard"] || (options as Record<string, unknown>).clipboard === false,
      quiet: !!options.quiet,
      json: !!options.json,
      yes: !!options.yes,
      upnp: !!options.upnp,
      noP2p: !!options["no-p2p"] || options.p2p === false,
      to: options.to as string | undefined,
    });
  });

cli
  .command("receive", "Advertise an upload endpoint for direct pushes")
  .option("--port <port>", "Port to listen on", { default: 8788 })
  .option("--dir <path>", "Directory to save into")
  .option("--password [value]", "Protect with password")
  .option("--expires <duration>", "Close the receive window after e.g. 30m")
  .action(async (options: Record<string, unknown>) => {
    await runReceive({
      port: options.port != null ? Number(options.port) : undefined,
      dir: options.dir as string | undefined,
      password: options.password as string | boolean | undefined,
      expires: options.expires as string | undefined,
    });
  });

cli
  .command("discover", "Find nearby shares and receivers on the LAN")
  .option("--timeout <s>", "How long to listen", { default: 4 })
  .action(async (options: Record<string, unknown>) => {
    await runDiscover({ timeout: options.timeout != null ? Number(options.timeout) : undefined });
  });

cli.command("list", "List active shares").action(() => runList());

cli
  .command("stop <id>", "Stop a share")
  .action((id: string) => runStop(id));

cli.command("doctor", "Run diagnostics").action(async () => runDoctor());

cli.help();
cli.version("1.0.0");

// Bare `share0` → interactive menu (TTY) or pretty help (piped/CI).
const rawArgs = process.argv.slice(2);
if (!rawArgs.length) {
  const { isTTY } = await import("@share/ui");
  if (isTTY()) {
    const { runMenu } = await import("./commands/menu.ts");
    await runMenu();
  } else {
    const { printPrettyHelp } = await import("./commands/menu.ts");
    printPrettyHelp();
  }
} else {
  cli.parse();
}
