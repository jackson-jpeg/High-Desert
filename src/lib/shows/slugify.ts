/**
 * URL slugs for show and guest pages (docs/show-pages.md).
 *
 * No imports, on purpose: `scripts/gen-show-slugs.mjs` imports this file
 * straight from Node (type stripping), where the `@/` alias does not resolve.
 *
 * A show's slug is minted once by that script and committed in
 * `data/show-slugs.json`; it is never recomputed, so a corrected title or
 * guest never moves a page Google has already indexed. A guest's slug is
 * computed from the name (`guestSlug`), because a guest page is a list, not a
 * record, and a renamed guest is a different list.
 */

/** `1992-12-12-area-51-john-lear-bob-lazar`: the air date, then words. */
export const SHOW_SLUG_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `linda-moulton-howe`. */
export const GUEST_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** How many characters of words a show slug carries after its date. */
export const SLUG_WORDS_MAX = 72;

/** Words that only join others: "Lear and Lazar" reads the same without them. */
const JOINERS = new Set(["and"]);

/**
 * Lowercase ASCII words joined by hyphens. Accents are folded ("José" to
 * "jose"), an apostrophe joins its word ("Art's" to "arts"), everything else
 * that is not a letter or digit separates words.
 */
export function slugWords(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !JOINERS.has(w));
}

/** Words cut at a word boundary to at most `max` characters, hyphen-joined. */
export function slugify(text: string, max = SLUG_WORDS_MAX): string {
  let out = "";
  for (const w of slugWords(text)) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > max) {
      if (!out) out = w.slice(0, max);
      break;
    }
    out = next;
  }
  // A cut can strand a word that leads into the next: "...-howe-on".
  return out.replace(/(?:-(?:on|of|the|with|to|a|an|for|in|at|from|by))+$/, "");
}

/** A guest's page slug: the name without an honorific. */
export function guestSlug(name: string): string {
  return slugify(stripHonorific(name), 80);
}

const HONORIFIC = /^(?:dr|prof|rev|professor|doctor|sir|col|maj|lt|capt|sgt|gen)\.?\s+/i;

/** "Dr. Roger Leir" and "Roger Leir" are one guest. */
export function stripHonorific(name: string): string {
  return name.trim().replace(HONORIFIC, "").trim();
}
