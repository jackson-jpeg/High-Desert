/**
 * A guest field that is not a guest (2026-10-01, docs/catalog-guests.md).
 *
 * 136 catalog rows carried their own subject in `guestName`: "Open Lines",
 * "Ghost to Ghost 1997 Night 1", "Open Lines with Area 51 Employees Call-in".
 * Every surface then read "Open Lines with Area 51 Employees · Open Lines with
 * Area 51 Employees Call-in". They are cleared in the seed; a library seeded
 * earlier keeps its rows (reconcile never rewrites one), so surfaces show the
 * guest through `shownGuest()`, which hides exactly what the seed cleanup
 * removed.
 *
 * Two conditions, both required: the field names a programme, not a person
 * (`NOT_A_PERSON`), and its words and the title's subject (after " - ") are
 * one inside the other. A person whose name is the title ("Coast to Coast AM -
 * Richard C. Hoagland") is a real guest and stays.
 */

const NOT_A_PERSON =
  /open lines|ghost to ghost|prediction|time travel|area 51|contact night|sound clips|bombing|electronic voice|\bart'?s\b|art and ramona|death threats|ladies room|long call|life of edgar|phoenix lights|\blines\b|call-?in|hour \d|news,|special|tribute|retire|resign|statement/i;

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.replace(/s$/, ""));
}

/** True when `guest` only repeats the title's subject. */
export function guestRepeatsTitle(title: string | null | undefined, guest: string | null | undefined): boolean {
  if (!guest || !title || !NOT_A_PERSON.test(guest)) return false;
  const i = title.indexOf(" - ");
  const subject = words(i >= 0 ? title.slice(i + 3) : title);
  const g = words(guest);
  if (!subject.length || !g.length) return false;
  return subject.every((w) => g.includes(w)) || g.every((w) => subject.includes(w));
}

/** The guest to show for a row, or undefined when the field only repeats the title. */
export function shownGuest(ep: { title?: string | null; guestName?: string | null } | null | undefined): string | undefined {
  const g = ep?.guestName?.trim();
  if (!g) return undefined;
  return guestRepeatsTitle(ep?.title, g) ? undefined : g;
}
