/**
 * The Halloween scene's pixel art (docs/seasons.md): a harvest moon with
 * dithered shading, bats against it, and a jack-o'-lantern. Drawn as text
 * grids, one character a pixel, so a test can read them and the 90s look
 * stays honest: whole pixels, a handful of colours, no gradients, nothing
 * that moves.
 *
 * Characters: "." nothing, "M" moon, "S" moon shade, "B" bat, "O" pumpkin,
 * "R" pumpkin rib, "Y" the candle's glow, "G" stem and leaf.
 */

export type Pixel = "." | "M" | "S" | "B" | "O" | "R" | "Y" | "G";
export type Sprite = readonly string[];

/** Palette tokens per pixel (src/app/globals.css). */
export const PIXEL_FILL: Record<Exclude<Pixel, ".">, string> = {
  M: "var(--hd-season-moon)",
  S: "var(--hd-season-moon-shade)",
  B: "var(--hd-season-bat)",
  O: "var(--hd-egg-halloween)",
  R: "var(--hd-season-pumpkin)",
  Y: "var(--hd-season-glow)",
  G: "var(--hd-season-stem)",
};

const BAT: Sprite = [
  "B...B.B...B",
  "BB..BBB..BB",
  "BBBBBBBBBBB",
  ".BBB.B.BBB.",
  "..B.....B..",
];

const SMALL_BAT: Sprite = [
  "B..B.B..B",
  "BBBBBBBBB",
  ".BB.B.BB.",
];

function blank(w: number, h: number): string[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => "."));
}

function stamp(grid: string[][], sprite: Sprite, x0: number, y0: number) {
  sprite.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c !== "." && grid[y0 + y]?.[x0 + x] !== undefined) grid[y0 + y][x0 + x] = c;
    }),
  );
}

/**
 * The moon, `size` pixels across: lit from the upper left, its lower right
 * shaded through a checkerboard dither (the 16-colour way to draw a curve),
 * a few craters, one bat crossing it and two off its edge.
 */
export function moonSprite(size = 28): Sprite {
  const w = size + 8;
  const g = blank(w, size + 2);
  const r = size / 2;
  const cx = r;
  const cy = r + 1;
  for (let y = 0; y < size + 2; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r * r) continue;
      // Shade: the far side of a light from the upper left.
      const lx = x + 0.5 - (cx - r * 0.45);
      const ly = y + 0.5 - (cy - r * 0.45);
      const d = Math.sqrt(lx * lx + ly * ly) / r;
      g[y][x] = d > 1.32 ? "S" : d > 1.1 ? ((x + y) % 2 === 0 ? "S" : "M") : "M";
    }
  }
  // Craters, as a share of the size so any size keeps them. Low and off
  // centre: two up high read as a pair of eyes, and the moon got a face.
  for (const [fx, fy, n] of [[0.2, 0.5, 2], [0.58, 0.6, 3], [0.36, 0.78, 2], [0.74, 0.46, 1]] as const) {
    const x0 = Math.round(fx * size);
    const y0 = Math.round(fy * size) + 1;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (g[y0 + y]?.[x0 + x] === "M") g[y0 + y][x0 + x] = "S";
  }
  // One bat across the top of the moon, two smaller ones off its edge.
  stamp(g, BAT, Math.round(size * 0.3), Math.round(size * 0.14));
  stamp(g, SMALL_BAT, size - 1, Math.round(size * 0.06));
  stamp(g, SMALL_BAT, size - 2, Math.round(size * 0.56));
  return g.map((row) => row.join(""));
}

/** The jack-o'-lantern: ribbed, a stem with a leaf, a lit face. */
export function pumpkinSprite(): Sprite {
  const w = 20;
  const h = 16;
  const g = blank(w, h);
  for (let y = 3; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - 10) / 10;
      const dy = (y + 0.5 - 9.6) / 6.5;
      // Ribs show above and below the face, never through it.
      const rib = (x === 5 || x === 14) && (y < 5 || y > 12);
      if (dx * dx + dy * dy <= 1) g[y][x] = rib ? "R" : "O";
    }
  }
  stamp(g, [
    "...GG",
    "...GG.GG",
    "...GGGG",
    "...GG",
  ], 6, 0);
  // The face: triangle eyes set wide, a nose, a grin with teeth.
  stamp(g, [
    "..Y........Y..",
    ".YYY......YYY.",
    "YYYYY....YYYYY",
    "......YY......",
    "",
    "YY.YYYYYYYY.YY",
    ".YYYY.YY.YYYY.",
    "...YYYYYYYY...",
  ], 3, 5);
  return g.map((row) => row.join(""));
}

/** The tray's 16 × 16 pumpkin, Win98 style. */
export function trayPumpkinSprite(): Sprite {
  return [
    "......GGG.......",
    ".......GG.......",
    "...OOOORROOOO...",
    "..OOOOORROOOOO..",
    ".OOOOOOROOOOOOO.",
    ".OOYYOOROOOYYOO.",
    "OOYYYYOROOYYYYOO",
    "OOOOOOOROOOOOOOO",
    "OOOOOOOYYOOOOOOO",
    "OOOOOOOROOOOOOOO",
    "OYYYYYYYYYYYYYYO",
    "OOYYOYYYYYYOYYOO",
    ".OOOYYYOOYYYOOO.",
    ".OOOOOOROOOOOOO.",
    "..OOOOOROOOOOO..",
    "....OOOOOOOO....",
  ];
}

/** A sprite's pixels as runs, one rect each: [x, y, width, pixel]. */
export function spriteRuns(sprite: Sprite): [number, number, number, Exclude<Pixel, ".">][] {
  const runs: [number, number, number, Exclude<Pixel, ".">][] = [];
  sprite.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x] as Pixel;
      let end = x + 1;
      while (end < row.length && row[end] === c) end++;
      if (c !== ".") runs.push([x, y, end - x, c]);
      x = end;
    }
  });
  return runs;
}
