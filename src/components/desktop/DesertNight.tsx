/**
 * The desert night behind the windows (docs/UI-PLAN.md, push 1): Win98's
 * desktop as a night over the Mojave instead of a flat colour. A deep sky
 * with a horizon glow, a still field of stars (a few breathe slowly), a low
 * moon, the far and near ridgelines of the Spring Mountains, and a radio
 * tower on the near ridge whose red light blinks once every 2.4 s.
 *
 * Server markup, no script: it is drawn on the first byte of every page in
 * the root layout (app pages and the server-rendered show pages alike) and
 * costs no request. Colours live in src/styles/desert.css as `--hd-desert-*`
 * tokens. It sits at z-index -1: under every window, over the html
 * element's flat desktop colour, which stays as the fallback. Never a tap,
 * never read by a screen reader, nothing moves with reduced motion.
 *
 * Only Win98 shows it (desert.css); Night keeps its starfield.
 */

/** A seeded generator, so the stars stand in the same places on every render (server and client agree). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface Star {
  x: number;
  y: number;
  r: number;
  /** 0 still, 1 to 3: one of three slow breathing rhythms. */
  breathe: 0 | 1 | 2 | 3;
}

/** The sky's stars: 110 in the upper 70% of a 1440 x 900 field, one in five breathing. */
export const DESERT_STARS: readonly Star[] = (() => {
  const r = lcg(1992);
  return Array.from({ length: 110 }, (_, i) => {
    const big = r() > 0.9;
    return {
      x: Math.round(r() * 1440),
      y: Math.round(Math.pow(r(), 1.4) * 630),
      r: big ? 1.6 : 0.6 + Math.round(r() * 6) / 10,
      breathe: (i % 5 === 0 ? ((i / 5) % 3) + 1 : 0) as Star["breathe"],
    };
  });
})();

/** The far ridge: long, low, blue with distance. */
export const FAR_RIDGE =
  "M0 742 L70 728 L140 735 L230 706 L300 716 L380 690 L440 700 L520 676 L600 694 L660 684 L760 703 L840 688 L930 708 L1010 694 L1090 712 L1180 690 L1260 704 L1340 692 L1440 706 L1440 900 L0 900 Z";

/** The near ridge, black, with the tower's peak at x 1048. */
export const NEAR_RIDGE =
  "M0 800 L90 786 L170 794 L250 770 L330 782 L410 764 L470 772 L560 752 L640 766 L720 758 L800 774 L880 752 L960 738 L1048 716 L1120 736 L1200 758 L1290 750 L1370 768 L1440 760 L1440 900 L0 900 Z";

export function DesertNight() {
  return (
    <svg
      className="hd-desert"
      data-desert-night=""
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMax slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="hd-desert-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="hd-desert-stop-zenith" />
          <stop offset="0.55" className="hd-desert-stop-sky" />
          <stop offset="0.82" className="hd-desert-stop-horizon" />
        </linearGradient>
        <radialGradient id="hd-desert-glow" cx="0.5" cy="1" r="0.5">
          <stop offset="0" className="hd-desert-stop-glow" />
          <stop offset="1" className="hd-desert-stop-glow-out" />
        </radialGradient>
        <mask id="hd-desert-crescent">
          <circle cx="1180" cy="170" r="24" fill="white" />
          <circle cx="1192" cy="163" r="21" fill="black" />
        </mask>
        <radialGradient id="hd-desert-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.35" className="hd-desert-stop-halo" />
          <stop offset="1" className="hd-desert-stop-halo-out" />
        </radialGradient>
      </defs>
      <rect width="1440" height="900" fill="url(#hd-desert-sky)" />
      <ellipse cx="420" cy="760" rx="520" ry="150" fill="url(#hd-desert-glow)" className="hd-desert-glow" />
      <g className="hd-desert-stars">
        {DESERT_STARS.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} className={s.breathe ? `hd-desert-breathe-${s.breathe}` : undefined} />
        ))}
      </g>
      <g className="hd-desert-moon" data-desert-part="moon">
        <circle cx="1180" cy="170" r="70" fill="url(#hd-desert-halo)" />
        <circle cx="1180" cy="170" r="24" className="hd-desert-moon-disc" mask="url(#hd-desert-crescent)" />
      </g>
      <path d={FAR_RIDGE} className="hd-desert-far" data-desert-part="far" />
      <path d={NEAR_RIDGE} className="hd-desert-near" data-desert-part="near" />
      <g className="hd-desert-tower" data-desert-part="tower">
        <path d="M1048 716 L1048 646 M1042 716 L1048 652 L1054 716 M1043 700 L1053 700 M1044 684 L1052 684 M1045 668 L1051 668" />
        <circle cx="1048" cy="643" r="3" className="hd-desert-light" data-desert-part="light" />
      </g>
    </svg>
  );
}
