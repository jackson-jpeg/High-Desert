import { shownGuest } from "@/lib/library/guest";
import { stripHonorific } from "@/lib/shows/slugify";

/**
 * The people in a show's guest field, for structured data, guest pages and
 * "more with this guest" (docs/show-pages.md).
 *
 * The field is free text: "John Lear and Bob Lazar", "Richard C. Hoagland,
 * Tom Van Flandern", "Terry and Linda Jamison", but also "Euthanasia &
 * Immigration" and "The September 11, 2001 Show". A wrong Person in JSON-LD is
 * worse than none, so this is strict: every part must look like a name, or
 * the field yields nobody at all (the page still prints it as written).
 */

const SEPARATORS = /\s*,\s*(?:and\s+)?|\s+&\s+|\s+and\s+/i;

/** A word that can sit inside a name: capitalised, an initial, or a particle. */
const NAME_WORD =
  /^(?:\p{Lu}[\p{L}'’-]*\.?|(?:\p{Lu}\.)+|(?:van|von|de|del|der|la|le|da|di|du|st\.?)|(?:de|di|da|du|la|le|van|von)\p{Lu}\p{L}+|Jr\.?|Sr\.?|II|III)$/u;

/** Words that say a part is a programme, not a person. */
const NOT_A_NAME = /\b(?:show|night|lines?|callers?|hour|special|predictions?|tribute|open|news|the|gals|disclosure|thinking|attack)\b/i;

function looksLikeName(part: string): boolean {
  if (/\d/.test(part) || NOT_A_NAME.test(part)) return false;
  const words = part.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  return words.every((w) => NAME_WORD.test(w)) && /^\p{Lu}/u.test(words[words.length - 1]);
}

/**
 * The guests' names, or [] when the field is absent, not a guest
 * (`shownGuest`), or not a list of names.
 */
export function guestPeople(ep: { title?: string | null; guestName?: string | null; fileHash?: string | null }): string[] {
  const field = shownGuest(ep);
  if (!field) return [];
  const parts = field.split(SEPARATORS).map((p) => p.trim()).filter(Boolean);
  const people: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    // "Terry and Linda Jamison": a lone first name borrows the next surname.
    if (!/\s/.test(p) && /^[A-Z][a-z]+$/.test(p) && i + 1 < parts.length) {
      const next = parts[i + 1].split(/\s+/);
      if (next.length >= 2) {
        people.push(`${p} ${next[next.length - 1]}`);
        continue;
      }
      return [];
    }
    if (!looksLikeName(p)) return [];
    people.push(p);
  }
  return people;
}

/** One key per person: case, honorifics and punctuation ignored. */
export function personKey(name: string): string {
  return stripHonorific(name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
