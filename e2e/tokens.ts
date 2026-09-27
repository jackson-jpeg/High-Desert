/**
 * Random tokens for the Live specs' calls and names, which find their own
 * lines by text.
 *
 * They used to be random base-36 letters, and the chat filter masks what it
 * reads as profanity: "tefcko" went out as "te***o" and the spec could not find
 * its own call (CI, 2026-09-27). A token is now three words from this list,
 * and scripts/__tests__/e2e-tokens.test.ts runs every one of the 13,824 through
 * the real moderator, as a call and as a name. No digits: the filter reads
 * them as letters (0 as o, 5 as s).
 *
 * Each word is at most 5 letters, so "Night Clerk in " plus a token stays
 * within the 32-character name limit.
 */
export const TOKEN_WORDS = [
  "mesa", "sage", "dune", "yucca", "owl", "hawk", "quail", "butte",
  "ridge", "basin", "comet", "radio", "tower", "orbit", "cedar", "pine",
  "moon", "star", "wind", "rain", "dial", "tone", "echo", "lamp",
] as const;

const pick = () => TOKEN_WORDS[Math.floor(Math.random() * TOKEN_WORDS.length)];

export function rnd(): string {
  return `${pick()}${pick()}${pick()}`;
}
