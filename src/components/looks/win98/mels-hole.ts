/**
 * Mel's Hole, the Win98 look's hidden program (MelsHole.tsx): the lore, the
 * line-out counter, and how to find the shows in the catalog.
 *
 * The story is told as the caller told it. In February 1997 a man who gave
 * his name as Mel Waters called Coast to Coast AM about a hole on his land
 * near Ellensburg, Washington, and said he had lowered about 80,000 feet of
 * weighted fishing line into it without reaching the bottom. The catalog
 * dates his first call to 1997-02-21. Nothing here says the hole is real.
 */

/** How much line the caller said he lowered. */
export const MEL_LINE_FEET = 80_000;
export const FEET_PER_MILE = 5_280;
/** How fast the reel pays out line on screen. */
export const FEET_PER_SECOND = 600;
/** One press of "Lower more line" (the only way down with reduced motion). */
export const FEET_PER_PRESS = 1_000;

export const MELS_HOLE_LORE = [
  "In February 1997 a caller who gave his name as Mel Waters told Art Bell about a hole on his land near Ellensburg, Washington.",
  "He claimed he lowered about 80,000 feet of weighted fishing line into it, roughly 15 miles, and never reached the bottom.",
  "He called back over the years with more of the story. No one has ever confirmed that the hole exists.",
];

/** Line out after `elapsedMs` of reeling, plus whatever was lowered by hand. */
export function lineOut(elapsedMs: number, pressedFeet = 0): number {
  return Math.max(0, Math.floor((elapsedMs / 1000) * FEET_PER_SECOND)) + pressedFeet;
}

/** "12,345 ft" */
export function formatFeet(feet: number): string {
  return `${Math.floor(feet).toLocaleString("en-US")} ft`;
}

/** "2.3 miles" */
export function formatMiles(feet: number): string {
  return `${(feet / FEET_PER_MILE).toFixed(1)} miles`;
}

/**
 * The status line under the counter. It never reports a bottom: past the
 * caller's 80,000 feet it says so and keeps going.
 */
export function depthStatus(feet: number): string {
  if (feet < MEL_LINE_FEET) return "Bottom: not reached";
  return "Past the caller's 80,000 feet. Bottom: still not reached";
}

/** Whether a catalog row is one of the Mel's Hole shows. */
export function isMelsHoleShow(ep: { title?: string; fileName?: string; aiTags?: string[] }): boolean {
  if (ep.aiTags?.some((t) => t.toLowerCase() === "mels hole")) return true;
  const text = `${ep.title ?? ""} ${ep.fileName ?? ""}`;
  return /mel'?s hole|mel waters/i.test(text);
}
