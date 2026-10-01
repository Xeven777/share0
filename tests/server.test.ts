import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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

  test("folder share: folder-name download resolves to the first file, not a text 404", async () => {
    // Regression: the receiver page's primary Download button was built from
    // meta.name, which for a folder is "images/". That URL matched no file, so
    // the recipient downloaded a "Not found" plain-text body instead of the png.
    const dir = mkdtempSync(join(tmpdir(), "share-folder-"));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(join(dir, "photo.png"), png);
    const session: ShareSession = {
      id: "f0Ld",
      token: "tok",
      source: { type: "directory", path: dir },
      name: "images/",
      createdAt: Date.now(),
      downloads: 0,
    };
    const handler = createHandler({ session, roots: [dir] });

    const r = await handler(new Request("http://x/s/f0Ld/download/" + encodeURIComponent("images/")));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("content-disposition")).toContain("photo.png");
    expect(Buffer.from(await r.arrayBuffer())).toEqual(png);
  });

  test("folder share: unrelated missing path still 404s (fallback is scoped to the folder)", async () => {
    const { session, dir } = await makeSession();
    const handler = createHandler({ session, roots: [dir] });
    expect((await handler(new Request("http://x/s/t3St/download/nope.txt"))).status).toBe(404);
  });

  test("folder share: download-all archive is named <folder>.zip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "share-folder-"));
    writeFileSync(join(dir, "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const session: ShareSession = {
      id: "z1Pp",
      token: "tok",
      source: { type: "directory", path: dir },
      name: "images/",
      createdAt: Date.now(),
      downloads: 0,
    };
    const handler = createHandler({ session, roots: [dir] });
    const r = await handler(new Request("http://x/s/z1Pp/download-all"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/zip");
    const filename = decodeURIComponent(r.headers.get("content-disposition") ?? "");
    expect(filename).toContain("images.zip");
    expect(filename).not.toContain("/"); // used to be "images/.zip"
    await r.arrayBuffer(); // drain the zip stream so the child process exits
  });

  test("folder share: download-all keeps paths relative to the shared folder", async () => {
    // Regression: `zip` ran with absolute roots, so the archive stored the
    // sender's absolute path ("home/you/holiday-photos/a.png") instead of
    // "holiday-photos/a.png".
    const parent = mkdtempSync(join(tmpdir(), "share-zip-"));
    const dir = join(parent, "holiday-photos");
    mkdirSync(dir);
    writeFileSync(join(dir, "a.png"), Buffer.from([1, 2, 3, 4]));
    const session: ShareSession = {
      id: "z1Pp",
      token: "tok",
      source: { type: "directory", path: dir },
      name: "holiday-photos/",
      createdAt: Date.now(),
      downloads: 0,
    };
    const handler = createHandler({ session, roots: [dir] });
    const buf = Buffer.from(await (await handler(new Request("http://x/s/z1Pp/download-all"))).arrayBuffer());
    const raw = buf.toString("latin1");
    expect(raw).toContain("holiday-photos/a.png"); // relative entry name
    expect(raw).not.toContain(basename(parent)); // no absolute sender path
  });

  test("download counter counts one transfer across its range requests", async () => {
    // A single video seek/resume issues many Range GETs; each used to increment
    // the tally, tripping --downloads after one fragmented fetch.
    const dir = mkdtempSync(join(tmpdir(), "share-range-"));
    const file = join(dir, "v.mp4");
    writeFileSync(file, Buffer.alloc(5000, 1));
    const session: ShareSession = {
      id: "r4Ng",
      token: "tok",
      source: { type: "file", path: file },
      name: "v.mp4",
      createdAt: Date.now(),
      downloads: 0,
      maxDownloads: 2,
    };
    const handler = createHandler({ session, roots: [file] });
    await handler(new Request("http://x/s/r4Ng/download/v.mp4", { headers: { range: "bytes=0-99" } }));
    await handler(new Request("http://x/s/r4Ng/download/v.mp4", { headers: { range: "bytes=100-199" } }));
    expect(session.downloads).toBe(1); // opening + seek = one download
    await handler(new Request("http://x/s/r4Ng/download/v.mp4")); // fresh full download
    expect(session.downloads).toBe(2);
    // An inline preview (what the receiver page shows) must not consume quota.
    await handler(new Request("http://x/s/r4Ng/preview/v.mp4"));
    expect(session.downloads).toBe(2);
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
