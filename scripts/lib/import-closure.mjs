/**
 * Which test files can see a change (the nightly mutation run, the lead,
 * 2026-11-27: "mutate only files changed since the last green run, plus
 * anything their tests cover").
 *
 * A mutation's verdict depends on its target file and its test, and on
 * everything the test imports: a changed helper the test goes through can
 * blind it as surely as a changed test. So a test is "reached" by a change
 * when its static import closure contains a changed file.
 *
 * Static and cheap: import/export ... from, side-effect imports, import(),
 * require() and vi.mock() specifiers that are relative or "@/" (src/), with
 * the usual extensions and index files. Packages are not followed. A test
 * that reads a file as text (readFileSync) is not seen through that read;
 * its mutations still run when their own target or test changes.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".cjs", "/index.ts", "/index.tsx", "/index.mjs", "/index.js"];
const SPECIFIER =
  /(?:\bimport|\bexport)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bvi\.mock\(\s*["']([^"']+)["']/g;

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** A specifier written in `from`, resolved to an absolute file under `root`, or null (a package, or not found). */
export function resolveSpecifier(spec, from, root) {
  let base;
  if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const ext of EXTENSIONS) if (isFile(base + ext)) return base + ext;
  return null;
}

/** The files `file` imports (absolute), in the order written. */
export function importsOf(file, root) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const m of text.matchAll(SPECIFIER)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
    const hit = resolveSpecifier(spec, file, root);
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * Of `tests` (paths relative to `root`), the ones whose import closure holds
 * any of `changed` (relative to `root`). A test that is itself changed counts.
 * @returns {Set<string>} relative paths
 */
export function testsReaching(changed, tests, root) {
  const want = new Set(changed.map((f) => path.resolve(root, f)));
  const edges = new Map();
  const next = (f) => {
    if (!edges.has(f)) edges.set(f, importsOf(f, root));
    return edges.get(f);
  };
  const reached = new Set();
  for (const test of new Set(tests)) {
    const start = path.resolve(root, test);
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const f = queue.pop();
      if (want.has(f)) {
        reached.add(test);
        break;
      }
      for (const g of next(f)) {
        if (!seen.has(g)) {
          seen.add(g);
          queue.push(g);
        }
      }
    }
  }
  return reached;
}
