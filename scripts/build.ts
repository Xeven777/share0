import { $ } from "bun";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const outdir = join(import.meta.dir, "..", "dist");
const entry = join(import.meta.dir, "..", "apps", "cli", "index.ts");

const targets = [
  { name: "share0-linux-x64", target: "bun-linux-x64", upx: true },
  { name: "share0-darwin-x64", target: "bun-darwin-x64", upx: false },
  { name: "share0-darwin-arm64", target: "bun-darwin-arm64", upx: false },
  { name: "share0-windows-x64.exe", target: "bun-windows-x64", upx: true },
];

let hasUpx = false;
try {
  await $`upx --version`.quiet();
  hasUpx = true;
} catch {
  console.log("UPX not found — skipping compression. Install with: sudo apt install upx-ucl / brew install upx\n");
}

await mkdir(outdir, { recursive: true });

console.log("Building binaries...\n");

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const checksums: string[] = [];

for (const { name, target, upx } of targets) {
  const outfile = join(outdir, name);
  console.log(`  ${target} -> ${name}`);

  try {
    await $`bun build --compile --target=${target} ${entry} --outfile ${outfile}`;

    const sizeBefore = (await stat(outfile)).size;
    console.log(`    built  ${formatSize(sizeBefore)}`);

    if (hasUpx && upx) {
      await $`upx -1 --quiet ${outfile}`;
      const sizeAfter = (await stat(outfile)).size;
      const saved = ((1 - sizeAfter / sizeBefore) * 100).toFixed(0);
      console.log(`    upx    ${formatSize(sizeAfter)} (-${saved}%)`);
    }

    const proc = await $`sha256sum ${outfile}`.text();
    const hash = proc.split(" ")[0];
    checksums.push(`${hash}  ${name}`);
    console.log(`    ✓ ${hash.slice(0, 12)}...`);
  } catch (e) {
    console.error(`    ✗ failed: ${e}`);
  }
}

const checksumPath = join(outdir, "checksums.txt");
await writeFile(checksumPath, checksums.join("\n") + "\n");
console.log(`\nChecksums written to ${checksumPath}`);
console.log("\nDone.");
