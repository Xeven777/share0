import { getLanInfo } from "@share/discovery";
import type { Endpoint, OpenOptions, Transport, TransportStatus } from "./types.ts";

export class LanTransport implements Transport {
  name = "lan";
  priority = 10;

  async detect(): Promise<TransportStatus> {
    const info = getLanInfo();
    if (info.primaryIpv4) return { available: true, detail: info.primaryIpv4 };
    return { available: false, detail: "no non-internal IPv4 interface" };
  }

  async open(options: OpenOptions): Promise<Endpoint[]> {
    const info = getLanInfo();
    // Expose every LAN IPv4 (primary first): on multi-NIC machines (wifi +
    // ethernet, VPNs, VMs) the heuristic "primary" may be on a different
    // subnet than the recipient, so the CLI prints all of them.
    const ips = info.primaryIpv4
      ? [info.primaryIpv4, ...info.ipv4.filter((ip) => ip !== info.primaryIpv4)]
      : ["127.0.0.1"];
    return ips.map((ip, i) => ({
      url: `http://${ip}:${options.port}`,
      kind: "lan",
      label: i === 0 ? "LAN" : "LAN (alt)",
    }));
  }

  async close(): Promise<void> {}
}
