export * from "./theme.ts";
export * from "./prompt.ts";

export interface TunnelCandidate {
  name: string;
  available: boolean;
  detail?: string;
  note?: string;
  priority: number;
}

export function tunnelHint(c: TunnelCandidate): string {
  if (!c.available) return c.detail ?? "unavailable";
  return c.note ?? c.detail ?? "ready";
}
