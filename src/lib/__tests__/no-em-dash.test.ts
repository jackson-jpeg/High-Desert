// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * No em dashes in anything a visitor reads (the copy rule in /root/CLAUDE.md,
 * swept in one pass on 2026-09-26). Before the sweep there were about sixty
 * files of them, left over from before the rule, and "fix them when the screen
 * is touched" had left most of them in place.
 *
 * Scanned: every string literal, template chunk and JSX text in the app's
 * source (src/, test files aside), the phone lines' service (its refusals and
 * sign-in page are shown to callers), the service worker, the web manifest,
 * and CSS `content:` values. Comments are not copy and are not scanned. Seed
 * catalog titles are archive.org's data, not ours, and are checked separately
 * below so that one arriving with a dash is noticed rather than silently shown.
 *
 * The rendered pages are checked too: `scripts/csp-check.mjs` fails on an em
 * dash in any route's visible text, title or accessible labels.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..");
const DASH = "—";
/** The HTML entities JSX decodes to an em dash. */
const ENTITY = /&(mdash|#8212|#x2014);/i;

function walk(p: string, keep: (f: string) => boolean): string[] {
  if (!statSync(p).isDirectory()) return keep(p) ? [p] : [];
  const out: string[] = [];
  for (const name of readdirSync(p)) {
    if (name === "__tests__" || name === "node_modules" || name === "test") continue;
    out.push(...walk(path.join(p, name), keep));
  }
  return out;
}

const code = (f: string) => /\.(tsx?|mjs|js)$/.test(f) && !/\.test\.[a-z]+$/.test(f);

const SOURCES = [
  ...walk(path.join(ROOT, "src"), code),
  ...walk(path.join(ROOT, "services/live/lib"), code),
  path.join(ROOT, "services/live/server.mjs"),
  path.join(ROOT, "public/sw.js"),
];

/**
 * Every em dash inside a string, template or JSX text, as `file:line  text`.
 * Judged on the value, not the spelling: `"\u2014"` and `&mdash;` render the
 * same dash. A scan of the raw source missed thirteen of them, and CI caught one
 * on /stats through csp-check's rendered scan.
 */
function dashesInCode(file: string, text: string): string[] {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : /\.(mjs|js)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    const copy =
      ts.isStringLiteralLike(n) || ts.isJsxText(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n);
    const value = copy ? (n as ts.LiteralLikeNode).text : "";
    if (copy && (value.includes(DASH) || ENTITY.test(value))) {
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      hits.push(`${path.relative(ROOT, file)}:${line + 1}  ${n.getText(sf).replace(/\s+/g, " ").slice(0, 160)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

describe("no em dashes in user-facing copy", () => {
  it("the scan reaches the app, the phone lines and the service worker", () => {
    // A scan that found no files would pass forever.
    expect(SOURCES.length).toBeGreaterThan(300);
    for (const f of ["src/components/live/LiveChat.tsx", "services/live/lib/app.mjs", "src/hooks/useShellMenus.ts"]) {
      expect(SOURCES).toContain(path.join(ROOT, f));
    }
  });

  it("the detector sees a dash in a string, a template and JSX text, however it is spelled, and not in a comment", () => {
    const sample = [
      `// a comment ${DASH} not copy`,
      `const a = "one ${DASH} two";`,
      `const b = \`x \${a} ${DASH} y\`;`,
      `const c = <p>three ${DASH} four</p>;`,
      `const d = "an escape \\u2014 renders one";`,
      `const e = <p>an entity &mdash; renders one</p>;`,
      `const f = <p title="so does &#8212; this">x</p>;`,
      `const g = "a hyphen - and an en dash \u2013 are fine";`,
    ].join("\n");
    expect(dashesInCode("sample.tsx", sample).map((h) => h.split(":")[1].split(" ")[0])).toEqual(["2", "3", "4", "5", "6", "7"]);
  });

  it("no string, template or JSX text in the source contains one", () => {
    const hits = SOURCES.flatMap((f) => dashesInCode(f, readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the web manifest has none", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "public/manifest.json"), "utf8"));
    expect(stringsIn(manifest).filter((s) => s.includes(DASH))).toEqual([]);
  });

  it("no CSS content: value has one", () => {
    const css = walk(path.join(ROOT, "src"), (f) => f.endsWith(".css"));
    expect(css.length).toBeGreaterThan(0);
    const hits = css.flatMap((f) =>
      readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => /\bcontent\s*:/.test(l) && l.includes(DASH))
        .map((l) => `${path.relative(ROOT, f)}  ${l.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("the seed catalog's titles, guests and summaries have none", () => {
    const seed = JSON.parse(readFileSync(path.join(ROOT, "public/seed/library.json"), "utf8")) as Record<string, unknown>[];
    expect(seed.length).toBeGreaterThan(1000);
    expect(stringsIn(seed).filter((s) => s.includes(DASH))).toEqual([]);
  });
});
