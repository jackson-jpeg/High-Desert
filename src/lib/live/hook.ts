import notable from "../../../data/notable.json";

/**
 * The one line that says why the show on the air is worth hearing (the Live
 * screen's hero, docs/live-qa.md "The phone's Live screen").
 *
 * Never invented: it is the catalog's own words, trimmed. A notable show's
 * sourced "why" (data/notable.json, every entry cited in data/notable.md)
 * comes first; otherwise the first sentence of the catalog summary
 * (`aiSummary`, written offline by scripts/categorize-library.py and shipped
 * in the seed). Nothing at all when the catalog has neither.
 */

/** The longest hook, in characters: one line of a phone, two at most. */
export const HOOK_MAX = 120;

const NOTABLE_WHY: ReadonlyMap<string, string> = new Map(
  (notable as { fileHash: string; why: string }[]).map((n) => [n.fileHash, n.why]),
);

/**
 * The first sentence of `text`, or its first `max` characters cut at a word
 * and marked with an ellipsis. Whitespace is collapsed; nothing is added but
 * the ellipsis.
 */
export function oneLine(text: string | null | undefined, max: number = HOOK_MAX): string | null {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const end = sentenceEnd(flat);
  const sentence = end >= 0 ? flat.slice(0, end + 1) : flat;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const head = (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–-]+$/, "");
  return `${head}…`;
}

/** Titles and ranks that end in a full stop without ending a sentence. */
const ABBREVIATIONS = new Set([
  "dr", "mr", "mrs", "ms", "st", "jr", "sr", "prof", "lt", "col", "gen", "maj", "capt", "sgt", "rev", "vs", "no", "mt", "ft",
  "sen", "rep", "gov", "pres",
]);

/**
 * Where the first sentence ends: a . ! or ? followed by a space and a capital,
 * unless the full stop closes a title ("Dr. Greer"), an initial ("J. Allen
 * Hynek") or a dotted abbreviation ("U.S. Army"). -1 for one sentence.
 */
function sentenceEnd(text: string): number {
  const re = /[.!?](?=\s+["'“]?[A-Z])/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] !== ".") return m.index;
    const word = /([A-Za-z.]+)$/.exec(text.slice(0, m.index))?.[1] ?? "";
    const bare = word.replace(/\./g, "");
    if (bare.length === 1 || word.includes(".") || ABBREVIATIONS.has(bare.toLowerCase())) continue;
    return m.index;
  }
  return -1;
}

/** The hook for a show: its notable "why", else its summary's first sentence, else null. */
export function showHook(show: { fileHash: string; aiSummary?: string | null } | null | undefined): string | null {
  if (!show) return null;
  return oneLine(NOTABLE_WHY.get(show.fileHash)) ?? oneLine(show.aiSummary);
}

/** "1992" from "1992-12-12"; null for anything that is not a dated air date. */
export function airYear(airDate: string | null | undefined): string | null {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(airDate ?? "");
  return m ? m[1] : null;
}
