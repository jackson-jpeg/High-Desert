"use client";

import { useEffect, useSyncExternalStore } from "react";
import { communityKey } from "@/lib/utils/community-key";

/**
 * A catalog show's page slug, asked of `/api/shows/link` once per show per
 * page load (src/lib/shows/share.ts). Looked up when a Share button mounts,
 * not when it is pressed: the share sheet must open inside the tap, with
 * nothing awaited first.
 *
 *   undefined  still asking (or not asked: no community key)
 *   null       not a catalog show: no page
 *   string     the slug
 */

const known = new Map<string, string | null>();
const asking = new Map<string, Promise<string | null>>();
const listeners = new Set<() => void>();

function learn(key: string, slug: string | null): void {
  known.set(key, slug);
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function lookupShowSlug(key: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (known.has(key)) return Promise.resolve(known.get(key)!);
  let p = asking.get(key);
  if (!p) {
    p = fetcher(`/api/shows/link?key=${encodeURIComponent(key)}`)
      .then(async (res) => {
        // A 404 is an answer (no page); anything else is not, and is asked again next time.
        if (res.status === 404) {
          learn(key, null);
          return null;
        }
        if (!res.ok) return null;
        const body = (await res.json()) as { slug?: unknown };
        const slug = typeof body.slug === "string" ? body.slug : null;
        if (slug) learn(key, slug);
        return slug;
      })
      .catch(() => null)
      .finally(() => asking.delete(key));
    asking.set(key, p);
  }
  return p;
}

export function useShowSlug(episode: { archiveIdentifier?: string | null; fileName: string } | null | undefined): string | null | undefined {
  const key = episode ? communityKey(episode) : null;
  const slug = useSyncExternalStore(
    subscribe,
    () => (key ? known.get(key) : undefined),
    () => undefined,
  );
  useEffect(() => {
    if (key && !known.has(key)) void lookupShowSlug(key);
  }, [key]);
  return slug;
}

export function forgetShowSlugsForTests(): void {
  known.clear();
  asking.clear();
}
