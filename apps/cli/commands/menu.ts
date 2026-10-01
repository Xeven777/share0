import { header, select, textInput, confirm, dim, bold, cyan, gray2 } from "@share/ui";
import { existsSync } from "node:fs";

export async function runMenu(): Promise<void> {
  console.log(header());
  console.log(gray2("Send files without uploading. LAN-first, public when you need it.\n"));

  const choice = await select("What do you want to do?", [
    { value: "send", label: "Send files…", hint: "share a file or folder" },
    { value: "send-to", label: "Send to a name…", hint: "push to someone's inbox" },
    { value: "receive", label: "Receive files…", hint: "open an upload inbox" },
    { value: "inbox", label: "Publish an inbox…", hint: "get a name others can send to" },
    { value: "hub", label: "Run a hub…", hint: "name lookup server" },
    { value: "discover", label: "Discover nearby…", hint: "find LAN shares" },
    { value: "list", label: "Active shares", hint: "list running shares" },
    { value: "doctor", label: "Doctor", hint: "diagnose network + tunnels" },
  ]);

  if (choice === "send") {
    const input = await textInput("Path to share", "./photo.jpg");
    if (!input) {
      console.log(dim("Nothing to share. Try: share0 send ./photo.jpg"));
      return;
    }
    const paths = input.split(/\s+/).filter(Boolean);
    for (const p of paths) {
      if (!existsSync(p)) {
        console.error(`No such file or directory: ${p}`);
        process.exit(1);
      }
    }
    const { runSend } = await import("./send.ts");
    await runSend(paths, {});
    return;
  }

  if (choice === "send-to") {
    const target = await textInput("Name or URL to send to", "anish");
    if (!target) {
      console.log(dim("Try: share0 send ./photo.jpg --to anish"));
      return;
    }
    const input = await textInput("Path to send", "./photo.jpg");
    if (!input) {
      console.log(dim("Nothing to send."));
      return;
    }
    const paths = input.split(/\s+/).filter(Boolean);
    for (const p of paths) {
      if (!existsSync(p)) {
        console.error(`No such file or directory: ${p}`);
        process.exit(1);
      }
    }
    const { runSend } = await import("./send.ts");
    await runSend(paths, { to: target });
    return;
  }

  if (choice === "receive") {
    const { runReceive } = await import("./receive.ts");
    await runReceive({});
    return;
  }

  if (choice === "inbox") {
    const mode = await select("How should others reach this inbox?", [
      { value: "name", label: "A name I pick", hint: "durable, e.g. anish" },
      { value: "code", label: "A random 3-character code", hint: "say it out loud once" },
      { value: "url", label: "Just the URL", hint: "LAN only unless you add --public" },
    ]);
    const { runReceive } = await import("./receive.ts");
    if (mode === "url") {
      // A name is only useful off the LAN, so only this branch asks. runReceive
      // offers the tunnel prompt itself when it is interactive.
      await runReceive({});
      return;
    }
    const publicOk = await confirm("Make it reachable over the internet? (needed for a name)", true);
    if (!publicOk) {
      await runReceive({});
      return;
    }
    if (mode === "name") {
      const name = await textInput("Name for this inbox", "anish");
      if (!name) {
        console.log(dim("Try: share0 receive --public --as anish"));
        return;
      }
      await runReceive({ public: true, as: name });
      return;
    }
    await runReceive({ public: true, code: true });
    return;
  }

  if (choice === "hub") {
    const where = await select("Who needs to reach the hub?", [
      { value: "local", label: "Just this machine", hint: "testing, or you send to yourself" },
      { value: "lan", label: "Other machines on my network", hint: "0.0.0.0" },
    ]);
    const { runHub } = await import("./hub.ts");
    await runHub(where === "lan" ? { host: "0.0.0.0" } : {});
    return;
  }

  if (choice === "discover") {
    const { runDiscover } = await import("./discover.ts");
    await runDiscover({});
    return;
  }
  if (choice === "list") {
    const { runList } = await import("./list.ts");
    await runList();
    return;
  }
  const { runDoctor } = await import("./doctor.ts");
  await runDoctor();
}

/** One line on the hub's status, for the menu. Keeps `share0 hub` visible
 *  without adding another top-level choice. */
function hubHint(): string {
  const hub = process.env.SHARE0_HUB?.trim();
  return hub ? `hub ${hub}` : "no hub configured";
}

export function printPrettyHelp(): void {
  console.log(header());
  console.log("");
  console.log(`${bold("Usage:")}  ${cyan("share0")} <command> [options]`);
  console.log(`${bold("         ")}  ${cyan("share0")}  (no args → interactive menu)`);
  console.log("");
  console.log(bold("Commands:"));
  console.log(`  ${cyan("send")} <paths…>   Share files / directories`);
  console.log(`  ${cyan("receive")}         Open an upload inbox`);
  console.log(`  ${cyan("hub")}             Run a hub (name → live URL lookup)`);
  console.log(`  ${cyan("discover")}        Find nearby LAN shares`);
  console.log(`  ${cyan("list")}            List active shares`);
  console.log(`  ${cyan("stop")} <id>       Stop a share`);
  console.log(`  ${cyan("doctor")}          Diagnose network + tunnels`);
  console.log("");
  console.log(bold("Examples:"));
  console.log("  share0 send ./photo.jpg");
  console.log("  share0 send ./video.mp4 --public");
  console.log("  share0 send ./holiday.zip --to anish");
  console.log("  share0 receive --public --as anish");
  console.log("");
  console.log(bold("Sending to someone by name"));
  console.log(dim("The receiver publishes a name, you send to it. They run:"));
  console.log("  share0 hub                            # once, on an always-on machine");
  console.log("  export SHARE0_HUB=https://your-hub.example");
  console.log("  share0 receive --public --as anish    # they leave this open");
  console.log("");
  console.log(dim(`Tip: run with no args for the interactive menu. Currently using ${hubHint()}.`));
  console.log(dim("--quiet prints URLs only, --json is for scripts."));
}
