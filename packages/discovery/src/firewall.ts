import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

// Host-firewall detection that works WITHOUT root (ufw/firewalld status
// queries need privileges, but systemd unit state + ufw.conf are readable).

export interface FirewallStatus {
  active: boolean;
  tool?: "ufw" | "firewalld";
  /** Concrete fix command for the given port. */
  fix?: string;
}

export function parseUfwConf(text: string): boolean {
  return /^ENABLED\s*=\s*yes\s*$/im.test(text);
}

async function systemdActive(unit: string): Promise<boolean> {
  try {
    const r = spawnSync("systemctl", ["is-active", unit], { timeout: 5000 });
    return r.status === 0 && r.stdout?.toString().trim() === "active";
  } catch {
    return false;
  }
}

export async function detectBlockingFirewall(port: number): Promise<FirewallStatus> {
  if (await systemdActive("ufw")) {
    return { active: true, tool: "ufw", fix: `sudo ufw allow ${port}/tcp` };
  }
  try {
    if (parseUfwConf(await readFile("/etc/ufw/ufw.conf", "utf8"))) {
      return { active: true, tool: "ufw", fix: `sudo ufw allow ${port}/tcp` };
    }
  } catch { /* no ufw conf */ }
  if (await systemdActive("firewalld")) {
    return {
      active: true,
      tool: "firewalld",
      fix: `sudo firewall-cmd --add-port=${port}/tcp --permanent && sudo firewall-cmd --reload`,
    };
  }
  // Root-only direct query as a last resort (usually permission-denied).
  try {
    const r = spawnSync("ufw", ["status"], { timeout: 5000 });
    const out = `${r.stdout?.toString() ?? ""}\n${r.stderr?.toString() ?? ""}`;
    if (r.status === 0 && /Status:\s*active/i.test(out)) {
      return { active: true, tool: "ufw", fix: `sudo ufw allow ${port}/tcp` };
    }
  } catch { /* noop */ }
  return { active: false };
}

/** Firewall rule allowing WebRTC P2P (fixed ICE UDP range, see transport/webrtc). */
export function p2pUdpFix(tool: "ufw" | "firewalld"): string {
  return tool === "ufw"
    ? "sudo ufw allow 52000:52100/udp"
    : "sudo firewall-cmd --add-port=52000-52100/udp --permanent && sudo firewall-cmd --reload";
}
