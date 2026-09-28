#!/usr/bin/env node
/**
 * Adds the shows in data/community-sources.json to the seed catalog
 * (public/seed/library.json): shows a listener's torrents named, that the
 * catalog lacked and archive.org holds (docs/community-sources.md).
 *
 *   node scripts/import-community-sources.mjs          # add what is missing
 *   node scripts/import-community-sources.mjs --check  # exit 1 if anything would change
 *
 * The rows are built as collection import builds them
 * (src/services/archive/collection-import.ts): identity `archive:{identifier}:{fileName}`
 * (archiveFileHash), the stream URL `https://archive.org/download/{id}/{file}`
 * (getStreamUrl), and size, duration and format from archive.org's own item
 * metadata, fetched here. Guest, topic and show come from the curated entry,
 * because these file names run guest and topic together. `aiStatus: "pending"`
 * and no AI fields: scripts/categorize-library.py writes those offline, as for
 * any imported episode.
 *
 * Add-only and idempotent: a fileHash already in the catalog is left exactly as
 * it is. The catalog stays ordered by air date. After running it:
 *   node scripts/gen-community-keys.mjs
 *   node scripts/build-torrent-index.mjs --hash   (the mirror refuses an episode with no torrent)
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "public/seed/library.json");
const SOURCES = path.join(ROOT, "data/community-sources.json");

/** src/db/identity.ts archiveFileHash, restated (no TS loader here). */
export const archiveFileHash = (identifier, fileName) => `archive:${identifier}:${fileName}`;
/** src/services/archive/client.ts getStreamUrl, restated. */
export const streamUrl = (identifier, fileName) =>
  `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(fileName)}`;

/**
 * Art Bell hosted Midnight in the Desert from 2015-07-20 until he stepped down
 * on 2015-12-11; Heather Wade hosted after. This catalog is Art Bell's.
 */
export const MITD_LAST_DAY = "2015-12-11";

/** One catalog row from a curated entry and archive.org's record of the file. */
export function rowFor(entry, file) {
  if (entry.show === "Midnight in the Desert" && entry.airDate > MITD_LAST_DAY) {
    throw new Error(`${entry.fileName}: after Art Bell's last Midnight in the Desert (${MITD_LAST_DAY})`);
  }
  if (!file) throw new Error(`archive.org has no ${entry.fileName} in ${entry.archiveIdentifier}`);
  const url = streamUrl(entry.archiveIdentifier, entry.fileName);
  const row = {
    fileHash: archiveFileHash(entry.archiveIdentifier, entry.fileName),
    fileName: entry.fileName,
    filePath: url,
    fileSize: Number(file.size),
    title: `${entry.show} - ${entry.topic ?? entry.guestName}`,
    artist: "Art Bell",
    airDate: entry.airDate,
    ...(entry.guestName ? { guestName: entry.guestName } : {}),
    showType: entry.showType,
    ...(entry.topic ? { topic: entry.topic } : {}),
    duration: Number(file.length),
    format: "mp3",
    source: "archive",
    sourceUrl: url,
    archiveIdentifier: entry.archiveIdentifier,
    // As collection import writes it. Without it the seeder reads the row as
    // categorised ("completed") when it has no summary or tags at all.
    aiStatus: "pending",
  };
  if (!(row.fileSize > 0) || !(row.duration > 0)) throw new Error(`archive.org gives no size or length for ${entry.fileName}`);
  return row;
}

/** The catalog with `rows` added where missing, still ordered by air date. */
export function merge(catalog, rows) {
  const have = new Set(catalog.map((e) => e.fileHash));
  const added = rows.filter((r) => !have.has(r.fileHash));
  // Stable: an existing row keeps its place among rows of its own date.
  const out = [...catalog];
  for (const r of added) {
    let i = out.length;
    while (i > 0 && out[i - 1].airDate > r.airDate) i--;
    out.splice(i, 0, r);
  }
  return { catalog: out, added };
}

async function metadata(identifier) {
  const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
    headers: { "user-agent": "highdesert.space catalog import (+https://highdesert.space)" },
  });
  if (!res.ok) throw new Error(`archive.org metadata ${identifier}: HTTP ${res.status}`);
  const body = await res.json();
  return new Map((body.files ?? []).map((f) => [f.name, f]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { added: entries } = JSON.parse(await readFile(SOURCES, "utf8"));
  const catalog = JSON.parse(await readFile(CATALOG, "utf8"));
  const items = new Map();
  for (const id of new Set(entries.map((e) => e.archiveIdentifier))) {
    items.set(id, await metadata(id));
    await new Promise((r) => setTimeout(r, 500)); // at most 2 requests a second
  }
  const rows = entries.map((e) => rowFor(e, items.get(e.archiveIdentifier).get(e.fileName)));
  const { catalog: next, added } = merge(catalog, rows);
  if (process.argv.includes("--check")) {
    console.log(`${added.length} to add`);
    process.exit(added.length ? 1 : 0);
  }
  await writeFile(CATALOG, JSON.stringify(next, null, 2) + "\n");
  console.log(`added ${added.length} of ${rows.length}; catalog now ${next.length}`);
}
