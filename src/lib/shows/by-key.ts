import { showCatalog } from "@/lib/shows/load";
import type { Show } from "@/lib/shows/describe";
import { communityKey } from "@/lib/utils/community-key";

/**
 * A catalog show by its community key (src/lib/utils/community-key.ts): how
 * the library names a show, since the slug map stays on the server. Read by
 * `/show/key/<key>` and `/api/shows/link`.
 */

let byKey: Map<string, Show> | null = null;

export function showByKey(key: string): Show | undefined {
  if (!byKey) {
    byKey = new Map();
    for (const show of showCatalog().shows) {
      const k = communityKey(show.row);
      if (k) byKey.set(k, show);
    }
  }
  return byKey.get(key);
}
