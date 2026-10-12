#!/usr/bin/env node
/**
 * Mints a slug for every catalog show that has none, in data/show-slugs.json.
 * Add-only: an existing slug never changes (scripts/lib/show-slugs.mjs).
 *
 * Run after adding shows to public/seed/library.json:
 *   node scripts/gen-show-slugs.mjs          # writes, prints what it added
 *   node scripts/gen-show-slugs.mjs --check  # exits 1 if a show has no slug
 *
 * src/lib/shows/__tests__/show-slugs.test.ts fails if a catalog row has no
 * slug, if two rows share one, or if a committed slug was rewritten.
 */
import fs from "node:fs";
import path from "node:path";
import { assignSlugs, rewrittenSlugs } from "./lib/show-slugs.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAP_FILE = path.join(ROOT, "data/show-slugs.json");

const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "public/seed/library.json"), "utf8"));
const existing = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, "utf8")) : {};
const { map, added } = assignSlugs(existing, rows);

if (rewrittenSlugs(existing, map).length) {
  // assignSlugs cannot do this; the check is here so a future edit to it cannot either.
  console.error("[gen-show-slugs] refusing: an existing slug would change");
  process.exit(1);
}

if (process.argv.includes("--check")) {
  if (added.length) {
    console.error(`[gen-show-slugs] ${added.length} show(s) have no slug. Run: node scripts/gen-show-slugs.mjs`);
    process.exit(1);
  }
  console.log(`[gen-show-slugs] ${Object.keys(map).length} slugs, every show has one`);
  process.exit(0);
}

// One entry per line, so a diff shows exactly which slugs were added.
const body = Object.entries(map)
  .map(([hash, slug]) => `  ${JSON.stringify(hash)}: ${JSON.stringify(slug)}`)
  .join(",\n");
fs.writeFileSync(MAP_FILE, `{\n${body}\n}\n`);
console.log(`[gen-show-slugs] ${added.length} added, ${Object.keys(map).length} total`);
for (const hash of added.slice(0, 20)) console.log(`  ${map[hash]}`);
if (added.length > 20) console.log(`  ... and ${added.length - 20} more`);
