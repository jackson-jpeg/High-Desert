import COMMUNITY_KEYS from "@/data/community-keys.json";

/**
 * The set of episode ids the stats write routes will accept.
 *
 * Generated from the shipped catalog by scripts/gen-community-keys.mjs. Without
 * this, POST /api/stats/play accepted any string matching a loose character
 * pattern and created a new row per distinct value — unbounded write
 * amplification, plus forged play counts on episodes that don't exist.
 *
 * Built once per process at module load.
 */
const KEYS: ReadonlySet<string> = new Set(COMMUNITY_KEYS as string[]);

export function isKnownEpisodeId(id: string): boolean {
  return KEYS.has(id);
}

export function knownEpisodeIdCount(): number {
  return KEYS.size;
}
