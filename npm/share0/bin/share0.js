#!/usr/bin/env node
// Runtime shim installed as the `share0` bin. Resolves the cached binary
// (same path install.js writes to) and execs it, forwarding all args.
// Falls back to a same-directory copy for packagers that vendor the binary.
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const { homedir } = require("node:os");
const path = require("node:path");

const VERSION = require("../package.json").version;
const TAG = `v${VERSION}`;

function candidatePaths() {
  const base =
    process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache");
  const plat =
    process.platform === "win32"
      ? "share0-windows-x64"
      : process.platform === "darwin"
        ? `share0-darwin-${process.arch === "arm64" ? "arm64" : "x64"}`
        : `share0-linux-${process.arch === "arm64" ? "arm64" : "x64"}`;
  const exe = process.platform === "win32" ? `${plat}.exe` : plat;
  return [
    path.join(base, "share0", TAG, plat),
    path.join(base, "share0", TAG, exe),
    path.join(__dirname, plat),
    path.join(__dirname, exe),
  ];
}

const bin = candidatePaths().find((p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
});

if (!bin) {
  console.error(
    "share0: binary not found. The postinstall download may have been skipped.\n" +
      `  Re-run install: cd ${path.join(__dirname, "..")} && node install.js\n` +
      "  Or download manually: https://github.com/Xeven777/share0/releases"
  );
  process.exit(1);
}

const r = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
process.exit(r.status ?? 1);
