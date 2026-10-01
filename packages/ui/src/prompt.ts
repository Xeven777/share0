// Minimal raw-stdin prompts. No dependencies, TTY-only.
// Arrow keys + enter for select, y/n for confirm, free text for input.

import { SYMBOLS, accent, bold, dim, gray2 } from "./theme.ts";

export interface SelectChoice<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
}

function stdinRaw<T>(fn: (data: Buffer) => T | undefined): Promise<T> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = (stdin as unknown as { isRaw?: boolean }).isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    const onData = (d: Buffer) => {
      const out = fn(d);
      if (out !== undefined) {
        stdin.off("data", onData);
        stdin.setRawMode?.(!!wasRaw);
        stdin.pause();
        resolve(out);
      }
    };
    stdin.on("data", onData);
  });
}

export async function select<T extends string>(message: string, choices: SelectChoice<T>[]): Promise<T> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return choices[0]!.value;
  let idx = 0;
  const render = () => {
    const lines = [`${accent(SYMBOLS.logo)} ${bold(message)}`];
    choices.forEach((c, i) => {
      // The cursor and the live row carry the accent; the rest stays dim, so a
      // glance tells you where "enter" will land.
      const cursor = i === idx ? accent("❯") : " ";
      const label = i === idx ? bold(c.label) : dim(c.label);
      lines.push(`${cursor} ${label}${c.hint ? (i === idx ? `  ${c.hint}` : `  ${gray2(c.hint)}`) : ""}`);
    });
    lines.push(dim("↑↓ navigate · enter select · ctrl+c cancel"));
    process.stdout.write("\x1b[2J\x1b[H" + lines.join("\n") + "\n");
  };
  render();
  const value = await stdinRaw<T>((d) => {
    const s = d.toString("utf8");
    if (s === "\x03") {
      process.stdout.write("\n");
      process.exit(130);
      return undefined;
    }
    if (s === "\r" || s === "\n") return choices[idx]!.value;
    if (s === "\x1b[A") {
      idx = (idx - 1 + choices.length) % choices.length;
      render();
      return undefined;
    }
    if (s === "\x1b[B") {
      idx = (idx + 1) % choices.length;
      render();
      return undefined;
    }
    const n = parseInt(s, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= choices.length) {
      idx = n - 1;
      render();
      return undefined;
    }
    return undefined;
  });
  process.stdout.write("\n");
  return value;
}

export async function confirm(message: string, defaultYes = false): Promise<boolean> {
  if (!process.stdin.isTTY) return defaultYes;
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  process.stdout.write(`${accent(SYMBOLS.logo)} ${bold(message)} ${dim(hint)} `);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.resume();
    const onData = (d: Buffer) => {
      const s = d.toString("utf8").trim().toLowerCase();
      stdin.off("data", onData);
      stdin.pause();
      process.stdout.write("\n");
      if (s === "") resolve(defaultYes);
      else resolve(s === "y" || s === "yes");
    };
    stdin.once("data", onData);
  });
}

export async function textInput(message: string, placeholder = ""): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const rl = await import("node:readline");
  const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    iface.question(`${accent(SYMBOLS.logo)} ${bold(message)}${gray2(placeholder ? ` (${placeholder})` : "")}: `, (ans) => {
      iface.close();
      resolve(ans.trim());
    });
  });
}
