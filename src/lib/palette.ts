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
  // The "Win98" preview look (src/styles/look-win98.css).
  w98Face: "#C0C0C0",
  w98Teal: "#008080",
  w98TitleEnd: "#1084D0",
  w98InkMuted: "#3A3A3A",
  w98Maroon: "#800000",
  w98Brown: "#6B3A00",
  w98GreenText: "#004000",
  w98Error: "#A00000",
  w98Tooltip: "#FFFFE1",
  w98AmpFrame: "#2B2B3B",
  w98AmpEdge: "#5A5A74",
  w98AmpShadow: "#15151F",
  w98AmpText: "#C8C8D8",
  w98AmpLcd: "#00E000",
  w98AmpLcdDim: "#0A3A0A",
  w98AmpGold: "#D8C080",
  w98Earth: "#4A2F18",
} as const;

export type PaletteKey = keyof typeof PALETTE;
