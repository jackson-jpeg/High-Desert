// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * CLAUDE.md, Conventions: "Zustand selectors: always use selector functions to
 * minimize re-renders." Four places called a store hook with no selector
 * (ContextMenu, ScanProgress, useCatalogScraper, useArchiveSearch — HD-040),
 * subscribing to every field and, in the two hooks, rebuilding every callback
 * on every progress tick. This holds the convention.
 */

const SRC = path.resolve(import.meta.dirname, "../..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : walk(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** `useFooStore()` — a store hook called with no selector. Comments excluded. */
const WHOLE_STORE = /\buse[A-Z]\w*Store\(\s*\)/;

describe("Zustand stores are read through selectors", () => {
  it("no store hook is called without a selector", () => {
    const hits = walk(SRC).flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => ({ line, at: `${path.relative(SRC, f)}:${i + 1}` }))
        .filter(({ line }) => !/^\s*(\/\/|\*)/.test(line) && WHOLE_STORE.test(line))
        .map(({ at, line }) => `${at}  ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("the pattern matches what it is for (control)", () => {
    expect(WHOLE_STORE.test("  const { open } = useContextMenuStore();")).toBe(true);
    expect(WHOLE_STORE.test("  const open = useContextMenuStore((s) => s.open);")).toBe(false);
    expect(WHOLE_STORE.test("  useScraperStore.getState().setPhase(x);")).toBe(false);
  });
});
