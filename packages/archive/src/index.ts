import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

/** Create a ZIP archive. Prefers archiver-zip-encrypted when a password is set,
 *  falls back to the system `zip` binary, then to an unencrypted archiver build. */
export async function createZip(paths: string[], outPath: string, password?: string): Promise<void> {
  if (password) {
    try {
      await createZipEncrypted(paths, outPath, password);
      return;
    } catch {
      // fall through to system zip
    }
    await createZipSystem(paths, outPath, password);
    return;
  }
  // No password: try archiver, else system zip
  try {
    const archiver = (await import("archiver")).default;
    await new Promise<void>((resolve, reject) => {
      // @ts-expect-error - Bun file writer interop
      const output = require("node:fs").createWriteStream(outPath);
      const archive = archiver("zip", { zlib: { level: 6 } });
      output.on("close", () => resolve());
      archive.on("error", reject);
      archive.pipe(output);
      for (const p of paths) {
        const st = statSync(p);
        if (st.isDirectory()) archive.directory(p, p.split("/").pop() ?? "dir");
        else archive.file(p, { name: p.split("/").pop()! });
      }
      archive.finalize();
    });
    return;
  } catch {
    await createZipSystem(paths, outPath, undefined);
  }
}

async function createZipEncrypted(paths: string[], outPath: string, password: string): Promise<void> {
  const mod = await import("archiver-zip-encrypted").catch(() => null);
  if (!mod) throw new Error("archiver-zip-encrypted not installed");
  const archiver = (mod.default ?? mod) as typeof import("archiver").default;
  await new Promise<void>((resolve, reject) => {
    const { createWriteStream } = require("node:fs") as typeof import("node:fs");
    const output = createWriteStream(outPath);
    // @ts-expect-error - plugin registers "zip-encrypted"
    const archive = archiver("zip-encrypted", { zlib: { level: 6 }, encryptionMethod: "aes256", password });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);
    for (const p of paths) {
      const st = statSync(p);
      if (st.isDirectory()) archive.directory(p, p.split("/").pop() ?? "dir");
      else archive.file(p, { name: p.split("/").pop()! });
    }
    archive.finalize();
  });
}

function createZipSystem(paths: string[], outPath: string, password?: string): Promise<void> {
  return new Promise((resolveP, reject) => {
    const missing = paths.filter((p) => !existsSync(p));
    if (missing.length) return reject(new Error(`No such file: ${missing[0]}`));
    // Run from a shared base directory with relative paths so the archive keeps
    // the shared name (folder/…) instead of the sender's absolute path.
    const { cwd, names } = zipInvocation(paths);
    const args = ["-qr", outPath, ...names];
    if (password) args.unshift("-P", password);
    const child = spawn("zip", args, { cwd });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      if (code === 0) resolveP();
      else reject(new Error(`zip failed (code ${code}): ${stderr || "is 'zip' installed?"}`));
    });
    child.on("error", (e) => reject(new Error(`zip binary not available: ${(e as Error).message}`)));
  });
}

/** Base directory + relative path arguments for `zip`, so the archive keeps the
 *  shared name (folder/…) rather than the sender's absolute filesystem path. */
function zipInvocation(paths: string[]): { cwd: string; names: string[] } {
  const abs = paths.map((p) => resolve(p));
  const cwd = abs.map((p) => dirname(p)).reduce((a, b) => commonDir(a, b));
  const names = abs.map((p) => {
    const rel = relative(cwd, p);
    return rel === "" ? "." : rel;
  });
  return { cwd, names };
}

/** Longest directory common to two absolute paths (path-segment compare). */
function commonDir(a: string, b: string): string {
  const as = resolve(a).split(sep);
  const bs = resolve(b).split(sep);
  const out: string[] = [];
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    if (as[i] !== bs[i]) break;
    out.push(as[i]!);
  }
  const joined = out.join(sep);
  return joined === "" ? sep : joined;
}
