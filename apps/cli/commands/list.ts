import { formatBytes, formatDuration } from "@share/core";
import { loadRecords, type ShareRecord } from "@share/core/store";
import { getLanInfo } from "@share/discovery";

/** If the machine's network changed since the share started (new Wi-Fi,
 *  hotspot, VPN), the stored URL may point at a stale IP. Returns current
 *  candidate URLs for the same share id/port, or null when stored URL is fine. */
export function staleNetworkCandidates(record: ShareRecord, currentIps: string[]): string[] | null {
  let host = "";
  try { host = new URL(record.url).hostname.replace(/^\[|\]$/g, ""); } catch { return null; }
  if (host === "127.0.0.1" || host === "::1" || host === "localhost") return null;
  if (currentIps.includes(host)) return null;
  return currentIps.map((ip) => `http://${ip}:${record.port}/s/${record.id}/`);
}

export function runList(): void {
  const records = loadRecords();
  if (!records.length) {
    console.log("No active shares.");
    return;
  }
  const rows = records.map((r) => ({
    ID: r.id,
    NAME: r.name,
    SIZE: r.size != null ? formatBytes(r.size) : "—",
    DOWNLOADS: r.maxDownloads ? `0 / ${r.maxDownloads}` : "0 / ∞",
    EXPIRES: r.expiresAt ? formatDuration(r.expiresAt - Date.now()) : "on exit",
    URL: r.url,
  }));
  console.table(rows);

  // Stale-network check: the share was started on an IP this machine no
  // longer has (switched Wi-Fi/hotspot/VPN since). The server still runs on
  // 0.0.0.0 — only the printed URL is wrong — so show live candidates.
  const currentIps = getLanInfo().ipv4;
  for (const r of records) {
    const candidates = staleNetworkCandidates(r, currentIps);
    if (candidates) {
      console.log(`\n⚠ ${r.id}: network changed since share started (stored URL is stale).`);
      console.log(`  The share is still running — try these current addresses:`);
      for (const u of candidates) console.log(`    ${u}`);
    }
  }
}
