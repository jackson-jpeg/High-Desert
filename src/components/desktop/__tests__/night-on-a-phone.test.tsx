import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cutChips } from "@/hooks/useScrollEdges";
import { DesertHorizon } from "@/components/desktop/DesertNight";

/**
 * Push 1b (Jackson's review of push 1 at 390, 2026-11-27): the night shows on
 * a phone, a cut chip is an edge peek and never a half word, and the ON THE
 * AIR strip's type and lamp are bigger.
 */

const src = path.resolve(import.meta.dirname, "../../..");
const read = (p: string) => readFileSync(path.join(src, p), "utf8");
const desert = read("styles/desert.css");
const phone = desert.slice(desert.indexOf("@media (max-width: 767.98px)"));

const chip = (left: number, width: number) => ({ getBoundingClientRect: () => ({ left, right: left + width, width }) }) as unknown as Element;

describe("a cut chip is an edge peek", () => {
  it("measures how much of the chip on each edge shows", () => {
    // Row from 0 to 390: a chip from 300 to 470 shows 90 px at the right.
    expect(cutChips([chip(10, 80), chip(100, 190), chip(300, 170)], 0, 390)).toEqual({ left: 0, right: 90 });
    // Scrolled: a chip from -40 to 60 shows 60 px at the left.
    expect(cutChips([chip(-40, 100), chip(70, 100)], 0, 390)).toEqual({ left: 60, right: 0 });
    // A gap on the edge: nothing cut.
    expect(cutChips([chip(10, 100), chip(395, 100)], 0, 390)).toEqual({ left: 0, right: 0 });
  });

  it("the stylesheet hides all of a cut chip but its outer peek", () => {
    const css = read("styles/scroll-edges.css");
    expect(css).toMatch(/--peek:\s*18px/);
    expect(css).toContain("transparent calc(100% - var(--hide-r))");
    expect(css).toContain("--hide-l: max(0px, calc(var(--cut-l) - var(--peek)));");
    const hook = read("hooks/useScrollEdges.ts");
    expect(hook).toMatch(/el\.style\.setProperty\("--cut-r", `\$\{Math\.round\(right\)\}px`\)/);
  });
});

describe("the night on a phone", () => {
  it("moves the sky so the tower and its light stand above the strip", () => {
    expect(phone).toMatch(/html\[data-look="win98"\] \.hd-desert \{[^}]*left: calc\(72vw - 100vh \* 1048 \/ 900\);/);
    expect(phone).toMatch(/top: calc\(20\.4vh - 118px - var\(--safe-bottom, 0px\)\);/);
  });

  it("insets the window and ends it a band of sky above the player", () => {
    expect(phone).toMatch(/#hd-main \{[^}]*background: transparent;[^}]*padding-bottom: calc\(var\(--main-pad-bottom, 0px\) \+ var\(--phone-sky-band\)\) !important;/);
    expect(phone).toMatch(/--phone-sky-band: 64px;/);
    expect(phone).toMatch(/#hd-main::before \{[^}]*left: 8px;[^}]*right: 8px;[^}]*background: var\(--hd-w98-face\);/);
    expect(read("components/desktop/DesktopShell.tsx")).toContain('"--main-pad-bottom": `calc(${bottomPadding}px + var(--safe-bottom))`');
  });

  it("lets the ridge run behind the strip: its frame is clear on a phone", () => {
    expect(phone).toMatch(/\.hd-w98-idle \{\s*background: transparent;/);
  });

  it("Night's Live card carries the horizon, with the tower's light", () => {
    const html = renderToStaticMarkup(createElement(DesertHorizon));
    for (const part of ["far", "near", "tower", "light"]) expect(html).toContain(`data-desert-part="${part}"`);
    expect(read("components/live/LiveStation.tsx")).toContain('{look === "night" ? <DesertHorizon /> : null}');
    expect(desert).toMatch(/html\[data-look="night"\] \.hd-has-horizon > \.hd-desert-horizon \{[^}]*display: block;/);
  });
});

describe("the ON THE AIR strip, pushed further", () => {
  it("sets the line big on a phone, caption-sized on a desktop", () => {
    expect(read("components/player/PlayerEmptyState.tsx")).toContain('const size = "hd-ticker-big text-hd-title md:text-hd-caption";');
  });

  it("draws the lamp at 12 px with a wide halo, and a deep breath", () => {
    const css = read("styles/ticker.css");
    expect(css).toMatch(/\.hd-ticker-lamp \{\s*width: 12px;\s*height: 12px;/);
    expect(css).toMatch(/50% \{ opacity: 0\.2; transform: scale\(0\.85\); \}/);
    expect(css).toMatch(/hd-ticker-breathe 2\.5s/);
  });
});
