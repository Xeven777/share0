import { spawnSync } from "node:child_process";
import { getLanInfo } from "@share/discovery";
import { allTunnelAdapters } from "@share/transport";

function hasBinary(bin: string): boolean {
  const r = spawnSync("which", [bin]);
  return r.status === 0;
}

async function portFree(port: number): Promise<boolean> {
  try {
    const srv = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    srv.stop();
    return true;
  } catch {
    return false;
  }
}

export async function runDoctor(): Promise<void> {
  const checks: Array<[string, () => Promise<{ ok: boolean; detail?: string }>]> = [
    ["Runtime", async () => ({ ok: true, detail: `Bun ${Bun.version}` })],
    ["Network interface", async () => {
      const info = getLanInfo();
      return info.primaryIpv4
        ? { ok: true, detail: info.ipv4.join(", ") }
        : { ok: false, detail: "no external interface" };
    }],
    ["Local IPv4", async () => {
      const info = getLanInfo();
      return info.primaryIpv4 ? { ok: true, detail: info.primaryIpv4 } : { ok: false };
    }],
    ["IPv6", async () => {
      const info = getLanInfo();
      return info.ipv6.length ? { ok: true, detail: info.ipv6[0] } : { ok: false, detail: "no global IPv6" };
    }],
    ["Port availability", async () => {
      const free = await portFree(8787);
      return free ? { ok: true, detail: "8787 free" } : { ok: false, detail: "8787 in use (will auto-bump)" };
    }],
    ["LAN connectivity", async () => {
      const info = getLanInfo();
      return info.primaryIpv4 ? { ok: true, detail: "same-Wi-Fi recipients can use LAN URL" } : { ok: false };
    }],
    ["Inbound firewall", async () => {
      // Unprivileged detection: ufw status needs root, but systemd/ufw.conf don't.
      const { detectBlockingFirewall, p2pUdpFix } = await import("@share/discovery");
      const fw = await detectBlockingFirewall(8787);
      if (fw.active) {
        return { ok: false, detail: `${fw.tool} is ACTIVE and blocks inbound LAN traffic — fix: ${fw.fix} (+ ${p2pUdpFix(fw.tool ?? "ufw")} for P2P)` };
      }
      return { ok: true, detail: "no blocking host firewall detected (if phone can't reach LAN URL: check AP isolation / VPN / guest Wi-Fi — see README troubleshooting)" };
    }],
    ["UPnP/NAT-PMP", async () => {
      const { defaultGatewayIp, upnpDiscover, upnpExternalIp } = await import("@share/transport/upnp");
      const gw = await defaultGatewayIp();
      if (!gw) return { ok: false, detail: "no default gateway found" };
      const svc = await upnpDiscover(2000).catch(() => null);
      if (svc) {
        const ext = await upnpExternalIp(svc).catch(() => null);
        return { ok: true, detail: `IGD via ${gw}${ext ? `, external ${ext}` : ""}` };
      }
      return { ok: false, detail: `no UPnP IGD (gateway ${gw}); NAT-PMP mapping will be attempted on --upnp/--public` };
    }],
    ["NAT", async () => {
      // Heuristic: compare router external IP (if UPnP) or public echo vs LAN.
      const { upnpDiscover, upnpExternalIp } = await import("@share/transport/upnp");
      const svc = await upnpDiscover(2000).catch(() => null);
      const lan = getLanInfo().primaryIpv4;
      const ext = svc ? await upnpExternalIp(svc).catch(() => null) : null;
      if (ext && lan) {
        return ext === lan
          ? { ok: true, detail: "no NAT (public IP on this host)" }
          : { ok: true, detail: `behind NAT (LAN ${lan}, external ${ext}) — direct P2P via STUN/UPnP preferred` };
      }
      if (lan) return { ok: true, detail: `LAN ${lan}; external IP unknown (no UPnP)` };
      return { ok: false, detail: "no network" };
    }],
    ["mDNS discovery", async () => {
      const { mdnsAvailable } = await import("@share/discovery");
      return (await mdnsAvailable())
        ? { ok: true, detail: "`share discover` can find nearby devices" }
        : { ok: false, detail: "bonjour-service unavailable" };
    }],
    ["WebRTC P2P", async () => {
      const { weriftAvailable } = await import("@share/transport");
      return (await weriftAvailable())
        ? { ok: true, detail: "direct DataChannel offers enabled" }
        : { ok: false, detail: "werift not installed — HTTP download still works" };
    }],
    ["Tailscale", async () => (hasBinary("tailscale") ? { ok: true } : { ok: false, detail: "tailscale not installed" })],
    ["cloudflared", async () => (hasBinary("cloudflared") ? { ok: true } : { ok: false, detail: "not installed" })],
    ["Tunnel providers", async () => {
      const found: string[] = [];
      for (const t of allTunnelAdapters) {
        const st = await t.detect();
        if (st.available) found.push(t.name);
      }
      return found.length
        ? { ok: true, detail: found.join(", ") }
        : { ok: false, detail: "no tunnel provider available (LAN-only mode)" };
    }],
  ];

  let failed = 0;
  for (const [name, fn] of checks) {
    try {
      const r = await fn();
      console.log(`${r.ok ? "✓" : "✗"} ${name}${r.detail ? ` — ${r.detail}` : ""}`);
      if (!r.ok) failed++;
    } catch (e) {
      failed++;
      console.log(`✗ ${name} — ${(e as Error).message}`);
    }
  }
  if (failed) console.log(`\n${failed} check(s) need attention. LAN sharing works regardless.`);
  else console.log("\nAll checks passed.");
}
