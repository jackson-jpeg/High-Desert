import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every easter egg opens from a deliberate act, never a gesture (2026-10-12).
 * Mel's Hole opened on the twelfth scroll event at the bottom of the Library,
 * and on an iPhone one ordinary scroll fires dozens. This reads the source:
 * every place that can open an egg is listed here with the act that opens it,
 * and none may sit in a scroll, touch, wheel or pointer handler. A new egg
 * call site fails until it is added, with its act. The phone behaviour itself
 * is e2e/scroll-gestures.spec.ts.
 */

const ROOT = join(__dirname, "..", "..");

/** file → what opens an egg there. */
const ALLOWED: Record<string, string> = {
  "components/library/SearchBar.tsx": "a word typed into the search box",
  "app/[look]/(desktop)/layout.tsx": "Ctrl+Shift+A",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const EGG_EMIT = /emit\(\s*"easter-egg"/;
const GESTURE = /addEventListener\(\s*"(scroll|touch\w+|wheel|pointer\w+)"|on(Scroll|Touch\w+|Wheel|Pointer\w+)=/;

describe("easter eggs open only from deliberate acts", () => {
  const sources = files(ROOT).map((p) => ({ file: relative(ROOT, p), text: readFileSync(p, "utf8") }));

  it("every egg is emitted only where the list says, and the list is not stale", () => {
    const emitters = sources.filter((s) => EGG_EMIT.test(s.text)).map((s) => s.file).sort();
    expect(emitters).toEqual(Object.keys(ALLOWED).sort());
  });

  it("the library page listens to no scroll at all for an egg", () => {
    const page = sources.find((s) => s.file === "app/[look]/(desktop)/library/page.tsx")!;
    expect(page).toBeDefined();
    expect(page.text).not.toMatch(EGG_EMIT);
    expect(page.text).not.toMatch(/"melsHole"/);
  });

  it("no egg is opened inside a gesture handler", () => {
    // An emit within a dozen lines of a gesture listener, either side, is the
    // shape the bug had (its listener was attached below the handler).
    for (const s of sources.filter((x) => EGG_EMIT.test(x.text) || /setActiveEgg\(/.test(x.text))) {
      const lines = s.text.split("\n");
      lines.forEach((line, i) => {
        if (!EGG_EMIT.test(line) && !/setActiveEgg\("/.test(line)) return;
        const near = lines.slice(Math.max(0, i - 12), i + 13).join("\n");
        expect(near, `${s.file}:${i + 1} opens an egg next to a gesture handler`).not.toMatch(GESTURE);
      });
    }
  });

  it("control: the gesture check sees the shape the bug had", () => {
    const bug = `if (n >= 12) emit("easter-egg", "melsHole");\n};\ncontainer.addEventListener("scroll", handler);`;
    expect(bug).toMatch(GESTURE);
    expect(bug).toMatch(EGG_EMIT);
  });
});
