// Single-line ASCII animation for the CLI. Monochrome, no dependencies.
// Frames are pure functions of an injectable time (ms) so output is
// deterministic and testable — never read the clock inside a frame picker.

/** Classic ASCII spinner. Stays in one column so the line never reflows. */
export const SPINNER = ["|", "/", "-", "\\"] as const;

/** Ellipsis pulse for "working…" style labels. */
export const DOTS = [".  ", ".. ", "...", " ..", "  .", "   "] as const;

/**
 * Pick a frame deterministically from elapsed time.
 * fps 8–12 gives a calm retro feel; 12–24 reads as busy.
 */
export function frameAt(frames: readonly string[], tMs: number, fps = 10): string {
  if (!frames.length) return "";
  const i = Math.floor(tMs / (1000 / fps)) % frames.length;
  return frames[(i + frames.length) % frames.length]!;
}

/** mm:ss (or h:mm:ss past an hour) for live status lines. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** True when we may animate: real TTY, not a dumb terminal. */
export function canAnimate(): boolean {
  return !!process.stdout.isTTY && process.env.TERM !== "dumb";
}

export interface LiveLine {
  /** Stop the ticker, clear the line, restore the cursor. Idempotent. */
  stop: () => void;
}

/**
 * Rewrite one terminal line at `fps` until `stop()` is called.
 * Uses CR + EL (not full-screen clear) so earlier output stays put.
 * Falls back to a single static print when animation is unavailable.
 */
export function startLiveLine(render: (elapsedMs: number) => string, fps = 10): LiveLine {
  if (!canAnimate()) {
    process.stdout.write(render(0) + "\n");
    return { stop: () => {} };
  }
  const ESC = "\x1b[";
  const start = Date.now();
  process.stdout.write(ESC + "?25l"); // hide cursor
  const id = setInterval(() => {
    process.stdout.write("\r" + ESC + "2K" + render(Date.now() - start));
  }, 1000 / fps);
  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(id);
      process.stdout.write("\r" + ESC + "2K" + ESC + "?25h"); // clear line, show cursor
    },
  };
}
