#!/usr/bin/env node
/**
 * Clear catalog `guestName`s that only repeat the title (docs/catalog-guests.md).
 * The rule is src/lib/library/guest.ts, imported as is (Node strips its types).
 *
 *   node scripts/clean-guest-repeats.mjs           # list what would change
 *   node scripts/clean-guest-repeats.mjs --write   # write the seed, print the log rows
 *
 * Writes only `guestName`, only on rows the rule names, and keeps the file's
 * formatting (2-space JSON, trailing newline). Re-running is a no-op.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { guestRepeatsTitle } from "../src/lib/library/guest.ts";

const FILE = new URL("../public/seed/library.json", import.meta.url);
const rows = JSON.parse(readFileSync(FILE, "utf8"));
const hits = rows.filter((r) => guestRepeatsTitle(r.title, r.guestName));
for (const r of hits) console.log(`| ${r.airDate} | ${r.title} | ${r.guestName} | \`${r.fileHash}\` |`);
console.error(`${hits.length} row(s) whose guest repeats the title`);
if (process.argv.includes("--write") && hits.length) {
  for (const r of hits) delete r.guestName;
  writeFileSync(FILE, JSON.stringify(rows, null, 2) + "\n");
  console.error("written");
}
