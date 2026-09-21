// Shared terminal UI: theme,TTY helpers, header/box, spinners, QR.
// Zero dependencies, no top-level side effects. Safe for --quiet/--json.

export const SYMBOLS = {
  ok: "✓",
  idle: "·",
  arrow: "→",
  warn: "⚠",
  fail: "✗",
  link: "◉",
  logo: "◆",
} as const;

function supportsColor(): boolean {
  if (process.env.NO_COLOR != null) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  return !!process.stdout.isTTY;
}

let _color: boolean | null = null;
export function useColor(): boolean {
  if (_color == null) _color = supportsColor();
  return _color;
}

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

function paint(code: string, s: string): string {
  return useColor() ? `${code}${s}${C.reset}` : s;
}

export const bold = (s: string) => paint(C.bold, s);
export const dim = (s: string) => paint(C.dim, s);
export const cyan = (s: string) => paint(C.cyan, s);
export const green = (s: string) => paint(C.green, s);
export const yellow = (s: string) => paint(C.yellow, s);
export const red = (s: string) => paint(C.red, s);
export const magenta = (s: string) => paint(C.magenta, s);

export function isTTY(): boolean {
  return !!process.stdin.isTTY && !!process.stdout.isTTY;
}

export function isInteractive(opts?: { yes?: boolean; quiet?: boolean; json?: boolean }): boolean {
  if (opts?.yes || opts?.quiet || opts?.json) return false;
  if (process.env.CI != null) return false;
  return isTTY();
}

export function termWidth(fallback = 80): number {
  return process.stdout.columns || fallback;
}

export function header(title = "share0"): string {
  const v = "v1.0.0";
  const line = "─".repeat(Math.max(8, Math.min(48, termWidth() - title.length - v.length - 8)));
  return `${magenta(SYMBOLS.logo)} ${bold(title)} ${dim(v)} ${dim(line)}`;
}

export function sectionLabel(s: string): string {
  return `\n${bold(s)}`;
}

export function okLine(name: string, detail = ""): string {
  return `  ${green(SYMBOLS.ok)} ${name}${detail ? dim(` (${detail})`) : ""}`;
}

export function idleLine(name: string, detail = ""): string {
  return `  ${dim(SYMBOLS.idle + " " + name)}${detail ? dim(` (${detail})`) : ""}`;
}

export function warnLine(msg: string): string {
  return `\n${yellow(`${SYMBOLS.warn} ${msg}`)}`;
}

export function urlBlock(label: string, url: string, extra = ""): string {
  return `${label}\n  ${cyan(url)}${extra ? dim(`  ${extra}`) : ""}`;
}

/** Single-line live status (spinner replacement). Keeps fast, no animation loop. */
export function liveStatus(msg: string): () => void {
  if (!process.stdout.isTTY) {
    console.log(msg);
    return () => {};
  }
  process.stdout.write(msg);
  return () => {
    // clear current line
    (process.stdout as unknown as { clearLine(n: number): void }).clearLine?.(0);
    process.stdout.cursorTo?.(0);
  };
}

export async function printQR(label: string, url: string): Promise<void> {
  console.log(sectionLabel(label));
  try {
    // @ts-ignore — untyped optional dep, already used the same way in send.ts
    const mod = (await import("qrcode-terminal")) as unknown as {
      default: { generate(s: string, o?: unknown): void };
    };
    mod.default.generate(url, { small: true });
  } catch {
    console.log(dim("(QR unavailable — install qrcode-terminal)"));
    console.log(dim(url));
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const { default: clipboardy } = await import("clipboardy");
    await clipboardy.write(text);
    return true;
  } catch {
    return false;
  }
}
