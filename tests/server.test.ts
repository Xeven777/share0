import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword, type ShareSession } from "@share/core";
import { createHandler } from "@share/server";

async function makeSession(over: Partial<ShareSession> = {}): Promise<{ session: ShareSession; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "share-test-"));
  writeFileSync(join(dir, "hello.txt"), "hello world".repeat(100));
  const session: ShareSession = {
    id: "t3St",
    token: "tok",
    source: { type: "directory", path: dir },
    name: "testdir/",
    createdAt: Date.now(),
    downloads: 0,
    ...over,
  };
  return { session, dir };
}

describe("http server", () => {
  test("serves receiver page + metadata + file with range", async () => {
    const { session, dir } = await makeSession();
    const handler = createHandler({ session, roots: [dir] });

    const page = await handler(new Request("http://x/s/t3St/"));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");

    const meta = await handler(new Request("http://x/s/t3St/api/share"));
    expect(meta.status).toBe(200);
    const body = await meta.json();
    expect(body.id).toBe("t3St");
    expect(body.size).toBeGreaterThan(0);

    const files = await (await handler(new Request("http://x/s/t3St/api/files"))).json();
    expect(files).toHaveLength(1);

    const full = await handler(new Request("http://x/s/t3St/download/hello.txt"));
    expect(full.status).toBe(200);
    expect(full.headers.get("accept-ranges")).toBe("bytes");

    const partial = await handler(
      new Request("http://x/s/t3St/download/hello.txt", { headers: { range: "bytes=0-4" } })
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toMatch(/^bytes 0-4\//);
    expect(await partial.text()).toBe("hello");
  });

  test("blocks path traversal", async () => {
    const { session, dir } = await makeSession();
    const handler = createHandler({ session, roots: [dir] });
    const r = await handler(new Request("http://x/s/t3St/download/..%2F..%2Fetc%2Fpasswd"));
    expect(r.status).toBe(404);
  });

  test("password gate returns 401 without password", async () => {
    const { session, dir } = await makeSession({
      password: { enabled: true, hash: await hashPassword("482-719") },
    });
    const handler = createHandler({ session, roots: [dir] });
    expect((await handler(new Request("http://x/s/t3St/api/share"))).status).toBe(401);
    const ok = await handler(new Request("http://x/s/t3St/api/share?password=482-719"));
    expect(ok.status).toBe(200);
  });

  test("expired share returns 410", async () => {
    const { session, dir } = await makeSession({ expiresAt: Date.now() - 1000 });
    const handler = createHandler({ session, roots: [dir] });
    expect((await handler(new Request("http://x/s/t3St/api/share"))).status).toBe(410);
    expect((await handler(new Request("http://x/s/t3St/"))).status).toBe(410);
  });
});
