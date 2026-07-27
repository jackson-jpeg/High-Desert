/**
 * Imports a community-stats snapshot (captured from the old Vercel KV
 * deployment via the public read APIs) into Postgres.
 *
 * Idempotent: play counts and rating aggregates are SET, not incremented, so
 * re-running with a fresher snapshot just overwrites with newer totals.
 *
 * Keys not present in the catalog allowlist are skipped and reported — notably
 * the legacy bare `ultimate-ultimate-art-bell-collection` key, which accumulated
 * 867 plays before community keys included the filename and cannot be
 * attributed to individual episodes.
 *
 *   node scripts/import-stats-snapshot.mjs /root/high-desert-backups/stats-snapshot-2026-07-27.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = process.argv[2];
if (!snapshotPath) {
  console.error("usage: node scripts/import-stats-snapshot.mjs <snapshot.json>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const snap = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const allow = new Set(
  JSON.parse(fs.readFileSync(path.join(root, "src/data/community-keys.json"), "utf8")),
);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const counts = Object.entries(snap.counts ?? {}).filter(([, v]) => Number(v) > 0);
const ratings = Object.entries(snap.ratings ?? {}).filter(
  ([, v]) => v && Number(v.count) > 0,
);

const skipped = [];
let importedPlays = 0;
let importedRatings = 0;

const client = await pool.connect();
try {
  await client.query("BEGIN");

  for (const [id, plays] of counts) {
    if (!allow.has(id)) {
      skipped.push({ id, plays: Number(plays) });
      continue;
    }
    await client.query(
      `INSERT INTO episode_plays (episode_id, plays) VALUES ($1, $2)
       ON CONFLICT (episode_id) DO UPDATE SET plays = EXCLUDED.plays`,
      [id, Number(plays)],
    );
    importedPlays += Number(plays);
  }

  for (const [id, r] of ratings) {
    if (!allow.has(id)) {
      skipped.push({ id, rating: r });
      continue;
    }
    const count = Number(r.count);
    const sum = Number(r.avg) * count;
    await client.query(
      `INSERT INTO episode_ratings (episode_id, sum, count) VALUES ($1, $2, $3)
       ON CONFLICT (episode_id) DO UPDATE SET sum = EXCLUDED.sum, count = EXCLUDED.count`,
      [id, sum, count],
    );
    importedRatings += count;
  }

  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
}

const { rows: verify } = await pool.query(
  `SELECT (SELECT count(*) FROM episode_plays)   AS ep_rows,
          (SELECT coalesce(sum(plays),0) FROM episode_plays) AS ep_plays,
          (SELECT count(*) FROM episode_ratings) AS rt_rows`,
);

console.log(`snapshot taken:   ${snap.takenAt}`);
console.log(`episodes w/plays: ${counts.length} -> imported ${verify[0].ep_rows} rows, ${verify[0].ep_plays} plays`);
console.log(`episodes w/rating:${ratings.length} -> imported ${verify[0].rt_rows} rows (${importedRatings} votes)`);
if (skipped.length) {
  console.log(`\nskipped ${skipped.length} key(s) not in the catalog allowlist:`);
  for (const s of skipped) console.log(`  ${JSON.stringify(s)}`);
}
void importedPlays;

await pool.end();
