import { networkInterfaces } from "node:os";

export interface LanInfo {
  ipv4: string[];
  ipv6: string[];
  primaryIpv4?: string;
}

export function getLanInfo(): LanInfo {
  const nets = networkInterfaces();
  const ipv4: string[] = [];
  const ipv6: string[] = [];
  for (const addrs of Object.values(nets)) {
    for (const a of addrs ?? []) {
      if (a.internal) continue;
      if (a.family === "IPv4") ipv4.push(a.address);
      else if (a.family === "IPv6" && !a.address.startsWith("fe80")) ipv6.push(a.address);
    }
  }
  // Prefer 192.168/10./172.16-31 ranges first
  const score = (ip: string) =>
    ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : ip.startsWith("172.") ? 2 : 3;
  const primaryIpv4 = [...ipv4].sort((a, b) => score(a) - score(b))[0];
  return { ipv4, ipv6, primaryIpv4 };
}

/** Best-guess upstream in Mbps (used for transfer estimation; refined later). */
export function guessUpstreamMbps(): number {
  return 50;
}

export * from "./mdns.ts";
export * from "./firewall.ts";
