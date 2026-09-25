// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { HD_NOTIFICATIONS } from "@/lib/events";

/**
 * Every hd:* instruction emitted on a route has a listener mounted on that
 * route (HD-019). This is the check that would have caught HD-013: "Shuffle
 * Coast" in the command palette on /stats fired `hd:shuffle`, and the only
 * listener lived in the library page, which is not mounted on /stats. The
 * action silently did nothing, and nothing could notice.
 *
 * Static, over the real source:
 *
 *   1. Every page.tsx under src/app is a route. What can render on it is the
 *      page plus every layout.tsx / template.tsx / error.tsx in its ancestor
 *      directories, and everything those import, transitively — static
 *      imports, re-exports and dynamic `import()` (the shell loads the command
 *      palette that way). `import type` carries no code and is skipped.
 *   2. An emit site is `emit("key", …)`; a listener site is
 *      `useHdEvent("key", …)` or `onHdEvent("key", …)`. The key must be a
 *      string literal — a computed key is reported as a failure, because it
 *      would make this test blind.
 *   3. For each route, each key emitted by a module reachable from it must be
 *      listened to by a module reachable from it — unless the key is a
 *      notification (HD_NOTIFICATIONS: "this happened", which may go unheard).
 *
 * "Reachable" over-approximates "mounted": a listener inside a component the
 * route imports but renders conditionally counts. The error is one-sided — it
 * can miss a bug, never invent one — and the library's listeners, the case
 * that matters, are all mounted unconditionally by the page.
 */

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");
const APP = path.join(SRC, "app");
const EVENTS = path.join(SRC, "lib/events.ts");

const rel = (f: string) => path.relative(ROOT, f);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // a package
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

type Site = { key: string; file: string; line: number };

interface Scanned {
  imports: string[];
  emits: Site[];
  listens: Site[];
  /** Calls whose key is not a string literal, or aliased imports of the bus. */
  blind: string[];
}

const BUS_EMIT = "emit";
const BUS_LISTEN = new Set(["useHdEvent", "onHdEvent"]);

function scan(file: string): Scanned {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Scanned = { imports: [], emits: [], listens: [], blind: [] };
  const at = (n: ts.Node) => `${rel(file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  let importsBus = false;

  const addImport = (spec: string) => {
    const r = resolveImport(file, spec);
    if (r) out.imports.push(r);
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly =
        clause?.isTypeOnly ||
        (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) addImport(node.moduleSpecifier.text);
      if (resolveImport(file, node.moduleSpecifier.text) === EVENTS && clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        importsBus = true;
        for (const el of clause.namedBindings.elements) {
          if (el.propertyName) out.blind.push(`${at(el)} imports ${el.propertyName.text} from the bus under another name`);
        }
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) addImport(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const [arg] = node.arguments;
        if (arg && ts.isStringLiteralLike(arg)) addImport(arg.text);
      } else if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (name === BUS_EMIT || BUS_LISTEN.has(name)) {
          const [arg] = node.arguments;
          const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          if (arg && ts.isStringLiteralLike(arg)) {
            (name === BUS_EMIT ? out.emits : out.listens).push({ key: arg.text, file, line });
          } else {
            out.blind.push(`${at(node)} calls ${name}() with a key that is not a string literal`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // A local function that happens to be called `emit` is not the bus.
  if (!importsBus) {
    out.emits = [];
    out.listens = [];
    out.blind = out.blind.filter((b) => !/calls (emit|useHdEvent|onHdEvent)\(\)/.test(b));
  }
  return out;
}

const files = walk(SRC).filter((f) => f !== EVENTS);
const scanned = new Map<string, Scanned>();
for (const f of files) scanned.set(f, scan(f));

function reachable(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const next of scanned.get(f)?.imports ?? []) stack.push(next);
  }
  return seen;
}

/** Route path → the files that frame it: the page and its ancestors' layouts/templates/error boundaries. */
function routes(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of walk(APP)) {
    if (path.basename(f) !== "page.tsx") continue;
    const dir = path.dirname(f);
    const segments = path.relative(APP, dir).split(path.sep).filter(Boolean);
    const route = "/" + segments.filter((s) => !/^\(.*\)$/.test(s)).join("/");
    const roots = [f];
    for (let d = dir; d.startsWith(APP); d = path.dirname(d)) {
      for (const frame of ["layout.tsx", "template.tsx", "error.tsx"]) {
        const cand = path.join(d, frame);
        if (existsSync(cand)) roots.push(cand);
      }
      if (d === APP) break;
    }
    out.set(route, roots);
  }
  return out;
}

/** HdEventMap's keys, read from the interface itself. */
function mapKeys(): string[] {
  const sf = ts.createSourceFile(EVENTS, readFileSync(EVENTS, "utf8"), ts.ScriptTarget.Latest, true);
  const keys: string[] = [];
  sf.forEachChild((n) => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === "HdEventMap") {
      for (const m of n.members) {
        if (m.name && ts.isStringLiteral(m.name)) keys.push(m.name.text);
      }
    }
  });
  return keys;
}

const ROUTES = routes();
const allEmits = [...scanned.values()].flatMap((s) => s.emits);
const allListens = [...scanned.values()].flatMap((s) => s.listens);

describe("hd:* events and the routes they fire on (HD-019, HD-013)", () => {
  it("sees the app: every route, and the bus's known sites", () => {
    // Guards against a scanner that silently found nothing — an empty scan
    // would pass the real assertion below vacuously.
    expect([...ROUTES.keys()].sort()).toEqual(["/", "/library", "/live", "/radio", "/scanner", "/search", "/stats"]);
    expect(allEmits.length).toBeGreaterThan(20);
    const layout = path.join(APP, "(desktop)/layout.tsx");
    expect(allListens.some((s) => s.key === "play-episode" && s.file === layout)).toBe(true);
    expect(reachable(ROUTES.get("/stats")!).has(path.join(SRC, "components/CommandPalette.tsx"))).toBe(true);
    expect(reachable(ROUTES.get("/stats")!).has(path.join(APP, "(desktop)/library/page.tsx"))).toBe(false);
  });

  it("every bus call names its key with a string literal", () => {
    expect([...scanned.values()].flatMap((s) => s.blind)).toEqual([]);
  });

  it("every key in HdEventMap is emitted somewhere and heard somewhere, and nothing else is", () => {
    const keys = mapKeys();
    expect(keys.length).toBeGreaterThan(5);
    const emitted = new Set(allEmits.map((s) => s.key));
    const heard = new Set(allListens.map((s) => s.key));
    expect(keys.filter((k) => !emitted.has(k)), "declared but never emitted").toEqual([]);
    expect(keys.filter((k) => !heard.has(k)), "declared but never heard").toEqual([]);
    expect([...emitted, ...heard].filter((k) => !keys.includes(k)), "used but not declared").toEqual([]);
    for (const n of HD_NOTIFICATIONS) expect(keys).toContain(n);
  });

  it("every instruction emitted on a route has a listener mounted on that route", () => {
    const notifications = new Set<string>(HD_NOTIFICATIONS);
    const missing: string[] = [];
    for (const [route, roots] of ROUTES) {
      const mounted = reachable(roots);
      const heard = new Set<string>();
      for (const f of mounted) for (const s of scanned.get(f)?.listens ?? []) heard.add(s.key);
      for (const f of mounted) {
        for (const s of scanned.get(f)?.emits ?? []) {
          if (notifications.has(s.key) || heard.has(s.key)) continue;
          missing.push(`${route}: "${s.key}" emitted at ${rel(s.file)}:${s.line} — nothing on ${route} listens`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
