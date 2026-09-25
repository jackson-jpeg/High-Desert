/**
 * The canonical palette as concrete strings, for the few places a CSS custom
 * property cannot reach (HD-036):
 *
 *   - canvas 2D contexts (`fillStyle` does not resolve `var()`),
 *   - the Open Graph image (rendered by `next/og`, which has no stylesheet),
 *   - `<meta name="theme-color">` (read by the browser chrome, not the page),
 *   - `app/global-error.tsx` and the boot splash, which must paint correctly
 *     when the stylesheet has not loaded or the root layout has failed.
 *
 * `src/app/globals.css` is still the one definition. Every key here is the
 * camelCase of an `--hd-*` property there, and
 * `src/lib/__tests__/no-raw-hex.test.ts` fails if any value differs — so this
 * file is a checked copy, not a second source. Everywhere else, use
 * `var(--hd-*)` or a Tailwind token; a raw hex anywhere else in `src/` fails
 * the same test.
 */
export const PALETTE = {
  void: "#060810",
  well: "#080C16",
  midnight: "#0A0E1A",
  raised: "#1A1F33",
  edge: "#2A3050",
  chrome: "#C0C0C0",
  chromeLighter: "#FFFFFF",
  navy: "#000080",
  select: "#0A246A",
  amber: "#D4A843",
  green: "#4ADE80",
  greenBright: "#33FF33",
  blue: "#6BA3F0",
  muted: "#9AA0AE",
  peak: "#FF3333",
  needle: "#FF2020",
  titlebarGlow: "#3A6EA5",
  titlebarSky: "#A6CAF0",
  strip: "#0F1520",
} as const;

export type PaletteKey = keyof typeof PALETTE;
