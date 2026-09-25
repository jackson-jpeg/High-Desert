/**
 * What a message or a name *is*, before anything judges it.
 *
 *   - NFKC: fullwidth and other compatibility forms fold to their plain
 *     letters (`ｆｕｃｋ` is stored, displayed and matched as `fuck`), and the
 *     length limit counts what a reader sees.
 *   - Format characters (Unicode Cf: zero-width space/joiner/non-joiner, bidi
 *     overrides, soft hyphen, BOM) are removed. They are invisible, so the only
 *     thing they are ever for in a chat line is hiding a word from a filter or
 *     reversing text on screen.
 *   - Control characters become spaces; whitespace runs collapse to one space;
 *     the ends are trimmed. The phone lines are one line per call.
 *   - Stacked combining marks ("Zalgo") are cut to two per base character.
 */

const FORMAT = /\p{Cf}/gu;
const CONTROL = /\p{Cc}/gu;
const WHITESPACE = /[\s\p{Zs}\p{Zl}\p{Zp}]+/gu;
const ZALGO = /(\p{M}{2})\p{M}+/gu;

export function normalizeText(raw) {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(FORMAT, "")
    .replace(CONTROL, " ")
    .replace(ZALGO, "$1")
    .replace(WHITESPACE, " ")
    .trim();
}

/** Length as a reader counts it: code points, not UTF-16 units. */
export function codePointLength(s) {
  return [...s].length;
}

/**
 * The key two bodies are compared on for the duplicate and flood checks:
 * case, accents, punctuation and spacing do not make a message different.
 */
export function dedupKey(s) {
  return normalizeText(s)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
