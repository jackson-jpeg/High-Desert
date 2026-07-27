/**
 * Fisher-Yates shuffle, returning a new array.
 *
 * Replaces `[...xs].sort(() => Math.random() - 0.5)`, which was used in four
 * places. That idiom is not a uniform shuffle: a comparator that returns
 * inconsistent orderings violates the contract sort expects, so the result is
 * biased toward the input order and the bias varies by engine and array length.
 * For "Surprise Me" over a 1,313-episode catalog that meant the same handful of
 * episodes surfaced far more often than chance.
 */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
