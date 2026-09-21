import { SORT_MODES, type SortMode } from "@/lib/library/filter-episodes";

/**
 * Library intents: things the rest of the app asks the library to do —
 * shuffle, sort, search, find the show that is playing (HD-013).
 *
 * They used to be window events, and the library page was their only
 * listener. Fired from the menu bar, the command palette or the mobile sheet
 * on /stats, they went nowhere; the workaround was to navigate and then
 * `setTimeout(fire, 150)`, hoping the page had mounted by then. Carrying them
 * in the URL instead means the intent arrives *with* the page: the library
 * reads it on mount (or when a client-side navigation brings new params),
 * applies it, and clears it from the address bar.
 *
 * One approach everywhere: callers always navigate to the intent URL, on
 * /library as well — push from another route, replace on /library itself so
 * the intent adds no history entry (useOpenLibraryIntent). No caller emits
 * straight into the library, so there is one path to test.
 *
 *   /library?shuffle=coast      all | coast | dreamland | special
 *   /library?sort=played        any SortMode (SORT_MODES)
 *   /library?q=ghost%20to%20ghost
 *   /library?scroll=current
 *
 * Parsing is strict and silent: an unknown value is ignored, not guessed at —
 * a hand-edited or stale URL must not shuffle something the listener did not
 * ask for.
 */

export const SHUFFLE_SCOPES = ["all", "coast", "dreamland", "special"] as const;
export type ShuffleScope = (typeof SHUFFLE_SCOPES)[number];

export interface LibraryIntent {
  sort?: SortMode;
  shuffle?: ShuffleScope;
  /** Search box text. Trimmed; empty is no intent. */
  q?: string;
  scroll?: "current";
}

/** The query parameters this module owns. Anything else in the URL is left alone. */
export const INTENT_PARAMS = ["sort", "shuffle", "q", "scroll"] as const;

/** Long enough for any real search; bounds what a pasted URL can put in the box. */
export const MAX_QUERY_LENGTH = 200;

interface ParamReader {
  get(name: string): string | null;
}

export function parseLibraryIntent(params: ParamReader): LibraryIntent {
  const intent: LibraryIntent = {};

  const sort = params.get("sort");
  if (sort !== null && (SORT_MODES as readonly string[]).includes(sort)) intent.sort = sort as SortMode;

  const shuffle = params.get("shuffle");
  if (shuffle !== null && (SHUFFLE_SCOPES as readonly string[]).includes(shuffle)) {
    intent.shuffle = shuffle as ShuffleScope;
  }

  const q = params.get("q")?.trim();
  if (q) intent.q = q.slice(0, MAX_QUERY_LENGTH);

  if (params.get("scroll") === "current") intent.scroll = "current";

  return intent;
}

export function hasIntent(intent: LibraryIntent): boolean {
  return intent.sort !== undefined || intent.shuffle !== undefined || intent.q !== undefined || intent.scroll !== undefined;
}

/** Any intent parameter present at all, valid or not — it still needs clearing. */
export function hasIntentParams(params: ParamReader): boolean {
  return INTENT_PARAMS.some((p) => params.get(p) !== null);
}

/** `/library?…` for an intent. Parameters in INTENT_PARAMS order, so equal intents make equal URLs. */
export function libraryIntentHref(intent: LibraryIntent): string {
  const params = new URLSearchParams();
  if (intent.sort) params.set("sort", intent.sort);
  if (intent.shuffle) params.set("shuffle", intent.shuffle);
  if (intent.q?.trim()) params.set("q", intent.q.trim());
  if (intent.scroll) params.set("scroll", intent.scroll);
  const qs = params.toString();
  return qs ? `/library?${qs}` : "/library";
}

/** The current query string minus the intent parameters (e.g. `?viewer` survives). */
export function withoutIntentParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const p of INTENT_PARAMS) params.delete(p);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
