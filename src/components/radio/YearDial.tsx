/**
 * A radio set's dial face with years for frequencies (docs/UI-PLAN.md, push
 * 2): the archive's years, 1992 to 2015, as the scale of a lit AM dial, and a
 * red needle standing at the show's air date (month included), with each
 * era's colour along the scale (src/lib/era/era.ts, push 3). The Live hero
 * draws it under the show on the air.
 *
 * Pure SVG, no state: it renders the same on the server and in the browser.
 * Colours are classes (src/styles/radio-set.css); text is decoration, since
 * the year is written out beside the show already, so the whole face is
 * aria-hidden and the caller says the year in words.
 */

import { ERAS } from "@/lib/era/era";

export const DIAL_FIRST_YEAR = 1992;
export const DIAL_LAST_YEAR = 2015;

const W = 320;
const PAD = 14;

/** Where on the face (0 to 1) an air date sits: its year and month. Null for no usable date. */
export function dialPosition(airDate: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(airDate ?? "");
  if (!m) return null;
  const at = Number(m[1]) + (Number(m[2]) - 1) / 12;
  const span = DIAL_LAST_YEAR + 1 - DIAL_FIRST_YEAR;
  return Math.min(1, Math.max(0, (at - DIAL_FIRST_YEAR) / span));
}

function x(fraction: number): number {
  return PAD + fraction * (W - PAD * 2);
}

const LABELS = [1992, 1995, 2000, 2005, 2010, 2015];

export function YearDial({ airDate, className }: { airDate: string | null | undefined; className?: string }) {
  const at = dialPosition(airDate);
  const span = DIAL_LAST_YEAR + 1 - DIAL_FIRST_YEAR;
  const years = Array.from({ length: span + 1 }, (_, i) => DIAL_FIRST_YEAR + i);
  return (
    <svg
      className={["hd-year-dial", className].filter(Boolean).join(" ")}
      data-year-dial=""
      data-needle={at === null ? undefined : at.toFixed(3)}
      viewBox={`0 0 ${W} 40`}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="hd-year-dial-glass" x="0" y="0" width={W} height="40" rx="4" />
      {years.map((y, i) => {
        const tx = x(i / span);
        const major = LABELS.includes(y);
        return <line key={y} className={major ? "hd-year-dial-tick-major" : "hd-year-dial-tick"} x1={tx} x2={tx} y1={major ? 20 : 24} y2="32" />;
      })}
      {LABELS.map((y) => (
        <text key={y} className="hd-year-dial-label" x={x((y - DIAL_FIRST_YEAR) / span)} y="14" textAnchor="middle">
          {`'${String(y).slice(2)}`}
        </text>
      ))}
      {ERAS.map((e) => (
        <rect
          key={e.key}
          className="hd-year-dial-era"
          data-era={e.key}
          x={x((e.from - DIAL_FIRST_YEAR) / span)}
          width={x((e.to + 1 - DIAL_FIRST_YEAR) / span) - x((e.from - DIAL_FIRST_YEAR) / span)}
          y="33"
          height="3"
        />
      ))}
      <line className="hd-year-dial-rule" x1={PAD} x2={W - PAD} y1="32" y2="32" />
      {at !== null && (
        <g className="hd-year-dial-needle" data-dial-part="needle">
          <line x1={x(at)} x2={x(at)} y1="3" y2="37" />
        </g>
      )}
    </svg>
  );
}
