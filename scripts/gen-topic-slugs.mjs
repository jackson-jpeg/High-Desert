#!/usr/bin/env node
/**
 * Mints a slug for every topic that has none, in data/topic-slugs.json.
 * Add-only: an existing slug never changes (scripts/lib/topic-slugs.mjs).
 *
 * The topics are src/lib/topics/rules.ts's rule over the catalog's shows (the
 * rows with a show page). Run after changing the catalog or the rule:
 *   node scripts/gen-topic-slugs.mjs          # writes, prints what it added
 *   node scripts/gen-topic-slugs.mjs --check  # exits 1 if a topic has no slug
 *
 * src/lib/topics/__tests__/topics.test.ts fails if a topic has no slug, if two
 * share one, or if a committed slug was rewritten.
 */
import fs from "node:fs";
import path from "node:path";
import { assignTopicSlugs } from "./lib/topic-slugs.mjs";
import { rewrittenSlugs } from "./lib/show-slugs.mjs";
import { deriveTopics } from "../src/lib/topics/rules.ts";
import { isRemovedFromCatalog } from "../src/lib/library/removed-episodes.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAP_FILE = path.join(ROOT, "data/topic-slugs.json");

const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "public/seed/library.json"), "utf8"));
const showSlugs = JSON.parse(fs.readFileSync(path.join(ROOT, "data/show-slugs.json"), "utf8"));
const withPages = rows.filter((r) => showSlugs[r.fileHash] && !isRemovedFromCatalog(r));
const topics = deriveTopics(withPages);
const existing = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, "utf8")) : {};
const { map, added } = assignTopicSlugs(existing, topics);

if (rewrittenSlugs(existing, map).length) {
  console.error("[gen-topic-slugs] refusing: an existing slug would change");
  process.exit(1);
}

if (process.argv.includes("--check")) {
  if (added.length) {
    console.error(`[gen-topic-slugs] ${added.length} topic(s) have no slug. Run: node scripts/gen-topic-slugs.mjs`);
    process.exit(1);
  }
  console.log(`[gen-topic-slugs] ${topics.length} topics, every one has a slug`);
  process.exit(0);
}

const body = Object.entries(map)
  .map(([id, slug]) => `  ${JSON.stringify(id)}: ${JSON.stringify(slug)}`)
  .join(",\n");
fs.writeFileSync(MAP_FILE, `{\n${body}\n}\n`);
console.log(`[gen-topic-slugs] ${added.length} added, ${Object.keys(map).length} total`);
for (const id of added) console.log(`  ${map[id]}  (${id})`);
