import type { Endpoint, OpenOptions, Transport, TransportStatus } from "./types.ts";

// Phase 4 — direct browser-to-browser-style P2P via WebRTC DataChannel.
// Sender side runs on werift (pure TypeScript, Bun-compatible). Signaling
// (offer/answer) travels over the sender's own HTTP server — signaling never
// carries file bytes. No TURN: if ICE can't establish a direct path, the
// engine falls back to LAN/tunnel automatically.

export const P2P_CHUNK = 64 * 1024;
export const P2P_STUN = ["stun:stun.l.google.com:19302"];
// Fixed UDP range for ICE/DTLS so host firewalls can allow P2P with one rule:
//   sudo ufw allow 52000:52100/udp
export const P2P_ICE_PORT_MIN = 52000;
export const P2P_ICE_PORT_MAX = 52100;

export interface P2PFile {
  name: string;
  path: string;
  size: number;
  mime: string;
}

export async function weriftAvailable(): Promise<boolean> {
  try {
    await import("werift");
    return true;
  } catch {
    return false;
  }
}

interface PeerState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pc: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dc: any;
  offerSdp: string;
  answerSet: boolean;
  pumping: boolean;
  getFiles: () => Promise<P2PFile[]>;
  onEvent?: (msg: string) => void;
}

const peers = new Map<string, PeerState>();

function waitFor(condition: () => boolean, timeoutMs: number, stepMs = 100): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (condition()) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, stepMs);
    };
    tick();
  });
}

/** Create the sender peer + offer for a share. Idempotent per session id. */
export async function ensureOffer(
  sessionId: string,
  getFiles: () => Promise<P2PFile[]>,
  onEvent: (msg: string) => void = () => {}
): Promise<string> {
  const existing = peers.get(sessionId);
  if (existing) return existing.offerSdp;

  const { RTCPeerConnection } = await import("werift");
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: P2P_STUN }],
    icePortRange: [P2P_ICE_PORT_MIN, P2P_ICE_PORT_MAX],
  });
  const dc = pc.createDataChannel("share", {});
  const state: PeerState = { pc, dc, offerSdp: "", answerSet: false, pumping: false, getFiles, onEvent };
  peers.set(sessionId, state);

  dc.onopen = () => {
    onEvent("p2p connected — sending via DataChannel");
    void pumpFiles(sessionId).catch((e) => onEvent(`p2p send failed: ${(e as Error).message}`));
  };
  pc.onconnectionstatechange = () => onEvent(`p2p state: ${pc.connectionState}`);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // Skip trickle: wait for full gathering so the offer is self-contained (QR-friendly).
  await waitFor(() => pc.iceGatheringState === "complete", 8000);
  const sdp = pc.localDescription?.sdp ?? offer.sdp;
  state.offerSdp = sdp;
  return sdp;
}

export function getOffer(sessionId: string): string | null {
  return peers.get(sessionId)?.offerSdp ?? null;
}

/** Complete the handshake with the browser's answer; file pump starts on channel open. */
export async function submitAnswer(sessionId: string, answerSdp: string): Promise<void> {
  const state = peers.get(sessionId);
  if (!state) throw new Error("No P2P offer for this share (sender may have disabled P2P).");
  if (state.answerSet) return;
  await state.pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  state.answerSet = true;
}

async function pumpFiles(sessionId: string): Promise<void> {
  const state = peers.get(sessionId);
  if (!state || state.pumping) return;
  state.pumping = true;
  const { dc } = state;
  const files = await state.getFiles();
  const send = (data: string | Uint8Array) => {
    // Backpressure: SCTP is reliable+ordered; keep buffer bounded.
    return new Promise<void>((resolve) => {
      const tick = () => {
        try {
          const buffered = typeof dc.bufferedAmount === "number" ? dc.bufferedAmount : 0;
          if (buffered < 2 * 1024 * 1024) {
            dc.send(data as unknown as string);
            resolve();
            return;
          }
        } catch { resolve(); return; }
        setTimeout(tick, 25);
      };
      tick();
    });
  };
  for (const f of files) {
    await send(JSON.stringify({ t: "meta", name: f.name, size: f.size, mime: f.mime }));
    const file = Bun.file(f.path);
    for (let off = 0; off < file.size; off += P2P_CHUNK) {
      const chunk = new Uint8Array(await file.slice(off, off + P2P_CHUNK).arrayBuffer());
      await send(chunk);
    }
    await send(JSON.stringify({ t: "end", name: f.name }));
    state.onEvent?.(`p2p sent ${f.name}`);
  }
  await send(JSON.stringify({ t: "bye" }));
}

export async function closePeer(sessionId: string): Promise<void> {
  const state = peers.get(sessionId);
  if (!state) return;
  peers.delete(sessionId);
  try { state.dc?.close(); } catch { /* noop */ }
  try { state.pc?.close(); } catch { /* noop */ }
}

export class WebrtcTransport implements Transport {
  name = "webrtc";
  priority = 40;

  async detect(): Promise<TransportStatus> {
    if (await weriftAvailable()) return { available: true, detail: "werift DataChannel ready" };
    return { available: false, detail: "werift not installed" };
  }

  async open(_options: OpenOptions): Promise<Endpoint[]> {
    // Payload-bound setup happens via ensureOffer() in the send flow;
    // this marker keeps the Transport interface uniform.
    return [{ url: "p2p", kind: "p2p", label: "WebRTC" }];
  }

  async close(): Promise<void> {}
}
