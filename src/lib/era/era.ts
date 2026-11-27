/**
 * Era colours (docs/UI-PLAN.md, push 3): every year of the archive belongs to
 * an era, and every era has a colour, so scrolling the Library or the shelf
 * of years is a walk through the decades. Eras are spans of years, named by
 * their years only: no claim about what happened in them.
 *
 * Each era has two tokens in globals.css: `--hd-era-<key>` (bright, for the
 * dark surfaces: 5.5:1 or better on raised-surface) and `--hd-era-<key>-deep`
 * (for white fields only: 6.5:1 or better on white; under 4.5:1 on Win98's
 * gray face, so never text there). era.test.ts measures both.
 * src/styles/era.css maps `data-era="<key>"` to `--era` and `--era-deep`.
 */

export const ERAS = [
  { key: "early", from: 1992, to: 1996 },
  { key: "peak", from: 1997, to: 1999 },
  { key: "turn", from: 2000, to: 2003 },
  { key: "return", from: 2004, to: 2007 },
  { key: "late", from: 2008, to: 2010 },
  { key: "dark", from: 2011, to: 2013 },
  { key: "desert", from: 2014, to: 2015 },
] as const;

export type EraKey = (typeof ERAS)[number]["key"];

/** The era a year belongs to, or null outside the archive. */
export function eraOfYear(year: number): EraKey | null {
  return ERAS.find((e) => year >= e.from && year <= e.to)?.key ?? null;
}

/** The era of an air date ("1997-03-13"), or null without one. */
export function eraOf(airDate: string | null | undefined): EraKey | null {
  const m = /^(\d{4})-/.exec(airDate ?? "");
  return m ? eraOfYear(Number(m[1])) : null;
}
