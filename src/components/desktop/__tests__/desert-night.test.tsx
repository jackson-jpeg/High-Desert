import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DesertNight, DESERT_STARS } from "../DesertNight";

/**
 * The desert night behind Win98's windows (docs/UI-PLAN.md, push 1). Server
 * markup in the root layout, so it is on the first byte of every page; the
 * stylesheet shows it in Win98 only, under every window, and moves nothing
 * for a visitor who asked for reduced motion.
 */

const styles = (f: string) => readFileSync(path.resolve(import.meta.dirname, "../../../styles", f), "utf8");
const desert = styles("desert.css");
const seasons = styles("seasons.css");
const globals = readFileSync(path.resolve(import.meta.dirname, "../../../app/globals.css"), "utf8");
const layout = readFileSync(path.resolve(import.meta.dirname, "../../../app/[look]/layout.tsx"), "utf8");

/** The declarations of the first rule whose selector list is exactly `selector`. */
function block(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
}

describe("the desert night", () => {
  const html = renderToStaticMarkup(<DesertNight />);

  it("draws the sky, the moon, both ridges and the tower's light, hidden from screen readers", () => {
    for (const part of ["moon", "far", "near", "tower", "light"]) {
      expect(html, part).toContain(`data-desert-part="${part}"`);
    }
    expect(html).toContain('aria-hidden="true"');
    expect((html.match(/<circle/g) ?? []).length).toBeGreaterThanOrEqual(DESERT_STARS.length);
  });

  it("puts the stars in the same places on every load, so server and client agree", async () => {
    // A second, fresh load of the module stands in for the browser's.
    vi.resetModules();
    const again = await import("../DesertNight");
    expect(again.DESERT_STARS).toEqual(DESERT_STARS);
    expect(renderToStaticMarkup(<again.DesertNight />)).toBe(html);
    // Spread over the sky, above the ridges (which start at y 676).
    expect(DESERT_STARS.every((s) => s.y < 676 && s.x >= 0 && s.x <= 1440)).toBe(true);
    expect(new Set(DESERT_STARS.map((s) => s.x)).size).toBeGreaterThan(80);
  });

  it("is in the root layout, so every page has it", () => {
    expect(layout).toMatch(/<DesertNight \/>/);
  });

  it("shows only in Win98, fixed under every window, never a tap", () => {
    expect(block(desert, ".hd-desert")).toMatch(/display:\s*none/);
    const shown = block(desert, 'html[data-look="win98"] .hd-desert');
    expect(shown).toMatch(/display:\s*block/);
    expect(shown).toMatch(/position:\s*fixed/);
    expect(shown).toMatch(/z-index:\s*-1/);
    expect(shown).toMatch(/pointer-events:\s*none/);
  });

  it("shows through the surfaces that painted the bare desktop", () => {
    const at = desert.indexOf('html[data-look="win98"] body,');
    const rule = desert.slice(at, desert.indexOf("}", at));
    for (const s of ["body", ".hd-look-page", ".hd-show-page", '[data-w98-route="/live"] #hd-main', '[data-w98-route="/stats"] #hd-main']) {
      expect(rule, s).toContain(s);
    }
    expect(rule).toMatch(/background:\s*transparent/);
    // The html element keeps the desktop colour under it, for the first paint.
    expect(block(desert, 'html[data-look="win98"]')).toMatch(/background:\s*var\(--hd-w98-teal\)/);
  });

  it("moves nothing with reduced motion, and nothing faster than once a second", () => {
    const motion = desert.slice(desert.indexOf("@media (prefers-reduced-motion: no-preference)"));
    const before = desert.slice(0, desert.indexOf("@media (prefers-reduced-motion: no-preference)"));
    expect(before).not.toMatch(/animation:/);
    const periods = [...motion.matchAll(/animation:\s*[\w-]+\s+([\d.]+)s/g)].map((m) => Number(m[1]));
    expect(periods.length).toBeGreaterThanOrEqual(4);
    expect(Math.min(...periods)).toBeGreaterThanOrEqual(1);
  });

  it("paints only with --hd-desert-* tokens that globals.css defines", () => {
    const used = new Set([...desert.matchAll(/var\((--hd-[\w-]+)\)/g)].map((m) => m[1]));
    for (const t of used) expect(globals, t).toMatch(new RegExp(`${t}:\\s*#`));
  });

  it("the season's leaves and snow fall behind the windows in Win98, never over the text", () => {
    expect(block(seasons, 'html[data-look="win98"] .hd-season-sky')).toMatch(/z-index:\s*-1/);
  });
});
