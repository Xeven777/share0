// Set SHARE0_VERSION from package.json for `bun run dev`, so the header and
// `--version` show the real version during development. Compiled binaries get
// the value injected by scripts/build.ts instead.
//
// NOTE: use bracket access, not `process.env.SHARE0_VERSION = ...`. The
// --define flag rewrites the dotted form at bundle time, which would turn
// this assignment into `"1.1.0" = ...` and crash every compiled binary
// (SyntaxError: Invalid character). Bracket access is left alone.
import { join } from "node:path";

const pkg = JSON.parse(
  await Bun.file(join(import.meta.dir, "..", "package.json")).text()
) as { version: string };

process.env["SHARE0_VERSION"] = pkg.version;
await import("../apps/cli/index.ts");