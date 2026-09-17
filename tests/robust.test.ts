import { describe, expect, test } from "bun:test";
import { buildDetachedArgs } from "../apps/cli/commands/detach.ts";
import { staleNetworkCandidates } from "../apps/cli/commands/list.ts";
import { detectBlockingFirewall, parseUfwConf, p2pUdpFix } from "@share/discovery";
import type { ShareRecord } from "@share/core/store";

function record(url: string): ShareRecord {
  return {
    id: "aZw2", name: "x", url, pid: 1234, port: 8787,
    createdAt: Date.now(), hasPassword: false,
  };
}

describe("detach arg rebuild", () => {
  test("drops --detach, appends --detached-child", () => {
    const realArgv = process.argv;
    try {
      (process as { argv: string[] }).argv = ["bun", "apps/cli/index.ts", "send", "f.txt", "--public", "--detach"];
      const inv = buildDetachedArgs();
      expect(inv?.cmd).toBe("bun");
      expect(inv?.args).toEqual(["apps/cli/index.ts", "send", "f.txt", "--public", "--detached-child"]);
    } finally {
      (process as { argv: string[] }).argv = realArgv;
    }
  });

  test("compiled-binary shape", () => {
    const realArgv = process.argv;
    try {
      (process as { argv: string[] }).argv = ["/usr/local/bin/share", "send", "f.txt", "--detach"];
      const inv = buildDetachedArgs();
      expect(inv?.cmd).toBe("/usr/local/bin/share");
      expect(inv?.args).toEqual(["send", "f.txt", "--detached-child"]);
    } finally {
      (process as { argv: string[] }).argv = realArgv;
    }
  });
});

describe("stale network detection", () => {
  test("null when stored IP still present", () => {
    expect(staleNetworkCandidates(record("http://192.168.0.104:8787/s/aZw2/"), ["192.168.0.104"])).toBeNull();
  });

  test("candidates when network changed", () => {
    const c = staleNetworkCandidates(record("http://192.168.0.104:8787/s/aZw2/"), ["192.168.43.84"]);
    expect(c).toEqual(["http://192.168.43.84:8787/s/aZw2/"]);
  });

  test("loopback stored URL never flagged", () => {
    expect(staleNetworkCandidates(record("http://127.0.0.1:8787/s/aZw2/"), ["192.168.43.84"])).toBeNull();
  });
});

describe("firewall detection", () => {
  test("parses ufw.conf", () => {
    expect(parseUfwConf("ENABLED=yes\n")).toBe(true);
    expect(parseUfwConf("# comment\nENABLED=no\n")).toBe(false);
    expect(parseUfwConf("")).toBe(false);
  });

  test("p2p udp fix strings", () => {
    expect(p2pUdpFix("ufw")).toContain("52000:52100/udp");
    expect(p2pUdpFix("firewalld")).toContain("52000-52100/udp");
  });

  test("detects this machine's active firewall", async () => {
    // This dev machine runs ufw — guards against the root-only regression
    // where doctor reported "no firewall" without privileges.
    const fw = await detectBlockingFirewall(8787);
    expect(fw.active).toBe(true);
    expect(fw.tool).toBe("ufw");
    expect(fw.fix).toContain("8787/tcp");
  });
});
