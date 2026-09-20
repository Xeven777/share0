import { estimateSeconds } from "@share/core";
import { guessUpstreamMbps } from "@share/discovery";
import { fitsSession } from "@share/transfer";
import { Ipv6Transport } from "./ipv6.ts";
import { LanTransport } from "./lan.ts";
import { UpnpTransport } from "./upnp.ts";
import { ensureOffer, weriftAvailable, type P2PFile } from "./webrtc.ts";
import { allTunnelAdapters } from "./tunnels/providers.ts";
import { probeTunnelHealthy } from "./tunnels/base.ts";
import type { Endpoint, Transport } from "./types.ts";

export * from "./types.ts";
export { LanTransport } from "./lan.ts";
export { Ipv6Transport } from "./ipv6.ts";
export { UpnpTransport } from "./upnp.ts";
export { WebrtcTransport, ensureOffer, submitAnswer, getOffer, closePeer, weriftAvailable, P2P_ICE_PORT_MIN, P2P_ICE_PORT_MAX } from "./webrtc.ts";
export { allTunnelAdapters } from "./tunnels/providers.ts";

export interface SelectionRequest {
  sizeBytes: number;
  public: boolean;
  preferredTunnel?: string;
  upstreamMbps?: number;
  /** Request a temporary UPnP/NAT-PMP mapping (opt-in via --upnp/--public). */
  upnp?: boolean;
  /** Set up a WebRTC DataChannel offer automatically (Phase 4). */
  p2p?: {
    sessionId: string;
    getFiles: () => Promise<P2PFile[]>;
    onEvent?: (msg: string) => void;
  };
}

export interface SelectionResult {
  local: Endpoint[];
  public: Endpoint[];
  /** Open tunnel transports (caller must close on exit). */
  opened: Transport[];
  notes: string[];
}

/** Automatic transport selection (product.md §5):
 *  LAN → IPv6 → fitting tunnel → any tunnel. Never splits traffic to dodge quotas. */
export async function selectTransports(
  port: number,
  req: SelectionRequest,
  onLog: (msg: string) => void = () => {}
): Promise<SelectionResult> {
  const notes: string[] = [];
  const opened: Transport[] = [];
  const local: Endpoint[] = [];
  const pub: Endpoint[] = [];

  const upstream = req.upstreamMbps ?? guessUpstreamMbps();
  const est = estimateSeconds(req.sizeBytes, upstream);

  const lan = new LanTransport();
  const lanStatus = await lan.detect();
  if (lanStatus.available) {
    local.push(...(await lan.open({ port })));
  } else {
    notes.push(`LAN unavailable: ${lanStatus.detail}`);
  }

  const v6 = new Ipv6Transport();
  const v6Status = await v6.detect();
  if (v6Status.available) {
    local.push(...(await v6.open({ port })));
  }

  // Direct IPv4 via temporary router mapping (opt-in).
  if (req.upnp) {
    const upnp = new UpnpTransport();
    const st = await upnp.detect();
    onLog(`  ${st.available ? "✓" : "·"} upnp${st.detail ? ` (${st.detail})` : ""}`);
    if (st.available) {
      try {
        const eps = await upnp.open({ port });
        local.push(...eps);
        opened.push(upnp);
        notes.push("Direct IPv4 via temporary UPnP/NAT-PMP mapping (removed on exit).");
      } catch (e) {
        notes.push(`UPnP mapping failed: ${(e as Error).message}`);
        try { await upnp.close(); } catch { /* noop */ }
      }
    } else {
      notes.push(`UPnP unavailable: ${st.detail}`);
    }
  }

  // WebRTC direct P2P offer (automatic when requested; page falls back otherwise).
  // Signaling URLs are published for the LAN base and, when a healthy public
  // tunnel exists, for the public base too (signaling via tunnel, bytes P2P).
  const setupP2p = async () => {
    if (!req.p2p || !(await weriftAvailable())) return;
    try {
      await ensureOffer(req.p2p.sessionId, req.p2p.getFiles, req.p2p.onEvent ?? (() => {}));
      const base = local[0]?.url ?? `http://127.0.0.1:${port}`;
      local.push({ url: `${base}/s/${req.p2p.sessionId}/?p2p=1`, kind: "p2p", label: "WebRTC direct" });
      if (pub.length) {
        local.push({ url: `${pub[0].url}/s/${req.p2p.sessionId}/?p2p=1`, kind: "p2p", label: "WebRTC direct (via tunnel signaling)" });
      }
      notes.push("WebRTC direct P2P offer ready (signaling via this server only).");
    } catch (e) {
      notes.push(`WebRTC setup failed: ${(e as Error).message} — continuing without P2P.`);
    }
  };

  if (!req.public) {
    notes.push("Public sharing off (use --public to expose via tunnel).");
    await setupP2p();
    return { local, public: pub, opened, notes };
  }

  let candidates = [...allTunnelAdapters];
  if (req.preferredTunnel) {
    const want = req.preferredTunnel.toLowerCase();
    if (want !== "auto" && want !== "ask") {
      candidates = candidates.filter((t) => t.name.toLowerCase() === want);
      if (!candidates.length) throw new Error(`Unknown tunnel provider "${req.preferredTunnel}". Available: auto, ask, ${allTunnelAdapters.map((t) => t.name).join(", ")}`);
    }
  }

  // Check availability in priority order
  const available: typeof candidates = [];
  for (const t of candidates.sort((a, b) => a.priority - b.priority)) {
    const st = await t.detect();
    onLog(`  ${st.available ? "✓" : "·"} ${t.name}${st.detail ? ` (${st.detail})` : ""}`);
    if (st.available) available.push(t);
    else notes.push(`${t.name}: ${st.detail}`);
  }
  if (!available.length) {
    notes.push("No tunnel provider available. Share stays LAN-only.");
    return { local, public: pub, opened, notes };
  }

  // Prefer providers whose session plausibly fits the transfer
  const fitting = available.filter((t) =>
    fitsSession(req.sizeBytes, upstream, (t as unknown as { capabilities: Parameters<typeof fitsSession>[2] }).capabilities)
  );
  const ordered = [...fitting, ...available.filter((t) => !fitting.includes(t))];
  if (fitting.length < available.length) {
    notes.push(
      `Estimated transfer ${Math.ceil(est / 60)} min at ~${upstream} Mbps upstream; preferring providers that fit the session.`
    );
  }

  // Open + verify each candidate in order; print only links proven to route.
  // (Some providers issue a URL before edge routing exists — e.g. cloudflare
  // quick tunnels can 404/530 for a minute+. We never show a dead link.)
  let healthy = false;
  for (const t of ordered) {
    onLog(`  → opening ${t.name}…`);
    let eps: Endpoint[] = [];
    try {
      eps = await t.open({ port });
    } catch (e) {
      notes.push(`${t.name} failed: ${(e as Error).message}`);
      continue;
    }
    const url = eps[0]?.url ?? "";
    onLog(`  → verifying ${t.name} routes traffic…`);
    if (url && (await probeTunnelHealthy(url, 60_000))) {
      pub.push(...eps);
      opened.push(t);
      notes.push(`Public via ${t.name}.`);
      healthy = true;
      break;
    }
    notes.push(`${t.name} opened but traffic didn't route (skipped) — trying next.`);
    try { await t.close(); } catch { /* noop */ }
  }
  if (!healthy) {
    notes.push("No tunnel provider routed traffic. Share stays LAN-only (see troubleshooting in README).");
  }

  await setupP2p();

  return { local, public: pub, opened, notes };
}
