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

const BELL = "archive:ultimate-ultimate-art-bell-collection:";

/**
 * Ten guest fields that describe the programme rather than repeat the title
 * (2026-10-09, docs/catalog-guests.md "Moved to the topic"). The seed moved
 * each into the row's `topic` and left the guest empty
 * (scripts/move-guest-topics.mjs); a library seeded earlier keeps the old
 * guest, so `shownGuest()` hides exactly this value on exactly this row.
 */
export const MOVED_TO_TOPIC: Readonly<Record<string, string>> = {
  [`${BELL}1997-06-30 - Coast to Coast AM with Art Bell - News, Commentary, Open Lines (hour 1).mp3`]: "News, Commentary, Open Lines (hour 1)",
  [`${BELL}1997-08-11 - Coast to Coast AM with Art Bell - UPS strike (hour 1).mp3`]: "UPS strike (hour 1)",
  [`${BELL}1997-08-18 - Coast to Coast AM with Art Bell - News, Commentary, Open Lines (hour 1).mp3`]: "News, Commentary, Open Lines (hour 1)",
  [`${BELL}1997-11-26 - Coast to Coast AM with Art Bell - News, Commentary, Open Lines (hour 1).mp3`]: "News, Commentary, Open Lines (hour 1)",
  [`${BELL}1997-12-02 - Coast to Coast AM with Art Bell - News, Commentary, Open Lines (hour 1).mp3`]: "News, Commentary, Open Lines (hour 1)",
  [`${BELL}1997-12-31 - Coast to Coast AM with Art Bell - New Year's Predictions Night 2 (1st hour).mp3`]: "New Year's Predictions Night 2 (1st hour)",
  [`${BELL}1999-05-27 - Coast to Coast AM with Art Bell - Art's Secret - Internet Defamation.mp3`]: "Art's Secret",
  [`${BELL}2001-02-28 - Coast to Coast AM with Art Bell - Ghost To Ghost Stories.mp3`]: "Ghost To Ghost Stories",
  [`${BELL}2001-08-31 - Coast to Coast AM with Art Bell - Area 51, Earthquakes, and Crop Circles - Open Lines.mp3`]: "Area 51, Earthquakes, and Crop Circles",
  [`${BELL}2003-12-31 - Coast to Coast AM with Art Bell - Annual Predictions Show - Open Lines.mp3`]: "Annual Predictions Show",
};

/** A moved guest as a topic: the file's hour note dropped ("(hour 1)", "(1st hour)"). */
export function topicFromGuest(guest: string): string {
  return guest.replace(/\s*\((?:hour \d+|\d+(?:st|nd|rd|th) hour)\)\s*$/i, "").trim();
}

/** The guest to show for a row, or undefined when the field is not a guest. */
export function shownGuest(
  ep: { title?: string | null; guestName?: string | null; fileHash?: string | null } | null | undefined,
): string | undefined {
  const g = ep?.guestName?.trim();
  if (!g) return undefined;
  if (ep?.fileHash && MOVED_TO_TOPIC[ep.fileHash] === g) return undefined;
  return guestRepeatsTitle(ep?.title, g) ? undefined : g;
}
