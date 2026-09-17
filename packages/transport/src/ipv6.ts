import { getLanInfo } from "@share/discovery";
import type { Endpoint, OpenOptions, Transport, TransportStatus } from "./types.ts";

export class Ipv6Transport implements Transport {
  name = "ipv6";
  priority = 20;

  async detect(): Promise<TransportStatus> {
    const info = getLanInfo();
    if (info.ipv6.length > 0) return { available: true, detail: info.ipv6[0] };
    return { available: false, detail: "no global IPv6 address" };
  }

  async open(options: OpenOptions): Promise<Endpoint[]> {
    const info = getLanInfo();
    if (!info.ipv6.length) return [];
    const ip = info.ipv6[0];
    return [{ url: `http://[${ip}]:${options.port}`, kind: "ipv6", label: "IPv6" }];
  }

  async close(): Promise<void> {}
}
