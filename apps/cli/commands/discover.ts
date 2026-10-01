import { browse } from "@share/discovery";

export async function runDiscover(opts: { timeout?: number; receive?: boolean; shares?: boolean }): Promise<void> {
  const ui = await import("@share/ui");
  const kinds: Array<"share" | "receive"> = [];
  if (opts.shares !== false) kinds.push("share");
  if (opts.receive !== false) kinds.push("receive");
  const timeout = (opts.timeout ?? 4) * 1000;
  console.log(ui.header("share0 discover"));
  console.log(`  ${ui.gray2(`Looking for nearby devices (${timeout / 1000}s)…`)}\n`);
  const found = await browse(timeout, kinds.length ? kinds : ["share", "receive"]);
  if (!found.length) {
    console.log(ui.gray2("No nearby shares found."));
    console.log(ui.gray2("Tip: the sender's `share0 send` advertises automatically on LAN."));
    return;
  }
  for (const n of found) {
    const url = n.host ? `http://${n.host}:${n.port}/` : `(resolving…) port ${n.port}`;
    console.log(`  ${n.kind === "share" ? ui.accent("◉ share") : ui.green("◎ receive")}  ${ui.bold(n.name)}`);
    console.log(`  ${ui.gray2(`    id: ${n.id}${n.device ? `  device: ${n.device}` : ""}`)}`);
    console.log(`      ${ui.cyan(url)}`);
  }
}
