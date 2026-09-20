import { createSocket } from "node:dgram";
import { readFile } from "node:fs/promises";
import type { Endpoint, OpenOptions, Transport, TransportStatus } from "./types.ts";

// Phase 3 — direct connectivity via home-router port mapping.
// Short-lived, random external port, removed on exit. Opt-in: only mapped
// when the user passes --upnp/--public (see selectTransports).

export const SSDP_ADDR = "239.255.255.250";
export const SSDP_PORT = 1900;

export function buildSsdpSearch(st: string, mx = 2): string {
  return (
    "M-SEARCH * HTTP/1.1\r\n" +
    `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
    'MAN: "ns=01; ns=01"\r\n' +
    `MX: ${mx}\r\n` +
    `ST: ${st}\r\n\r\n`
  );
}

export function parseSsdpLocation(response: string): string | null {
  const m = /^location:\s*(.+?)\s*$/im.exec(response);
  return m ? m[1].trim() : null;
}

/** Default gateway IP from /proc/net/route (Linux). */
export async function defaultGatewayIp(): Promise<string | null> {
  try {
    const text = await readFile("/proc/net/route", "utf8");
    for (const line of text.split("\n").slice(1)) {
      const [iface, dest, gateway] = line.split(/\s+/);
      if (dest === "00000000" && gateway && iface) {
        // gateway is little-endian hex
        const n = parseInt(gateway, 16);
        return [(n & 0xff), ((n >> 8) & 0xff), ((n >> 16) & 0xff), ((n >> 24) & 0xff)].join(".");
      }
    }
  } catch { /* non-Linux */ }
  return null;
}

export interface IgdService {
  location: string;
  controlUrl: string;
  serviceType: string;
}

/** SSDP discovery of a UPnP InternetGatewayDevice. Returns control URL info. */
export async function upnpDiscover(timeoutMs = 3000): Promise<IgdService | null> {
  const sock = createSocket("udp4");
  try {
    const locations = await new Promise<string[]>((resolve) => {
      const found = new Set<string>();
      sock.on("message", (msg) => {
        const loc = parseSsdpLocation(msg.toString("latin1"));
        if (loc) found.add(loc);
      });
      sock.bind(0, () => {
        for (const st of ["urn:schemas-upnp-org:device:InternetGatewayDevice:1", "urn:schemas-upnp-org:service:WANIPConnection:1"]) {
          sock.send(buildSsdpSearch(st), SSDP_PORT, SSDP_ADDR);
        }
      });
      setTimeout(() => resolve([...found]), timeoutMs);
    });
    for (const loc of locations) {
      const svc = await igdServiceFromDescription(loc).catch(() => null);
      if (svc) return svc;
    }
    return null;
  } finally {
    try { sock.close(); } catch { /* noop */ }
  }
}

async function igdServiceFromDescription(location: string): Promise<IgdService | null> {
  const res = await fetch(location);
  if (!res.ok) return null;
  const xml = await res.text();
  const base = new URL(location);
  // Find WANIPConnection or WANPPPConnection service block
  const svcRe = /<service>([\s\S]*?)<\/service>/g;
  let m: RegExpExecArray | null;
  while ((m = svcRe.exec(xml))) {
    const block = m[1];
    const type = /<serviceType>([^<]+)<\/serviceType>/.exec(block)?.[1] ?? "";
    if (type.includes("WANIPConnection") || type.includes("WANPPPConnection")) {
      const control = /<controlURL>([^<]+)<\/controlURL>/.exec(block)?.[1];
      if (!control) continue;
      const controlUrl = new URL(control, base).toString();
      return { location, controlUrl, serviceType: type.trim() };
    }
  }
  return null;
}

export function buildSoapEnvelope(serviceType: string, action: string, args: Record<string, string | number>): string {
  const inner = Object.entries(args).map(([k, v]) => `<${k}>${v}</${k}>`).join("");
  return (
    `<?xml version="1.0"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body><u:${action} xmlns:u="${serviceType}">${inner}</u:${action}></s:Body></s:Envelope>`
  );
}

async function soap(controlUrl: string, serviceType: string, action: string, args: Record<string, string | number>): Promise<string> {
  const res = await fetch(controlUrl, {
    method: "POST",
    headers: {
      "content-type": 'text/xml; charset="utf-8"',
      soapaction: `"${serviceType}#${action}"`,
    },
    body: buildSoapEnvelope(serviceType, action, args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`UPnP ${action} failed (${res.status}): ${text.slice(0, 200)}`);
  return text;
}

export async function upnpExternalIp(svc: IgdService): Promise<string | null> {
  try {
    const xml = await soap(svc.controlUrl, svc.serviceType, "GetExternalIPAddress", {});
    return /<NewExternalIPAddress>([^<]*)<\/NewExternalIPAddress>/.exec(xml)?.[1] ?? null;
  } catch {
    return null;
  }
}

export interface MappingRequest {
  internalPort: number;
  internalClient: string;
  externalPort: number;
  leaseSeconds?: number;
  description?: string;
}

export async function upnpAddMapping(svc: IgdService, req: MappingRequest): Promise<void> {
  await soap(svc.controlUrl, svc.serviceType, "AddPortMapping", {
    NewRemoteHost: "",
    NewExternalPort: req.externalPort,
    NewProtocol: "TCP",
    NewInternalPort: req.internalPort,
    NewInternalClient: req.internalClient,
    NewEnabled: 1,
    NewPortMappingDescription: req.description ?? "share (temporary)",
    NewLeaseDuration: req.leaseSeconds ?? 3600,
  });
}

export async function upnpDeleteMapping(svc: IgdService, externalPort: number): Promise<void> {
  try {
    await soap(svc.controlUrl, svc.serviceType, "DeletePortMapping", {
      NewRemoteHost: "",
      NewExternalPort: externalPort,
      NewProtocol: "TCP",
    });
  } catch { /* best-effort teardown */ }
}

// --- NAT-PMP (RFC 6886): UDP to gateway port 5351 ---
export const NAT_PMP_PORT = 5351;

/** RFC 6886 §3.5 result codes. */
export const NAT_PMP_RESULT_NAMES: Record<number, string> = {
  0: "Success",
  1: "Unsupported Version",
  2: "Not Authorized/Refused",
  3: "Network Failure",
  4: "Out of resources",
  5: "Unsupported opcode",
};

export function natpmpResultName(code: number): string {
  return NAT_PMP_RESULT_NAMES[code] ?? `Unknown (${code})`;
}
export function natPmpMapRequest(internalPort: number, externalPort: number, lifetime = 3600): Buffer {
  const buf = Buffer.alloc(12);
  buf[0] = 0;
  buf[1] = 2;
  // bytes 2-3 reserved (0), 4-5 internal port... RFC: ver(1) op(1) rsv(2) intport(2) extport(2) lifetime(4)
  buf.writeUInt16BE(internalPort, 4);
  buf.writeUInt16BE(externalPort, 6);
  buf.writeUInt32BE(lifetime, 8);
  return buf;
}

export interface NatPmpResult {
  externalPort: number;
  lifetime: number;
}

export interface NatPmpMapResponse {
  resultCode: number;
  epoch: number;
  internalPort: number;
  externalPort: number;
  lifetime: number;
}

/** Parse + validate a NAT-PMP MAP response (RFC 6886 §3.3, 16 bytes).
 *  Returns null for short/foreign packets; the caller must still check
 *  `resultCode` (non-zero = gateway refused the mapping). */
export function parseNatPmpMapResponse(msg: Buffer): NatPmpMapResponse | null {
  if (msg.length < 16) return null;
  if (msg[0] !== 0) return null;
  if (msg[1] !== 130) return null; // 128 + MAP-TCP(2)
  return {
    resultCode: msg.readUInt16BE(2),
    epoch: msg.readUInt32BE(4),
    internalPort: msg.readUInt16BE(8),
    externalPort: msg.readUInt16BE(10),
    lifetime: msg.readUInt32BE(12),
  };
}

/** Send one NAT-PMP request with RFC 6886 §3.1 retransmission (250ms,
 *  doubling) until `timeoutMs`; resolves with the first well-formed
 *  response matching `expectOp`, or null when the gateway stays silent. */
function natpmpRoundTrip(
  gateway: string,
  request: Buffer,
  expectOp: number,
  timeoutMs: number,
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const sock = createSocket("udp4");
    let done = false;
    let delay = 250;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (v: Buffer | null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try { sock.close(); } catch { /* noop */ }
      resolve(v);
    };
    const deadline = setTimeout(() => finish(null), timeoutMs);
    const send = () => {
      if (done) return;
      sock.send(request, NAT_PMP_PORT, gateway, () => {});
      timer = setTimeout(send, delay);
      delay = Math.min(delay * 2, 2000);
    };
    sock.on("message", (msg: Buffer) => {
      if (msg.length >= 8 && msg[0] === 0 && msg[1] === expectOp) finish(msg);
    });
    sock.on("error", () => { clearTimeout(deadline); finish(null); });
    send();
  });
}

/** Query the gateway's external IPv4 address (RFC 6886 §3.2, opcode 0).
 *  Null = gateway doesn't implement/answer NAT-PMP. */
export async function natpmpPublicAddress(gateway: string, timeoutMs = 3000): Promise<string | null> {
  const req = Buffer.alloc(2);
  req[0] = 0;
  req[1] = 0;
  const msg = await natpmpRoundTrip(gateway, req, 128, timeoutMs);
  if (!msg || msg.length < 12) return null;
  if (msg.readUInt16BE(2) !== 0) return null;
  return `${msg[8]}.${msg[9]}.${msg[10]}.${msg[11]}`;
}

export async function natpmpMap(gateway: string, internalPort: number, externalPort: number, lifetime = 3600, timeoutMs = 5000): Promise<NatPmpResult | null> {
  const msg = await natpmpRoundTrip(gateway, natPmpMapRequest(internalPort, externalPort, lifetime), 130, timeoutMs);
  if (!msg) return null; // silent gateway: unsupported or filtered
  const res = parseNatPmpMapResponse(msg);
  if (!res) return null;
  // Ignore stale responses for a different internal port (no xids on the wire).
  if (res.internalPort !== internalPort) return null;
  if (res.resultCode !== 0) {
    throw new Error(`NAT-PMP mapping refused (${res.resultCode}: ${natpmpResultName(res.resultCode)})`);
  }
  return { externalPort: res.externalPort, lifetime: res.lifetime };
}

export function randomExternalPort(): number {
  const buf = new Uint8Array(2);
  crypto.getRandomValues(buf);
  return 49152 + (((buf[0] << 8) | buf[1]) % 16383);
}

export class UpnpTransport implements Transport {
  name = "upnp";
  priority = 30;
  private svc: IgdService | null = null;
  private externalPort: number | null = null;
  private natpmpGateway: string | null = null;
  private natpmpInternalPort: number | null = null;
  private internalClient = "";

  async detect(): Promise<TransportStatus> {
    const svc = await upnpDiscover(2500).catch(() => null);
    if (svc) {
      this.svc = svc;
      const ip = await upnpExternalIp(svc);
      return { available: true, detail: ip ? `IGD found, external ${ip}` : "IGD found" };
    }
    const gw = await defaultGatewayIp();
    if (gw) {
      // Verify the gateway actually speaks NAT-PMP (opcode 0 probe) instead
      // of claiming availability from the routing table alone — most ISP
      // routers stay silent here, and mapping would just time out in open().
      const ext = await natpmpPublicAddress(gw, 2000).catch(() => null);
      if (ext) {
        return { available: true, detail: `no UPnP IGD; NAT-PMP via ${gw} (external ${ext})` };
      }
      return { available: false, detail: `no UPnP IGD; gateway ${gw} doesn't answer NAT-PMP` };
    }
    return { available: false, detail: "no IGD and no gateway found" };
  }

  async open(options: OpenOptions): Promise<Endpoint[]> {
    const { getLanInfo } = await import("@share/discovery");
    this.internalClient = getLanInfo().primaryIpv4 ?? "127.0.0.1";
    const externalPort = randomExternalPort();

    if (this.svc ?? (await upnpDiscover(2500).catch(() => null))) {
      this.svc ??= (await upnpDiscover(2500).catch(() => null))!;
      try {
        await upnpAddMapping(this.svc, {
          internalPort: options.port,
          internalClient: this.internalClient,
          externalPort,
          leaseSeconds: 3600,
        });
        this.externalPort = externalPort;
        const ip = (await upnpExternalIp(this.svc)) ?? "external-ip";
        return [{ url: `http://${ip}:${externalPort}`, kind: "direct", label: "UPnP" }];
      } catch (e) {
        throw new Error(`UPnP mapping failed: ${(e as Error).message}`);
      }
    }

    const gw = (this.natpmpGateway ??= await defaultGatewayIp());
    if (!gw) throw new Error("No gateway for NAT-PMP");
    const res = await natpmpMap(gw, options.port, externalPort);
    if (!res) throw new Error(`NAT-PMP gateway ${gw} didn't respond (unsupported or filtered)`);
    this.externalPort = res.externalPort;
    this.natpmpInternalPort = options.port;
    // Advertise the gateway's *public* address: the mapping lives on it, not
    // on the gateway's LAN address.
    const extIp = await natpmpPublicAddress(gw, 2000).catch(() => null);
    return [{ url: `http://${extIp ?? gw}:${res.externalPort}`, kind: "direct", label: "NAT-PMP" }];
  }

  async close(): Promise<void> {
    if (this.svc && this.externalPort) await upnpDeleteMapping(this.svc, this.externalPort);
    if (this.natpmpGateway && this.externalPort) {
      // NAT-PMP delete = re-map same ports with lifetime 0.
      await natpmpMap(this.natpmpGateway, this.natpmpInternalPort ?? 0, this.externalPort, 0, 1200).catch(() => null);
    }
    this.svc = null;
    this.externalPort = null;
    this.natpmpInternalPort = null;
  }
}
