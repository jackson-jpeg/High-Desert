"use client";

import { useMemo } from "react";
import type { Episode } from "@/db/schema";
import { useOpenLibraryIntent } from "@/hooks/useOpenLibraryIntent";
import { tagCounts } from "@/lib/stats/library-stats";

/** How many tags the index shows, most used first. */
export const TOPIC_INDEX_SIZE = 50;

/**
 * The Topic Index: the catalog's most used tags, sized by how many shows
 * carry each, a tap away from the shows (`tag:<name>` in the Library's
 * search). It lived on /stats; it is a way into the shows, so it is in the
 * Library's Explore now (UI plan push 6, batch 3).
 */
export function TopicIndex({ episodes }: { episodes: Episode[] | undefined }) {
  const openLibrary = useOpenLibraryIntent();
  const { top, unique, max } = useMemo(() => {
    const counts = tagCounts(episodes ?? []);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOPIC_INDEX_SIZE);
    return { top: sorted, unique: counts.size, max: sorted[0]?.[1] ?? 1 };
  }, [episodes]);
  if (top.length === 0) return null;

  return (
    <section className="flex flex-col gap-1.5" aria-labelledby="topic-index-h" data-testid="topic-index">
      <h3 id="topic-index-h" className="text-hd-10 text-desert-amber uppercase tracking-wider font-bold">
        Topic Index <span className="font-normal text-bevel-dark">· {unique.toLocaleString()} tags</span>
      </h3>
      <div className="flex flex-wrap gap-x-2 gap-y-1.5">
        {top.map(([tag, count]) => {
          const ratio = count / max;
          return (
            <button
              key={tag}
              type="button"
              className="tag-cloud-item hd-topic-tag text-desert-amber cursor-pointer select-none hover:underline min-h-touch md:min-h-0"
              // 11 to 20 px, scaled with the text-size setting like the text-hd-* steps.
              style={{ fontSize: `calc(${11 + ratio * 9}px * var(--hd-text-scale, 1))` }}
              title={`${count} ${count === 1 ? "show" : "shows"} tagged ${tag}`}
              data-tag={tag}
              onClick={() => openLibrary({ q: `tag:${tag}` })}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </section>
  );
}
