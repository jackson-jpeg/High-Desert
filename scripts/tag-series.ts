/**
 * tag-series.ts — Deterministic series tagger for the seed library
 *
 * Reads public/seed/library.json, matches episodes to known multi-part series
 * by title/guest/date patterns, writes aiSeries + aiSeriesPart back.
 *
 * Usage: npx tsx scripts/tag-series.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

interface SeedEpisode {
  fileHash: string;
  fileName: string;
  filePath?: string;
  fileSize?: number;
  title?: string;
  artist?: string;
  airDate?: string;
  guestName?: string;
  showType?: string;
  topic?: string;
  duration?: number;
  format?: string;
  source?: string;
  sourceUrl?: string;
  archiveIdentifier?: string;
  aiSummary?: string;
  aiTags?: string[];
  aiStatus?: string;
  aiCategory?: string;
  aiSeries?: string;
  aiSeriesPart?: number;
}

interface SeriesDefinition {
  name: string;
  match: (ep: SeedEpisode) => boolean;
}

// ── Series Definitions ──────────────────────────────────────────────────────
// Each definition matches episodes by title, guest, and/or date patterns.
// Matched episodes are sorted by airDate and assigned sequential part numbers.

const SERIES: SeriesDefinition[] = [
  {
    name: "Mel's Hole",
    match: (ep) => /mel.?s hole|mel waters/i.test(ep.title ?? "") || /mel waters/i.test(ep.guestName ?? ""),
  },
  {
    name: "Mad Man Marcum",
    match: (ep) =>
      /mad\s*man\s*marcum/i.test(ep.title ?? "") ||
      /marcum/i.test(ep.guestName ?? "") ||
      (/marcum/i.test(ep.title ?? "") && /time/i.test(ep.title ?? "")),
  },
  {
    name: "Ghost to Ghost",
    match: (ep) => /ghost\s*to\s*ghost/i.test(ep.title ?? ""),
  },
  {
    name: "Predictions Show",
    match: (ep) => /prediction/i.test(ep.title ?? "") && /\b(19|20)\d{2}\b/.test(ep.title ?? ""),
  },
  {
    name: "Art's Parts",
    match: (ep) => /art.?s parts/i.test(ep.title ?? ""),
  },
  {
    name: "Shadow People",
    match: (ep) => /shadow\s*people/i.test(ep.title ?? ""),
  },
  {
    name: "Area 51 Caller",
    match: (ep) => /area\s*51/i.test(ep.title ?? "") && /caller/i.test(ep.title ?? ""),
  },
  {
    name: "Phoenix Lights",
    match: (ep) => /phoenix\s*lights?/i.test(ep.title ?? ""),
  },
  {
    name: "Hale-Bopp",
    match: (ep) => /hale[\s-]*bopp/i.test(ep.title ?? ""),
  },
  {
    name: "Y2K",
    match: (ep) => {
      const title = ep.title ?? "";
      const year = parseInt(ep.airDate?.slice(0, 4) ?? "0", 10);
      return (/\by2k\b/i.test(title) || /year\s*2000/i.test(title)) && year >= 1998 && year <= 2000;
    },
  },
  {
    name: "Philadelphia Experiment",
    match: (ep) => /philadelphia\s*experiment/i.test(ep.title ?? "") || /al\s*bielek/i.test(ep.guestName ?? ""),
  },
  {
    name: "Roswell",
    match: (ep) => /\broswell\b/i.test(ep.title ?? ""),
  },
  {
    name: "HAARP",
    match: (ep) => /\bhaarp\b/i.test(ep.title ?? ""),
  },
  {
    name: "Alien Autopsy",
    match: (ep) => /alien\s*autopsy/i.test(ep.title ?? "") || (/autopsy/i.test(ep.title ?? "") && !!ep.airDate?.startsWith("1995")),
  },
  {
    name: "Chemtrails",
    match: (ep) => /chemtrail/i.test(ep.title ?? ""),
  },
  {
    name: "Reverse Speech",
    match: (ep) => /reverse\s*speech/i.test(ep.title ?? "") || /david\s*oates/i.test(ep.guestName ?? ""),
  },
  {
    name: "Face on Mars",
    match: (ep) => /face\s*on\s*mars/i.test(ep.title ?? "") || /\bcydonia\b/i.test(ep.title ?? ""),
  },
  {
    name: "Dark Matter",
    match: (ep) => {
      const title = ep.title ?? "";
      return /dark\s*matter/i.test(title) && ep.showType === "special" && !!ep.airDate?.startsWith("2013");
    },
  },
  {
    name: "Courtney Brown",
    match: (ep) => /courtney\s*brown/i.test(ep.title ?? "") || /courtney\s*brown/i.test(ep.guestName ?? "") || /farsight/i.test(ep.title ?? ""),
  },
  {
    name: "John Titor",
    match: (ep) => {
      const title = ep.title ?? "";
      const year = parseInt(ep.airDate?.slice(0, 4) ?? "0", 10);
      return /john\s*titor/i.test(title) || (/time\s*travell?er/i.test(title) && year >= 2000 && year <= 2003);
    },
  },
];

// ── Main ────────────────────────────────────────────────────────────────────

const libraryPath = join(__dirname, "..", "public", "seed", "library.json");
const episodes: SeedEpisode[] = JSON.parse(readFileSync(libraryPath, "utf-8"));

let totalTagged = 0;
const seriesStats: { name: string; count: number }[] = [];

for (const series of SERIES) {
  const matches = episodes.filter(series.match);
  if (matches.length === 0) continue;

  // Sort by airDate for sequential part numbering
  matches.sort((a, b) => (a.airDate ?? "").localeCompare(b.airDate ?? ""));

  for (let i = 0; i < matches.length; i++) {
    matches[i].aiSeries = series.name;
    matches[i].aiSeriesPart = i + 1;
  }

  seriesStats.push({ name: series.name, count: matches.length });
  totalTagged += matches.length;
}

// Write updated library back
writeFileSync(libraryPath, JSON.stringify(episodes, null, 2) + "\n");

// Report
console.log(`\nTagged ${totalTagged} episodes across ${seriesStats.length} series:\n`);
for (const { name, count } of seriesStats.sort((a, b) => b.count - a.count)) {
  console.log(`  ${name}: ${count} episodes`);
}
console.log();
