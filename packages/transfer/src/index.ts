import { estimateSeconds } from "@share/core";

export interface ProviderCaps {
  maxSessionDuration?: number; // seconds
  bandwidthLimit?: number; // bytes total (approx)
  dailyTransferLimit?: number;
  supportsHttps: boolean;
  supportsCustomHost: boolean;
  supportsLongLivedSessions: boolean;
}

/** Decide whether a provider session can plausibly finish a transfer. */
export function fitsSession(sizeBytes: number, upstreamMbps: number, caps: ProviderCaps): boolean {
  if (caps.maxSessionDuration == null) return true;
  return estimateSeconds(sizeBytes, upstreamMbps) <= caps.maxSessionDuration * 0.9;
}
