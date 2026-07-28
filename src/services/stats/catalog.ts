/**
 * Resolves community episode ids back to something readable.
 *
 * The stats database stores only the community key (`{collection}--{file}`),
 * because that is the one identifier the browser is willing to send and the
 * server is willing to trust. That is fine for the site itself, where the
 * client already holds the catalog in IndexedDB and can look the title up
 * locally — but an export consumed by sang3r.com has no such catalog, and a
 * dashboard listing `ultimate-ultimate-art-bell-collection--1992-12-12_-_...`
 * is not an analytics dashboard, it is a hex dump.
 *
 * Reads the shipped seed catalog off disk on first use and keeps the map for
 * the life of the process. Deliberately not an `import` of the JSON: the file
 * is ~2 MB and would be inlined into the route bundle, for a lookup only the
 * export path ever needs.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { communityKey } from "@/lib/utils/community-key";

export interface CatalogEntry {
  title: string;
  airDate: string | null;
  guestName: string | null;
  showType: string | null;
  topic: string | null;
}

interface SeedEpisode {
  archiveIdentifier?: string | null;
  fileName: string;
  title?: string;
  airDate?: string | null;
  guestName?: string | null;
  showType?: string | null;
  topic?: string | null;
}

let _catalog: Map<string, CatalogEntry> | null = null;
let _loading: Promise<Map<string, CatalogEntry>> | null = null;

async function load(): Promise<Map<string, CatalogEntry>> {
  const map = new Map<string, CatalogEntry>();
  try {
    const file = path.join(process.cwd(), "public", "seed", "library.json");
    const episodes = JSON.parse(await readFile(file, "utf8")) as SeedEpisode[];

    for (const ep of episodes) {
      const key = communityKey(ep);
      if (!key) continue;
      map.set(key, {
        title: ep.title || ep.fileName,
        airDate: ep.airDate ?? null,
        guestName: ep.guestName ?? null,
        showType: ep.showType ?? null,
        topic: ep.topic ?? null,
      });
    }
  } catch (err) {
    // A missing or malformed catalog degrades the export to bare ids, which is
    // still valid data. It must never fail the request.
    console.error("[stats/catalog] could not load seed catalog:", err);
  }
  return map;
}

/** The id → episode map, loaded once. Concurrent callers share one read. */
export async function catalog(): Promise<Map<string, CatalogEntry>> {
  if (_catalog) return _catalog;
  if (!_loading) {
    _loading = load().then((m) => {
      _catalog = m;
      _loading = null;
      return m;
    });
  }
  return _loading;
}

/**
 * Attach catalog fields to rows keyed by episode id.
 *
 * Unknown ids keep their id and get a null title rather than being dropped —
 * an episode imported after this build shipped is still a real play, and
 * silently omitting it would make the totals disagree with the summary.
 */
export type WithEpisodeInfo<T> = T & {
  [K in keyof CatalogEntry]: CatalogEntry[K] | null;
};

export async function withEpisodeInfo<T extends { episodeId: string }>(
  rows: T[],
): Promise<WithEpisodeInfo<T>[]> {
  const map = await catalog();
  return rows.map((row) => {
    const info = map.get(row.episodeId);
    return {
      ...row,
      title: info?.title ?? null,
      airDate: info?.airDate ?? null,
      guestName: info?.guestName ?? null,
      showType: info?.showType ?? null,
      topic: info?.topic ?? null,
    };
  });
}
