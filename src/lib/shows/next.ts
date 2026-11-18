import type { ShowCatalog } from "@/lib/shows/catalog";
import type { Show } from "@/lib/shows/describe";
import { guestPeople, personKey } from "@/lib/shows/people";
import type { Topic } from "@/lib/topics/catalog";

/**
 * A show page's "Next" (docs/NEXT.md, round 2, item 3; docs/show-pages.md,
 * "The next show"). 736 desktop arrivals in 30 days landed on a show page
 * from outside and the page offered nothing to play after it. So every show
 * page names one next show, with one Play:
 *
 * 1. **The same guest**: the guest's next appearance after this one, else
 *    their earliest other show.
 * 2. **Else the same topic**, most specific first (the order the page names
 *    its topics): the nearest show after this one on that topic, else the
 *    nearest before it.
 *
 * Pure, from the catalog: the page stays a server page, and the pick is the
 * same for every visitor and every render. Null when nothing qualifies.
 */

export type NextReason = "guest" | "topic";

export interface NextShow {
  show: Show;
  reason: NextReason;
  /** The guest the two shows share (reason "guest"). */
  guest?: string;
  /** The topic the two shows share (reason "topic"). */
  topic?: Topic;
}

/** The DOM event the Next Play sends on the page's `<audio>` when it moves it to the next show. */
export const SHOW_SWITCH_EVENT = "hdshowswitch";

export interface ShowSwitchDetail {
  /** The next show's community key: its listen is counted from here on. */
  episodeId: string | null;
}

const airOf = (s: Show) => s.row.airDate ?? "";
const byAir = (a: Show, b: Show) => airOf(a).localeCompare(airOf(b)) || a.slug.localeCompare(b.slug);

/** The first show after `here` in air order, else the last one before it. */
function nearestAfter(candidates: Show[], here: Show): Show | null {
  const others = candidates.filter((s) => s.slug !== here.slug).sort(byAir);
  if (!others.length) return null;
  const after = others.find((s) => byAir(s, here) > 0);
  return after ?? others[others.length - 1];
}

export function nextShow(show: Show, catalog: ShowCatalog, topics: readonly Topic[]): NextShow | null {
  for (const person of guestPeople(show.row)) {
    const theirs = (catalog.byPerson.get(personKey(person)) ?? []).filter((s) => s.slug !== show.slug).sort(byAir);
    if (!theirs.length) continue;
    const next = theirs.find((s) => byAir(s, show) > 0) ?? theirs[0];
    return { show: next, reason: "guest", guest: person };
  }
  for (const topic of topics) {
    const next = nearestAfter(topic.shows, show);
    if (next) return { show: next, reason: "topic", topic };
  }
  return null;
}
