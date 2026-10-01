// Shared terminal UI: theme, TTY helpers, header/box, spinners, QR.
// Zero dependencies, no top-level side effects. Safe for --quiet/--json.
//
// Colour degrades gracefully: 24-bit when COLORTERM says truecolor, 256
// colours when the terminal advertises them, otherwise the classic 16.
// NO_COLOR, FORCE_COLOR=0 and non-TTY output switch colour off entirely, so
// --quiet, --json, pipes and CI stay byte-clean.

export const SYMBOLS = {
  ok: "✓",
  idle: "·",
  arrow: "→",
  warn: "⚠",
  fail: "✗",
  link: "◉",
  logo: "◆",
} as const;

export type ColorDepth = "none" | "ansi16" | "ansi256" | "truecolor";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

function supportsColor(): boolean {
  if (process.env.NO_COLOR != null) return false;
  const force = process.env.FORCE_COLOR;
  if (force === "0" || force === "false") return false;
  // FORCE_COLOR=1 forces colour on even when stdout is a pipe, so output can be
  // inspected (pipe it through `less -R`). It never overrides NO_COLOR.
  if (force != null && force !== "") return true;
  return !!process.stdout.isTTY;
}

let _color: boolean | null = null;
export function useColor(): boolean {
  if (_color == null) _color = supportsColor();
  return _color;
}

