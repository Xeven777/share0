import { fitsSession } from "@share/transfer";
import { allTunnelAdapters } from "./providers.ts";
import { probeTunnelHealthy } from "./base.ts";
import type { ProviderCapabilities, Transport } from "../types.ts";

// Tunnel selection for `send` (serving files) and `receive` (an inbox that
// needs to be reachable from another network). Both used to carry their own
// copy of this logic.
//
// Retrying until a provider answers is required, not defensive. Several
// providers return a URL before their edge can route to it; cloudflared quick
// tunnels measured 404 and 530 for over 60s on some networks. A link that has
// not been probed is a link that may not work, so nothing is returned until
// /health answers.

export interface TunnelCandidate {
  name: string;
  /** Set when `available`: the adapter that can be opened. */
  adapter?: Transport;
  available: boolean;
  detail?: string;
  priority: number;
  capabilities?: ProviderCapabilities;
  installHint?: string;
}

export interface DetectResult {
  /** All known providers, priority order, including unavailable ones. */
  candidates: TunnelCandidate[];
  /** Subset that is usable right now. */
  ready: TunnelCandidate[];
  notes: string[];
}

/** Ask every adapter whether it can run here. Never throws; a provider that
 *  fails to probe is reported as unavailable rather than aborting the run. */
export async function detectTunnels(
  onLog: (msg: string) => void = () => {}
): Promise<DetectResult> {
  const candidates: TunnelCandidate[] = [];
  for (const t of [...allTunnelAdapters].sort((a, b) => a.priority - b.priority)) {
    let status;
    try {
      status = await t.detect();
    } catch (e) {
      status = { available: false, detail: `detect failed: ${(e as Error).message}` };
    }
    const meta = t as Transport & { capabilities?: ProviderCapabilities; installHint?: string };
    onLog(`  ${status.available ? "✓" : "·"} ${t.name}${status.detail ? ` (${status.detail})` : ""}`);
    candidates.push({
      name: t.name,
      adapter: status.available ? t : undefined,
      available: status.available,
      detail: status.detail,
      priority: t.priority,
      capabilities: meta.capabilities,
      installHint: meta.installHint,
    });
  }
  return { candidates, ready: candidates.filter((c) => c.available), notes: [] };
}

/** Narrow to a user-requested provider. `auto`/`ask`/undefined mean "all".
 *  Throws on an unknown name so a typo fails loudly instead of silently
 *  falling back to some other provider. */
export function filterPreferred(candidates: TunnelCandidate[], preferredTunnel?: string): TunnelCandidate[] {
  const want = preferredTunnel?.toLowerCase();
  if (!want || want === "auto" || want === "ask") return candidates;
  const picked = candidates.filter((c) => c.name.toLowerCase() === want);
  if (!picked.length) {
    throw new Error(
      `Unknown tunnel provider "${preferredTunnel}". Available: auto, ask, ${allTunnelAdapters.map((t) => t.name).join(", ")}`
    );
  }
  return picked;
}

export interface OpenTunnelOptions {
  port: number;
  /** Size of the payload, used only to prefer providers whose free quota fits. */
  sizeBytes?: number;
  upstreamMbps?: number;
  preferredTunnel?: string;
  onLog?: (msg: string) => void;
  /** Per-provider ceiling for the /health verification probe. */
  verifyTimeoutMs?: number;
}

export interface OpenTunnelResult {
  url: string;
  label: string;
  /** Opened adapters. The caller must close() these on exit or the tunnel
   *  process outlives the share. */
  opened: Transport[];
  notes: string[];
}

/** Open the first tunnel that actually routes traffic.
 *
 *  Order: an explicit `--tunnel` wins, then providers whose free quota fits
 *  the transfer (so a 40 GB share does not land on a 5 GB/day quota), then the
 *  rest. One link per session; traffic is never split across providers to
 *  dodge quotas.
 *
 *  Returns notes rather than throwing when nothing works. A share with no
 *  tunnel is still a working LAN share, and the caller decides whether to
 *  warn or exit. */
export async function openTunnel(opts: OpenTunnelOptions): Promise<OpenTunnelResult> {
  const onLog = opts.onLog ?? (() => {});
  const notes: string[] = [];
  const opened: Transport[] = [];
  const { candidates } = await detectTunnels(onLog);
  const available = filterPreferred(candidates, opts.preferredTunnel).filter((c) => c.available);
  if (!available.length) {
    notes.push("No tunnel provider available.");
    return { url: "", label: "", opened, notes };
  }

  // Prefer providers whose session plausibly fits the transfer.
  let ordered = available;
  if (opts.sizeBytes != null && opts.sizeBytes > 0) {
    const upstream = opts.upstreamMbps ?? 0;
    const fits = (c: TunnelCandidate): boolean => {
      try {
        return fitsSession(opts.sizeBytes!, upstream, c.capabilities as never);
      } catch {
        return true; // unknown capabilities never disqualify a provider
      }
    };
    const preferred = available.filter(fits);
    ordered = [...preferred, ...available.filter((c) => !fits(c))];
    if (preferred.length < available.length) {
      const mbps = upstream > 0 ? Math.ceil((opts.sizeBytes * 8) / (upstream * 1_000_000) / 60) : null;
      notes.push(
        `Estimated transfer ${mbps != null ? `${mbps} min` : "of unknown length"}; preferring providers that fit the session.`
      );
    }
  }

  for (const c of ordered) {
    onLog(`  → opening ${c.name}…`);
    let url = "";
    try {
      const eps = await c.adapter!.open({ port: opts.port });
      url = eps[0]?.url ?? "";
    } catch (e) {
      notes.push(`${c.name} failed: ${(e as Error).message}`);
      continue;
    }
    if (!url) {
      notes.push(`${c.name} returned no URL — trying next.`);
      continue;
    }
    onLog(`  → verifying ${c.name} routes traffic…`);
    if (await probeTunnelHealthy(url, opts.verifyTimeoutMs ?? 60_000)) {
      opened.push(c.adapter!);
      notes.push(`Public via ${c.name}.`);
      return { url, label: c.name, opened, notes };
    }
    notes.push(`${c.name} opened but traffic didn't route (skipped) — trying next.`);
    try { await c.adapter!.close(); } catch { /* noop */ }
  }

  notes.push("No tunnel provider routed traffic.");
  return { url: "", label: "", opened, notes };
}

/** Close every adapter opened by openTunnel. Never throws. */
export async function closeTunnels(opened: Transport[]): Promise<void> {
  for (const t of opened) {
    try { await t.close(); } catch { /* noop */ }
  }
}
