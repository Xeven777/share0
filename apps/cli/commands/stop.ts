import { findRecord, removeRecord } from "@share/core/store";

export function runStop(id: string): void {
  if (!id) {
    console.error("Usage: share stop <id>");
    process.exit(1);
  }
  const rec = findRecord(id);
  if (!rec) {
    console.error(`No active share with id "${id}".`);
    process.exit(1);
  }
  try {
    process.kill(rec.pid, "SIGTERM");
    console.log(`Stopped share ${id} (pid ${rec.pid}).`);
  } catch {
    console.log(`Process ${rec.pid} already gone; removing record.`);
  }
  removeRecord(id);
}
