/**
 * Generates src/data/community-keys.json from the shipped seed catalog.
 *
 * The stats write routes accept an episodeId only if it appears in this list.
 * Without it, POST /api/stats/play accepted any string and minted a new row per
 * distinct value — unbounded write amplification, and forged play counts.
 *
 * Run after changing public/seed/library.json:
 *   node scripts/gen-community-keys.mjs
 *
 * src/services/stats/__tests__/community-keys.test.ts fails if the two drift.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Must stay identical to communityKey() in src/lib/utils/community-key.ts. */
function communityKey(episode) {
  if (!episode.archiveIdentifier) return null;
  const sanitized = String(episode.fileName ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);
  return `${episode.archiveIdentifier}--${sanitized}`;
}

const raw = JSON.parse(
  fs.readFileSync(path.join(root, "public/seed/library.json"), "utf8"),
);
const rows = Array.isArray(raw) ? raw : raw.episodes;

const keys = [...new Set(rows.map(communityKey).filter(Boolean))].sort();

const outDir = path.join(root, "src/data");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "community-keys.json"),
  JSON.stringify(keys) + "\n",
);

console.log(`${rows.length} catalog rows -> ${keys.length} community keys`);
