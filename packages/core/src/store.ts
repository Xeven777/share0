import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ShareRecord {
  id: string;
  name: string;
  size?: number;
  url: string;
  pid: number;
  port: number;
  createdAt: number;
  expiresAt?: number;
  maxDownloads?: number;
  hasPassword: boolean;
}

function stateDir(): string {
  const dir = process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, "share")
    : join(homedir(), ".local", "share", "share");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function stateFile(): string {
  return join(stateDir(), "shares.json");
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function loadRecords(): ShareRecord[] {
  try {
    const raw = readFileSync(stateFile(), "utf8");
    const arr = JSON.parse(raw) as ShareRecord[];
    // Prune dead processes
    const live = arr.filter((r) => isPidAlive(r.pid));
    if (live.length !== arr.length) saveRecords(live);
    return live;
  } catch {
    return [];
  }
}

export function saveRecords(records: ShareRecord[]): void {
  writeFileSync(stateFile(), JSON.stringify(records, null, 2));
}

export function addRecord(record: ShareRecord): void {
  const records = loadRecords().filter((r) => r.id !== record.id);
  records.push(record);
  saveRecords(records);
}

export function removeRecord(id: string): void {
  saveRecords(loadRecords().filter((r) => r.id !== id));
}

export function findRecord(id: string): ShareRecord | undefined {
  return loadRecords().find((r) => r.id === id);
}
