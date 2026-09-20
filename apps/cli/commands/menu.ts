import { header, select, textInput, dim, bold } from "@share/ui";
import { existsSync } from "node:fs";

export async function runMenu(): Promise<void> {
  console.log(header());
  console.log(dim("Send files without uploading. LAN-first, public when you need it.\n"));

  const choice = await select("What do you want to do?", [
    { value: "send", label: "Send files…", hint: "share a file or folder" },
    { value: "receive", label: "Receive files…", hint: "open an upload inbox" },
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
  if (choice === "receive") {
    const { runReceive } = await import("./receive.ts");
    await runReceive({});
    return;
  }
  if (choice === "discover") {
    const { runDiscover } = await import("./discover.ts");
    await runDiscover({});
    return;
  }
  if (choice === "list") {
    const { runList } = await import("./list.ts");
    runList();
    return;
  }
  const { runDoctor } = await import("./doctor.ts");
  await runDoctor();
}

export function printPrettyHelp(): void {
  console.log(header());
  console.log("");
  console.log(`${bold("Usage:")}  share0 <command> [options]`);
  console.log(`${bold("         ")}  share0  (no args → interactive menu)`);
  console.log("");
  console.log(bold("Commands:"));
  console.log("  send <paths…>   Share files / directories");
  console.log("  receive         Open an upload inbox");
  console.log("  discover        Find nearby LAN shares");
  console.log("  list            List active shares");
  console.log("  stop <id>       Stop a share");
  console.log("  doctor          Diagnose network + tunnels");
  console.log("");
  console.log(bold("Examples:"));
  console.log("  share0 send ./photo.jpg");
  console.log("  share0 send ./video.mp4 --public");
  console.log("  share0 send ./video.mp4 --public --tunnel pinggy");
  console.log("  share0 send ./project --zip --password");
  console.log("");
  console.log(dim("Tip: run with no args for the interactive menu. --quiet prints URLs only, --json for scripts."));
}
