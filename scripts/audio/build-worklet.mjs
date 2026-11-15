#!/usr/bin/env node
/**
 * Build public/audio/dsp-worklet.js from src/audio/dsp/worklet.ts and the
 * modules it imports, with no bundler: Node's own type stripping
 * (module.stripTypeScriptTypes), each module in its own function scope, and
 * its relative imports rewritten to reads of the modules before it.
 *
 *   node scripts/audio/build-worklet.mjs            write the file
 *   node scripts/audio/build-worklet.mjs --check    exit 1 if it is stale
 *
 * The output is committed (public/ is served as is; the deploy runs no
 * build step for it), and src/audio/dsp/__tests__/worklet-build.test.ts
 * fails when it differs from a fresh build, so it cannot drift from src.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ENTRY = join(ROOT, "src/audio/dsp/worklet.ts");
export const OUT = join(ROOT, "public/audio/dsp-worklet.js");

const IMPORT_RE = /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+"(\.[^"]+)";?\s*$/gm;
const EXPORT_DECL_RE = /^export\s+(?:declare\s+)?(const|let|function|class|abstract class)\s+([A-Za-z_$][\w$]*)/gm;

function read(file) {
  return readFileSync(file, "utf8");
}

/** Modules in dependency order, entry last. */
function order(entry) {
  const seen = new Map();
  const out = [];
  const visit = (file, stack) => {
    if (seen.get(file) === "done") return;
    if (stack.includes(file)) throw new Error(`import cycle: ${[...stack, file].map((f) => relative(ROOT, f)).join(" -> ")}`);
    const src = read(file);
    for (const m of src.matchAll(IMPORT_RE)) {
      if (m[1]) continue; // import type: erased
      visit(resolve(dirname(file), m[3]), [...stack, file]);
    }
    seen.set(file, "done");
    out.push(file);
  };
  visit(entry, []);
  return out;
}

const idOf = (file) => "m_" + relative(join(ROOT, "src/audio/dsp"), file).replace(/\.ts$/, "").replace(/[^\w]/g, "_");

export function build() {
  const files = order(ENTRY);
  const parts = [];
  for (const file of files) {
    let src = read(file);
    // Imports: `import { A, B as C, type T } from "./x.ts"` -> `const { A, B: C } = m_x;`
    src = src.replace(IMPORT_RE, (_all, typeOnly, names, spec) => {
      if (typeOnly) return "";
      const keep = names
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("type "))
        .map((s) => s.replace(/\s+as\s+/, ": "));
      return keep.length ? `const { ${keep.join(", ")} } = ${idOf(resolve(dirname(file), spec))};` : "";
    });
    if (/^\s*import\s/m.test(src)) throw new Error(`${relative(ROOT, file)}: an import the worklet build cannot inline (only relative named imports)`);
    let js = stripTypeScriptTypes(src, { mode: "strip" });
    const exported = [...js.matchAll(EXPORT_DECL_RE)].map((m) => m[2]);
    js = js.replace(/^export\s+/gm, "");
    if (/^\s*export\b/m.test(js)) throw new Error(`${relative(ROOT, file)}: an export form the worklet build does not handle`);
    // Collapse the blank runs type stripping leaves behind.
    js = js
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
    parts.push(`// ── ${relative(ROOT, file)} ──\nconst ${idOf(file)} = (() => {\n${js.trim()}\nreturn { ${exported.join(", ")} };\n})();`);
  }
  return `// Built by scripts/audio/build-worklet.mjs from src/audio/dsp/. Do not edit: edit the source and rebuild.\n"use strict";\n${parts.join("\n\n")}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.removeAllListeners("warning");
  process.on("warning", (w) => {
    if (w.name !== "ExperimentalWarning") console.warn(w);
  });
  const js = build();
  if (process.argv.includes("--check")) {
    let cur = "";
    try {
      cur = read(OUT);
    } catch {}
    if (cur !== js) {
      console.error(`${relative(ROOT, OUT)} is stale: run node scripts/audio/build-worklet.mjs`);
      process.exit(1);
    }
    console.log(`${relative(ROOT, OUT)} is current`);
  } else {
    writeFileSync(OUT, js);
    console.log(`wrote ${relative(ROOT, OUT)} (${js.length} bytes)`);
  }
}
