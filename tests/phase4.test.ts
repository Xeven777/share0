import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword, type ShareSession } from "@share/core";
import { createHandler, createReceiveHandler } from "@share/server";

function testSession(over: Partial<ShareSession> = {}): ShareSession {
  return {
    id: "p2pT", token: "t", source: { type: "file", path: "/tmp/x" },
    name: "x", createdAt: Date.now(), downloads: 0, ...over,
  };
}

describe("receive mode", () => {
  test("PUT upload streams to disk, lists via api", async () => {
    const dir = mkdtempSync(join(tmpdir(), "share-recv-"));
    const handler = createReceiveHandler({ dir });
    const put = await handler(
      new Request("http://x/upload/hello.txt", { method: "PUT", body: "hello receive" })
    );
    expect(put.status).toBe(201);
    expect(readFileSync(join(dir, "hello.txt"), "utf8")).toBe("hello receive");
    const api = await (await handler(new Request("http://x/api/receive"))).json();
    expect(api.count).toBe(1);
    expect(api.files[0].name).toBe("hello.txt");
  });

  test("upload page served, unknown routes 404", async () => {
    const dir = mkdtempSync(join(tmpdir(), "share-recv-"));
    const handler = createReceiveHandler({ dir });
    const page = await handler(new Request("http://x/"));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect((await handler(new Request("http://x/nope"))).status).toBe(404);
  });

  test("receive password gate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "share-recv-"));
    const handler = createReceiveHandler({ dir, passwordHash: await hashPassword("111-222") });
    expect((await handler(new Request("http://x/api/receive"))).status).toBe(401);
    expect((await handler(new Request("http://x/api/receive?password=111-222"))).status).toBe(200);
    const denied = await handler(new Request("http://x/upload/a.txt", { method: "PUT", body: "x" }));
    expect(denied.status).toBe(401);
  });
});

describe("webrtc signaling endpoints", () => {
  test("501 when P2P not configured; 400 on bad answer", async () => {
    const handler = createHandler({ session: testSession(), roots: ["/tmp"] });
    expect((await handler(new Request("http://x/s/p2pT/api/webrtc-offer"))).status).toBe(501);

    const withHooks = createHandler({
      session: testSession(),
      roots: ["/tmp"],
      webrtc: {
        getOffer: () => "v=0 fake",
        submitAnswer: async () => { throw new Error("bad sdp"); },
      },
    });
    const offer = await withHooks(new Request("http://x/s/p2pT/api/webrtc-offer"));
    expect(offer.status).toBe(200);
    expect(((await offer.json()) as { offer: string }).offer).toContain("v=0");
    const bad = await withHooks(
      new Request("http://x/s/p2pT/api/webrtc-answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: "junk" }),
      })
    );
    expect(bad.status).toBe(400);
  });

  test("werift offer generation (sender peer)", async () => {
    const { ensureOffer, getOffer, closePeer, weriftAvailable, P2P_ICE_PORT_MIN, P2P_ICE_PORT_MAX } = await import("@share/transport");
    expect(await weriftAvailable()).toBe(true);
    const sdp = await ensureOffer("test-session", async () => []);
    expect(sdp).toContain("v=0");
    expect(getOffer("test-session")).toBe(sdp);
    // ICE must stay inside the firewall-documented UDP range.
    const ports = sdp.split("\r\n").filter((l) => l.startsWith("a=candidate")).map((l) => parseInt(l.split(" ")[5], 10));
    expect(ports.length).toBeGreaterThan(0);
    for (const p of ports) {
      expect(p).toBeGreaterThanOrEqual(P2P_ICE_PORT_MIN);
      expect(p).toBeLessThanOrEqual(P2P_ICE_PORT_MAX);
    }
    await closePeer("test-session");
    expect(getOffer("test-session")).toBeNull();
  }, 20000);

  test("full loopback: answer handshake + DataChannel file pump", async () => {
    const { ensureOffer, submitAnswer, closePeer } = await import("@share/transport");
    const { RTCPeerConnection } = await import("werift");
    const { writeFileSync } = await import("node:fs");
    const payload = "p2p-pump-bytes-".repeat(5000); // ~75 KB, spans multiple chunks
    writeFileSync("/tmp/p2p-loop.txt", payload);

    const sdp = await ensureOffer("loop", async () => [
      { name: "loop.txt", path: "/tmp/p2p-loop.txt", size: Buffer.byteLength(payload), mime: "text/plain" },
    ]);

    const browser = new RTCPeerConnection({ iceServers: [] });
    const received = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("p2p pump timeout")), 25000);
      let chunks: Buffer[] = [];
      browser.ondatachannel = (ev: { channel: { onmessage: ((m: { data: unknown }) => void) | null; binaryType: string } }) => {
        ev.channel.binaryType = "arraybuffer";
        ev.channel.onmessage = (m: { data: unknown }) => {
          if (typeof m.data === "string") {
            const msg = JSON.parse(m.data) as { t: string };
            if (msg.t === "bye") {
              clearTimeout(timer);
              resolve(Buffer.concat(chunks).toString());
            }
          } else {
            chunks.push(Buffer.from(m.data as ArrayBuffer));
          }
        };
      };
      (async () => {
        await browser.setRemoteDescription({ type: "offer", sdp });
        const answer = await browser.createAnswer();
        await browser.setLocalDescription(answer);
        const waitGather = async () => {
          const start = Date.now();
          while ((browser as unknown as { iceGatheringState: string }).iceGatheringState !== "complete") {
            if (Date.now() - start > 8000) break;
            await new Promise((r) => setTimeout(r, 100));
          }
        };
        await waitGather();
        await submitAnswer("loop", (browser as unknown as { localDescription: { sdp: string } }).localDescription.sdp);
      })().catch(reject);
    });

    expect(received).toBe(payload);
    browser.close();
    await closePeer("loop");
  }, 40000);
});
