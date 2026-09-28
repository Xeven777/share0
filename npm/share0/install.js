#!/usr/bin/env node
// Download the prebuilt share0 binary for this platform from GitHub Releases.
// Version-pinned: npm share0@x.y.z fetches GitHub tag vx.y.z, so the two
// never drift. Verifies sha256 against checksums.txt before installing.
"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const { homedir } = require("node:os");
const path = require("node:path");

const REPO = "Xeven777/share0";
const VERSION = require("./package.json").version;
const TAG = `v${VERSION}`;

function platformBinary() {
  const os =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "darwin"
        : process.platform === "linux"
          ? "linux"
          : null;
  const arch =
    process.arch === "x64"
      ? "x64"
      : process.arch === "arm64"
        ? "arm64"
        : null;
  if (!os || !arch) return null;
  // Only these four have release assets. linux-arm64 has no binary yet.
  if (os === "linux" && arch !== "x64") return null;
  const name =
    os === "windows" ? "share0-windows-x64.exe" : `share0-${os}-${arch}`;
  return { os, arch, name };
}

function cacheDir() {
  const base =
    process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache");
  return path.join(base, "share0", TAG);
}

function targetPath(binaryName) {
  // Global installs can't always write next to the package (root-owned
  // lib/node_modules), so the binary lives in the user cache. The bin shim
  // resolves this same path at runtime.
  return path.join(cacheDir(), binaryName.replace(/\.exe$/, ""));
}

async function fetchBuf(url, redirects = 5) {
  const lib = url.startsWith("https:") ? require("node:https") : require("node:http");
  return new Promise((resolve, reject) => {
    lib
      .get(url, { headers: { "User-Agent": "share0-npm-installer" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirects === 0) return reject(new Error(`Too many redirects fetching ${url}`));
          res.resume();
          return fetchBuf(res.headers.location, redirects - 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`GET ${url} -> ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  // Skip in CI smoke tests that only need the JS layout, not an 80MB binary.
  if (process.env.SHARE0_SKIP_DOWNLOAD) {
    console.log("share0: SHARE0_SKIP_DOWNLOAD set, skipping binary download.");
    return;
  }
  const plat = platformBinary();
  if (!plat) {
    console.error(
      `share0: no prebuilt binary for ${process.platform}-${process.arch}. ` +
        `See https://github.com/${REPO}/releases for supported platforms.`
    );
    return;
  }
  const dest = targetPath(plat.name);
  if (fs.existsSync(dest)) {
    console.log(`share0: binary already cached at ${dest}`);
    return;
  }
  const base = `https://github.com/${REPO}/releases/download/${TAG}`;
  console.log(`share0: downloading ${plat.name} ${TAG} (~80MB)...`);
  let binary;
  try {
    binary = await fetchBuf(`${base}/${plat.name}`);
  } catch (e) {
    console.error(`share0: download failed: ${e.message}`);
    console.error(`  Tried ${base}/${plat.name}`);
    console.error(`  Install manually: https://github.com/${REPO}/releases/tag/${TAG}`);
    return;
  }
  // Verify checksum before writing. A mismatch means a corrupt download or a
  // compromised mirror, either way refuse to install.
  try {
    const sums = (await fetchBuf(`${base}/checksums.txt`)).toString("utf8");
    const line = sums.split("\n").find((l) => l.trim().endsWith(`  ${plat.name}`));
    const expected = line ? line.split(/\s+/)[0] : null;
    const actual = createHash("sha256").update(binary).digest("hex");
    if (!expected || expected !== actual) {
      throw new Error(`checksum mismatch (expected ${expected ?? "unknown"}, got ${actual})`);
    }
    console.log("share0: checksum ok.");
  } catch (e) {
    console.error(`share0: checksum verification failed: ${e.message}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = path.join(path.dirname(dest), `.share0-${process.pid}.part`);
  fs.writeFileSync(tmp, binary);
  try {
    fs.chmodSync(tmp, 0o755);
  } catch { /* windows: no chmod */ }
  fs.renameSync(tmp, dest);
  console.log(`share0: installed to ${dest}`);
}

main().catch((e) => {
  console.error(`share0: install error: ${e.message}`);
});
