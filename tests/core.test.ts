import { describe, expect, test } from "bun:test";
import {
  estimateSeconds,
  formatBytes,
  formatDuration,
  generateShortPassword,
  hashPassword,
  nanoid,
  parseExpires,
  verifyPassword,
} from "@share/core";
import { fitsSession } from "@share/transfer";
import { isExpired, mimeFor } from "@share/server";

describe("core", () => {
  test("nanoid alphabet has no ambiguous chars", () => {
    for (let i = 0; i < 50; i++) {
      const id = nanoid(4);
      expect(id).toHaveLength(4);
      expect(id).not.toMatch(/[0OIl1]/);
    }
  });

  test("short password format", () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateShortPassword();
      expect(pw).toMatch(/^[A-Z2-9]{3,4}-[A-Z2-9]{2,3}$/);
    }
  });

  test("password hash + verify roundtrip", async () => {
    const hash = await hashPassword("482-719");
    expect(await verifyPassword("482-719", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  test("parseExpires", () => {
    expect(parseExpires("30m")).toBe(30 * 60_000);
    expect(parseExpires("2h")).toBe(2 * 3_600_000);
    expect(parseExpires("90s")).toBe(90_000);
    expect(parseExpires("1d")).toBe(86_400_000);
    expect(() => parseExpires("bogus")).toThrow();
  });

  test("formatBytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(4.72 * 1024 ** 3)).toMatch(/GB/);
  });

  test("formatDuration", () => {
    expect(formatDuration(-1)).toBe("expired");
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(41 * 60_000)).toBe("41m");
  });

  test("estimateSeconds scales with size", () => {
    const small = estimateSeconds(100 * 1024 ** 2, 50);
    const big = estimateSeconds(42.8 * 1024 ** 3, 50);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeCloseTo(((42.8 * 1024 ** 3 * 8) / 50e6), 0);
  });
});

describe("transfer", () => {
  test("fitsSession rejects long transfers on 60-min tunnels", () => {
    // 42.8 GB at 50 Mbps ≈ 114 min > 60 min session
    expect(fitsSession(42.8 * 1024 ** 3, 50, { maxSessionDuration: 3600, supportsHttps: true, supportsCustomHost: false, supportsLongLivedSessions: false })).toBe(false);
    // 100 MB fits easily
    expect(fitsSession(100 * 1024 ** 2, 50, { maxSessionDuration: 3600, supportsHttps: true, supportsCustomHost: false, supportsLongLivedSessions: false })).toBe(true);
  });
});

describe("server", () => {
  test("mimeFor covers previewable types", () => {
    expect(mimeFor("a.mp4")).toBe("video/mp4");
    expect(mimeFor("a.pdf")).toBe("application/pdf");
    expect(mimeFor("a.unknown-xyz")).toBe("application/octet-stream");
  });

  test("isExpired honors time + download caps", () => {
    const base = { id: "x", token: "t", source: { type: "file", path: "/tmp/x" } as const, name: "x", createdAt: Date.now(), downloads: 0 };
    expect(isExpired({ ...base })).toBe(false);
    expect(isExpired({ ...base, expiresAt: Date.now() - 1000 })).toBe(true);
    expect(isExpired({ ...base, downloads: 1, maxDownloads: 1 })).toBe(true);
  });
});
