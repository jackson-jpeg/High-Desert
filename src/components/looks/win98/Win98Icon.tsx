import type { StartIcon } from "./start-menu";

/**
 * Small pixel icons for the Win98 look: drawn on a 16-unit grid with crisp
 * edges, coloured from the palette tokens (no raw hex, HD-036). Decorative:
 * every one is aria-hidden, the label beside it is the name.
 */
type IconName = StartIcon | "start" | "speaker" | "notepad" | "winamp" | "hole";

const INK = "var(--hd-ink)";
const WHITE = "var(--hd-chrome-lighter)";
const FACE = "var(--hd-w98-face)";
const GRAY = "var(--hd-chrome-dark)";
const NAVY = "var(--hd-navy)";
const TEAL = "var(--hd-w98-teal)";
const MAROON = "var(--hd-w98-maroon)";
const YELLOW = "var(--hd-w98-tooltip)";
const GREEN = "var(--hd-w98-green-text)";
const LCD = "var(--hd-w98-amp-lcd)";
const EARTH = "var(--hd-w98-earth)";
const BLUE = "var(--hd-w98-title-end)";

function shapes(name: IconName) {
  switch (name) {
    case "start":
      // The four-pane flag, in the palette's own colours.
      return (
        <>
          <path d="M2 3h5v5H2z" fill={MAROON} />
          <path d="M8 3h5v5H8z" fill={GREEN} />
          <path d="M2 9h5v5H2z" fill={NAVY} />
          <path d="M8 9h5v5H8z" fill={BLUE} />
        </>
      );
    case "library":
      return (
        <>
          <path d="M1 4h5l1 1h8v9H1z" fill={YELLOW} stroke={INK} />
          <path d="M1 6h14" stroke={INK} />
        </>
      );
    case "live":
      return (
        <>
          <path d="M8 6v9" stroke={INK} strokeWidth="2" />
          <path d="M5 15h6" stroke={INK} />
          <circle cx="8" cy="5" r="2" fill={MAROON} />
          <path d="M3 2a7 7 0 0 0 0 7M13 2a7 7 0 0 1 0 7" stroke={NAVY} fill="none" />
        </>
      );
    case "phone":
    case "notepad":
      return (
        <>
          <path d="M3 1h9l2 2v12H3z" fill={WHITE} stroke={INK} />
          <path d="M5 5h7M5 7h7M5 9h7M5 11h5" stroke={NAVY} />
        </>
      );
    case "dial":
      return (
        <>
          <rect x="1" y="4" width="14" height="10" fill={FACE} stroke={INK} />
          <rect x="3" y="6" width="7" height="3" fill={YELLOW} stroke={INK} />
          <path d="M6 6v3" stroke={MAROON} />
          <circle cx="12.5" cy="10" r="1.5" fill={INK} />
        </>
      );
    case "stats":
      return (
        <>
          <path d="M1 15h14" stroke={INK} />
          <path d="M2 9h3v6H2z" fill={NAVY} />
          <path d="M6 5h3v10H6z" fill={MAROON} />
          <path d="M10 11h3v4h-3z" fill={GREEN} />
        </>
      );
    case "scanner":
    case "search":
      return (
        <>
          <circle cx="6" cy="6" r="4" fill={WHITE} stroke={INK} />
          <path d="M9 9l5 5" stroke={INK} strokeWidth="2" />
        </>
      );
    case "settings":
      return (
        <>
          <rect x="2" y="2" width="12" height="12" fill={FACE} stroke={INK} />
          <path d="M4 5h8M4 8h8M4 11h8" stroke={GRAY} />
          <path d="M6 4v2M10 7v2M7 10v2" stroke={INK} strokeWidth="2" />
        </>
      );
    case "about":
      return (
        <>
          <rect x="1" y="2" width="14" height="10" fill={TEAL} stroke={INK} />
          <path d="M5 14h6" stroke={INK} strokeWidth="2" />
          <path d="M7 5h2v5H7z" fill={WHITE} />
        </>
      );
    case "shortcuts":
      return (
        <>
          <rect x="1" y="4" width="14" height="9" fill={FACE} stroke={INK} />
          <path d="M3 6h2M6 6h2M9 6h2M12 6h1M3 8h2M6 8h2M9 8h2M4 10h8" stroke={INK} />
        </>
      );
    case "help":
      return (
        <>
          <path d="M2 2h9l3 3v9H2z" fill={YELLOW} stroke={INK} />
          <path d="M6 6a2 2 0 1 1 3 2v2" stroke={NAVY} fill="none" strokeWidth="1.5" />
          <path d="M8.5 12h1" stroke={NAVY} strokeWidth="1.5" />
        </>
      );
    case "run":
      return (
        <>
          <rect x="1" y="3" width="14" height="10" fill={WHITE} stroke={INK} />
          <path d="M1 3h14v2H1z" fill={NAVY} />
          <path d="M4 8l2 2-2 2" stroke={INK} fill="none" />
        </>
      );
    case "shutdown":
      return (
        <>
          <rect x="2" y="2" width="12" height="9" fill={TEAL} stroke={INK} />
          <path d="M5 14h6M8 11v3" stroke={INK} />
          <circle cx="8" cy="6.5" r="2.5" fill="none" stroke={WHITE} />
          <path d="M8 3v3" stroke={WHITE} />
        </>
      );
    case "speaker":
      return (
        <>
          <path d="M2 6h3l4-3v10l-4-3H2z" fill={FACE} stroke={INK} />
          <path d="M11 5a4 4 0 0 1 0 6" stroke={INK} fill="none" />
        </>
      );
    case "winamp":
      return (
        <>
          <rect x="1" y="3" width="14" height="10" fill={INK} />
          <path d="M3 10l2-3 2 2 2-4 2 3 2-1" stroke={LCD} fill="none" />
        </>
      );
    case "hole":
      return (
        <>
          <ellipse cx="8" cy="10" rx="7" ry="4" fill={EARTH} />
          <ellipse cx="8" cy="10" rx="4" ry="2" fill={INK} />
          <path d="M8 1v9" stroke={WHITE} />
        </>
      );
  }
}

export function Win98Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
      className={className}
      data-icon={name}
    >
      {shapes(name)}
    </svg>
  );
}
