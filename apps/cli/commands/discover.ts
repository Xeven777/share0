import { browse } from "@share/discovery";

export async function runDiscover(opts: { timeout?: number; receive?: boolean; shares?: boolean }): Promise<void> {
  const kinds: Array<"share" | "receive"> = [];
  if (opts.shares !== false) kinds.push("share");
  if (opts.receive !== false) kinds.push("receive");
  const timeout = (opts.timeout ?? 4) * 1000;
  console.log(`Looking for nearby devices (${timeout / 1000}s)…\n`);
  const found = await browse(timeout, kinds.length ? kinds : ["share", "receive"]);
  if (!found.length) {
    console.log("No nearby shares found.");
    console.log("Tip: the sender's `share0 send` advertises automatically on LAN.");
    return;
  }
  for (const n of found) {
    const url = n.host ? `http://${n.host}:${n.port}/` : `(resolving…) port ${n.port}`;
    console.log(`  ${n.kind === "share" ? "◉ share" : "◎ receive"}  ${n.name}`);
    console.log(`      id: ${n.id}${n.device ? `  device: ${n.device}` : ""}`);
    console.log(`      ${url}`);
  }
}