let _depth: ColorDepth | null = null;
/** How much colour this terminal can actually show. Cached like useColor(). */
export function colorDepth(): ColorDepth {
  if (_depth != null) return _depth;
  _depth = ((): ColorDepth => {
    if (!useColor()) return "none";
    const ct = process.env.COLORTERM;
    if (ct === "truecolor" || ct === "24bit") return "truecolor";
    if (process.env.FORCE_COLOR === "3") return "truecolor";
    if (/256/i.test(process.env.TERM ?? "")) return "ansi256";
    if (process.env.FORCE_COLOR === "2") return "ansi256";
    return "ansi16";
  })();
  return _depth;
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

/** Brand palette. Violet/indigo is the primary accent, cyan is reserved for
 *  URLs, amber for warnings and passwords, and the three greys carry text
 *  hierarchy. */
export const PALETTE = {
  accent: { r: 139, g: 92, b: 246 }, // violet — primary accent
  accent2: { r: 99, g: 102, b: 241 }, // indigo — gradient midpoint
  url: { r: 34, g: 211, b: 238 }, // cyan — links
  ok: { r: 52, g: 211, b: 153 }, // green — success
  warn: { r: 245, g: 158, b: 11 }, // amber — warnings / passwords
  fail: { r: 248, g: 113, b: 113 }, // red — failures
  gray1: { r: 209, g: 213, b: 219 }, // lightest — emphasised meta
  gray2: { r: 156, g: 163, b: 175 }, // mid — labels / secondary
  gray3: { r: 107, g: 114, b: 128 }, // darkest — rules / footnotes
};

/** Wordmark gradient: violet → indigo → cyan. */
export const GRADIENT: Rgb[] = [PALETTE.accent, PALETTE.accent2, PALETTE.url];

function dist(a: Rgb, b: Rgb): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

/** Nearest xterm 6×6×6 cube entry (16..255), falling back to the grey ramp
 *  (232..255) whenever grey is closer than any saturated colour. */
function nearest256(c: Rgb): number {
  const levels = [0, 95, 135, 175, 215, 255];
  const near = (v: number) => {
    let bi = 0;
    for (let i = 1; i < levels.length; i++) {
      if (Math.abs(levels[i]! - v) < Math.abs(levels[bi]! - v)) bi = i;
    }
    return bi;
  };
  const ri = near(c.r);
  const gi = near(c.g);
  const bi = near(c.b);
  const cube = 16 + 36 * ri + 6 * gi + bi;
  const lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
  const g = Math.max(0, Math.min(23, Math.round((lum - 8) / 10)));
  const gv = 8 + g * 10;
  const grayColor = { r: gv, g: gv, b: gv };
  return dist(c, { r: levels[ri]!, g: levels[gi]!, b: levels[bi]! }) <= dist(c, grayColor)
    ? cube
    : 232 + g;
}

/** Reference RGB for the classic 16-colour palette. */
const ANSI16: { idx: number; rgb: Rgb }[] = [
  { idx: 0, rgb: { r: 0, g: 0, b: 0 } },
  { idx: 1, rgb: { r: 205, g: 0, b: 0 } },
  { idx: 2, rgb: { r: 0, g: 205, b: 0 } },
  { idx: 3, rgb: { r: 205, g: 205, b: 0 } },
  { idx: 4, rgb: { r: 0, g: 0, b: 238 } },
  { idx: 5, rgb: { r: 205, g: 0, b: 205 } },
  { idx: 6, rgb: { r: 0, g: 205, b: 205 } },
  { idx: 7, rgb: { r: 229, g: 229, b: 229 } },
  { idx: 8, rgb: { r: 127, g: 127, b: 127 } },
  { idx: 9, rgb: { r: 255, g: 0, b: 0 } },
  { idx: 10, rgb: { r: 0, g: 255, b: 0 } },
  { idx: 11, rgb: { r: 255, g: 255, b: 0 } },
  { idx: 12, rgb: { r: 92, g: 92, b: 255 } },
  { idx: 13, rgb: { r: 255, g: 0, b: 255 } },
  { idx: 14, rgb: { r: 0, g: 255, b: 255 } },
  { idx: 15, rgb: { r: 255, g: 255, b: 255 } },
];

function nearest16(c: Rgb): number {
  let best = 0;
  let bd = Infinity;
  for (const e of ANSI16) {
    const d = dist(c, e.rgb);
    if (d < bd) {
      bd = d;
      best = e.idx;
    }
  }
  return best;
}

function ansi16Code(idx: number): string {
  return idx < 8 ? `\x1b[3${idx}m` : `\x1b[9${idx - 8}m`;
}

/** Colour one span at the depth this terminal supports. `a16` is the exact
 *  classic code, so 16-colour output stays byte-identical to the old theme. */
function tint(s: string, rgb: Rgb, a16: string): string {
  const d = colorDepth();
  if (d === "none") return s;
  if (d === "ansi16") return `${a16}${s}${C.reset}`;
  if (d === "ansi256") return `\x1b[38;5;${nearest256(rgb)}m${s}${C.reset}`;
  return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m${s}${C.reset}`;
}

function paint(code: string, s: string): string {
  return useColor() ? `${code}${s}${C.reset}` : s;
}

function shade(c: Rgb, f: number): Rgb {
  return { r: Math.round(c.r * f), g: Math.round(c.g * f), b: Math.round(c.b * f) };
}

// --- basic attributes ------------------------------------------------------

export const bold = (s: string) => paint(C.bold, s);
export const dim = (s: string) => paint(C.dim, s);

// Named colours route through the palette, so they upgrade automatically on
// truecolor/256 terminals while staying identical on 16-colour ones.
export const cyan = (s: string) => tint(s, PALETTE.url, C.cyan);
export const green = (s: string) => tint(s, PALETTE.ok, C.green);
export const yellow = (s: string) => tint(s, PALETTE.warn, C.yellow);
export const red = (s: string) => tint(s, PALETTE.fail, C.red);
export const magenta = (s: string) => tint(s, PALETTE.accent, C.magenta);

/** Primary brand accent (violet). */
export const accent = (s: string) => tint(s, PALETTE.accent, C.magenta);

/** Three grey levels for text hierarchy:
 *  1 = lightest (emphasised meta, e.g. file sizes),
 *  2 = mid (labels, secondary detail),
 *  3 = darkest (rules, footnotes, hints).
 *
 *  16-colour terminals have no usable grey ramp — pure RGB greys are invisible
 *  on light backgrounds — so they fall back to default / dim and keep the same
 *  relative hierarchy without risking unreadable text. */
export const gray1 = (s: string) => gray(s, 1);
export const gray2 = (s: string) => gray(s, 2);
export const gray3 = (s: string) => gray(s, 3);

function gray(s: string, level: 1 | 2 | 3): string {
  const d = colorDepth();
  if (d === "none") return s;
  if (d === "ansi16") return level === 1 ? s : `${C.dim}${s}${C.reset}`;
  const rgb = level === 1 ? PALETTE.gray1 : level === 2 ? PALETTE.gray2 : PALETTE.gray3;
  return tint(s, rgb, C.dim);
}

// --- layout helpers --------------------------------------------------------

/** Aligned label/value row: `  Size      12.3 MB`. The label is padded as plain
 *  text first and only then coloured, so ANSI codes never break alignment. */
export function kv(label: string, value: string, width = 10): string {
  return `  ${gray2(label.padEnd(width))}${value}`;
}

export type BadgeTone = "accent" | "ok" | "warn" | "fail" | "info" | "muted";

const TONES: Record<BadgeTone, { rgb: Rgb; a16: string }> = {
  accent: { rgb: PALETTE.accent, a16: C.magenta },
  ok: { rgb: PALETTE.ok, a16: C.green },
  warn: { rgb: PALETTE.warn, a16: C.yellow },
  fail: { rgb: PALETTE.fail, a16: C.red },
  info: { rgb: PALETTE.url, a16: C.cyan },
  muted: { rgb: PALETTE.gray2, a16: C.dim },
};

/** Pill badge (`PUBLIC`, a tunnel name, a password).
 *  No colour → `[TEXT]`; 16-colour → coloured `[TEXT]`; 256/truecolor → a real
 *  pill with a darkened background, readable on light and dark terminals. */
export function badge(text: string, tone: BadgeTone = "accent"): string {
  const t = TONES[tone];
  const d = colorDepth();
  if (d === "none") return `[${text}]`;
  if (d === "ansi16") return `${t.a16}[${text}]${C.reset}`;
  const bg = shade(t.rgb, 0.3);
  if (d === "ansi256") {
    return `\x1b[48;5;${nearest256(bg)}m\x1b[38;5;${nearest256(t.rgb)}m ${text} ${C.reset}`;
  }
  return `\x1b[48;2;${bg.r};${bg.g};${bg.b}m\x1b[38;2;${t.rgb.r};${t.rgb.g};${t.rgb.b}m ${text} ${C.reset}`;
}

/** Horizontal rule, optionally labelled: `── Connectivity ───────`. */
export function rule(label = "", width = termWidth()): string {
  const w = Math.max(12, width);
  if (!label) return gray3("─".repeat(w));
  const lead = "── ";
  const tail = "─".repeat(Math.max(3, w - lead.length - label.length - 2));
  return `${gray3(lead)}${gray2(label)} ${gray3(tail)}`;
}

/** Paint `s` with an interpolated colour ramp — one colour per character, so it
 *  still reads as a gradient on 16-colour terminals (violet → indigo → cyan
 *  maps to magenta → blue → cyan). */
export function gradientText(s: string, stops: Rgb[] = GRADIENT): string {
  if (!useColor() || !s) return s;
  const chars = [...s];
  const n = chars.length;
  let out = "";
  for (let i = 0; i < n; i++) {
    out += tintChar(lerpStops(stops, n === 1 ? 0 : i / (n - 1)), chars[i]!);
  }
  return out;
}

function tintChar(c: Rgb, ch: string): string {
  const d = colorDepth();
  if (d === "none") return ch;
  if (d === "ansi16") return `${ansi16Code(nearest16(c))}${ch}${C.reset}`;
  if (d === "ansi256") return `\x1b[38;5;${nearest256(c)}m${ch}${C.reset}`;
  return `\x1b[38;2;${c.r};${c.g};${c.b}m${ch}${C.reset}`;
}

function lerp(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function lerpStops(stops: Rgb[], t: number): Rgb {
  if (stops.length <= 1) return stops[0] ?? PALETTE.accent;
  const x = t * (stops.length - 1);
  const i = Math.max(0, Math.min(stops.length - 2, Math.floor(x)));
  return lerp(stops[i]!, stops[i + 1]!, x - i);
}

// --- CLI primitives --------------------------------------------------------

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

/** Version, injected at build time by scripts/build.ts and `bun run build`.
 *  Reading package.json at runtime does not survive `bun build --compile`,
 *  where import.meta.dir points inside the binary. The fallback keeps dev
 *  runs working. */
export const VERSION = process.env.SHARE0_VERSION ?? "0.0.0-dev";

/** Gradient wordmark + version pill + rule. The signature is unchanged, so
 *  every caller (send/receive/hub/menu/help) upgrades for free. */
export function header(title = "share0"): string {
  const v = `v${VERSION}`;
  const line = "─".repeat(Math.max(8, Math.min(48, termWidth() - title.length - v.length - 8)));
  return `${gradientText(title)} ${badge(v, "accent")} ${gray3(line)}`;
}

export function sectionLabel(s: string): string {
  return `\n${bold(s)}`;
}

export function okLine(name: string, detail = ""): string {
  return `  ${green(SYMBOLS.ok)} ${name}${detail ? gray2(` (${detail})`) : ""}`;
}

export function idleLine(name: string, detail = ""): string {
  return `  ${gray2(SYMBOLS.idle + " " + name)}${detail ? gray3(` (${detail})`) : ""}`;
}

export function warnLine(msg: string): string {
  return `\n${yellow(`${SYMBOLS.warn} ${msg}`)}`;
}

export function urlBlock(label: string, url: string, extra = ""): string {
  return `${label}\n  ${cyan(url)}${extra ? gray2(`  ${extra}`) : ""}`;
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
    console.log(gray2("(QR unavailable — install qrcode-terminal)"));
    console.log(cyan(url));
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
