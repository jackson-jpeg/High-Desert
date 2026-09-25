// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PALETTE } from "@/lib/palette";

/**
 * HD-036: one colour, one definition. `src/app/globals.css` holds the palette
 * as `--hd-*` custom properties; everything else references them. Before this
 * test there were ~130 raw hex literals across 23 files outside it, several
 * of them re-typing a token's value by hand (TuningStrip, the stats bars,
 * win98.css's title bar), so a retheme silently missed them.
 *
 * Scanned: every .ts/.tsx/.css under src/, with comments stripped — a comment
 * explaining that a colour used to be #808080 is documentation, not a colour.
 * Exempt: globals.css (the definition), src/lib/palette.ts (its checked copy
 * for canvas / next/og / meta tags — held equal below), and test files, which
 * assert on concrete values.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SRC = path.join(ROOT, "src");
const GLOBALS = path.join(SRC, "app/globals.css");
const EXEMPT = new Set([GLOBALS, path.join(SRC, "lib/palette.ts")]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__") continue;
      out.push(...walk(full));
    } else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Comments out, line numbers kept. A `//` preceded by `:` is a URL
 * (`https://…`), not a comment.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` — not `&#123;`, not `#app-loading`. */
const HEX = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;

function findRawHex(files: string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    if (EXEMPT.has(file)) continue;
    const lines = stripComments(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(HEX)) {
        hits.push(`${path.relative(ROOT, file)}:${i + 1}  ${m[0]}`);
      }
    });
  }
  return hits;
}

/** `--hd-name: #hex;` declarations in globals.css, lower-cased values. */
function hdColourTokens(): Map<string, string> {
  const css = stripComments(readFileSync(GLOBALS, "utf8"));
  const tokens = new Map<string, string>();
  for (const m of css.matchAll(/(--hd-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    tokens.set(m[1], m[2].toLowerCase());
  }
  return tokens;
}

describe("no raw hex colours outside globals.css", () => {
  it("every colour in src/ is a token", () => {
    const hits = findRawHex(walk(SRC));
    expect(hits, `Use var(--hd-*) or a Tailwind token (or PALETTE for canvas):\n${hits.join("\n")}`).toEqual([]);
  });

  it("the scanner sees what it is looking for (control)", () => {
    // A check that finds nothing must be shown able to find something.
    const sample = 'const a = "#1A1F33"; const b = "var(--hd-raised)"; // was #808080\n' +
      "/* #FFFFFF */ .x { color: #fff; } a[href='https://x.test/#abc'] {} &#123; #app-loading {}";
    const found = [...stripComments(sample).matchAll(HEX)].map((m) => m[0]);
    expect(found).toEqual(["#1A1F33", "#fff", "#abc"]);
  });

  it("every var(--hd-*) colour referenced in src/ is defined", () => {
    // A typo in a token name renders as the property's initial value — often
    // transparent — with no error anywhere, which is exactly how a colour
    // change hides.
    const defined = new Set(
      [...readFileSync(GLOBALS, "utf8").matchAll(/(--hd-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
    );
    const missing: string[] = [];
    for (const file of walk(SRC)) {
      for (const m of stripComments(readFileSync(file, "utf8")).matchAll(/var\((--hd-[a-z0-9-]+)/g)) {
        if (!defined.has(m[1])) missing.push(`${path.relative(ROOT, file)}  ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("PALETTE is a faithful copy of globals.css, key for key", () => {
    const tokens = hdColourTokens();
    for (const [key, value] of Object.entries(PALETTE)) {
      const prop = `--hd-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      expect(tokens.get(prop), `${prop} for PALETTE.${key}`).toBe(value.toLowerCase());
    }
  });
});
