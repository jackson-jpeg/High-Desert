#!/usr/bin/env node
/**
 * Move the ten programme-describing guest fields into `topic`
 * (docs/catalog-guests.md, "Moved to the topic"). The list is
 * `MOVED_TO_TOPIC` in src/lib/library/guest.ts, imported as is.
 *
 *   node scripts/move-guest-topics.mjs           # list what would change
 *   node scripts/move-guest-topics.mjs --write   # write the seed, print the log rows
 *
 * On each listed row whose guest is still the listed value: the guest, less
 * its hour note, becomes `topic`; the old `topic`, lowercased, joins `aiTags`
 * unless it is there already; `guestName` is removed. Nothing else is
 * touched, and re-running is a no-op.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { MOVED_TO_TOPIC, topicFromGuest } from "../src/lib/library/guest.ts";

const FILE = new URL("../public/seed/library.json", import.meta.url);
const rows = JSON.parse(readFileSync(FILE, "utf8"));
const hits = rows.filter((r) => MOVED_TO_TOPIC[r.fileHash] !== undefined && r.guestName === MOVED_TO_TOPIC[r.fileHash]);
for (const r of hits) {
  const topic = topicFromGuest(r.guestName);
  const old = r.topic?.trim();
  const tag = old && !(r.aiTags ?? []).includes(old.toLowerCase()) ? old.toLowerCase() : null;
  console.log(`| ${r.airDate} | ${r.guestName} | ${topic} | ${old ?? ""} | ${tag ?? "(already a tag)"} |`);
  if (process.argv.includes("--write")) {
    r.topic = topic;
    if (tag) r.aiTags = [...(r.aiTags ?? []), tag];
    delete r.guestName;
  }
}
console.error(`${hits.length} row(s) to move`);
if (process.argv.includes("--write") && hits.length) {
  writeFileSync(FILE, JSON.stringify(rows, null, 2) + "\n");
  console.error("written");
}
