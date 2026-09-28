import { $ } from "bun";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const outdir = join(import.meta.dir, "..", "dist");
const entry = join(import.meta.dir, "..", "apps", "cli", "index.ts");

const targets = [
  { name: "share0-linux-x64", target: "bun-linux-x64" },
  { name: "share0-darwin-x64", target: "bun-darwin-x64" },
  { name: "share0-darwin-arm64", target: "bun-darwin-arm64" },
  { name: "share0-windows-x64.exe", target: "bun-windows-x64" },
];

await mkdir(outdir, { recursive: true });

console.log("Building binaries...\n");

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const checksums: string[] = [];

// Injected into the bundle via --define so `share0 --version` matches the
// release tag. Reading package.json at runtime does not survive
// `bun build --compile`, where import.meta.dir points inside the binary.
const version = (JSON.parse(await Bun.file(join(import.meta.dir, "..", "package.json")).text()) as { version: string }).version;
const defineKV = `process.env.SHARE0_VERSION=${JSON.stringify(version)}`;
console.log(`Version ${version}\n`);

for (const { name, target } of targets) {
  const outfile = join(outdir, name);
  console.log(`  ${target} -> ${name}`);

  try {
    await $`bun build --compile --target ${target} --define ${defineKV} ${entry} --outfile ${outfile}`;

    const size = (await stat(outfile)).size;
    console.log(`    built  ${formatSize(size)}`);

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
