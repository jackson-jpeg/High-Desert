import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { HalloweenScene } from "../HalloweenScene";
import { PIXEL_FILL, moonSprite, pumpkinSprite, spriteRuns, trayPumpkinSprite } from "@/lib/season/pixel-art";

/**
 * Halloween's still scene (docs/seasons.md): the real component, under
 * `<html data-season>`, and the sprites it draws. "Still" is held three
 * ways: no animation frame is ever asked for, no CSS animation or
 * transition is set on it, and seasons.css gives it none.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const render = (season: string | null) => {
  if (season) document.documentElement.setAttribute("data-season", season);
  else document.documentElement.removeAttribute("data-season");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<HalloweenScene />));
  return host;
};
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.documentElement.removeAttribute("data-season");
  vi.restoreAllMocks();
});

const css = readFileSync(path.resolve(import.meta.dirname, "../../../styles/seasons.css"), "utf8");

describe("the Halloween scene", () => {
  it("draws the moon and the jack-o'-lantern, hidden from screen readers and from taps", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const c = render("halloween");
    const scene = c.querySelector(".hd-halloween")!;
    expect(scene.getAttribute("aria-hidden")).toBe("true");
    const parts = [...scene.querySelectorAll("[data-halloween-part]")].map((e) => e.getAttribute("data-halloween-part"));
    expect(parts).toEqual(["moon", "pumpkin"]);
    for (const svg of scene.querySelectorAll("svg")) {
      expect(svg.getAttribute("shape-rendering")).toBe("crispEdges");
      expect(svg.querySelectorAll("rect").length).toBeGreaterThan(30);
      expect(svg.querySelector("animate, animateTransform, set")).toBeNull();
    }
    expect(raf).not.toHaveBeenCalled();
    expect(/\.hd-halloween\s*\{[^}]*pointer-events:\s*none/.test(css)).toBe(true);
  });

  it("nothing in its rules animates", () => {
    const rules = css.slice(css.indexOf("---------------- Halloween"), css.indexOf("---------------- Thanksgiving"));
    expect(rules).toContain(".hd-halloween");
    expect(rules).not.toMatch(/animation|transition|@keyframes/);
  });

  it("Night shows no scene (its glass would put the moon behind buttons); Win98 does", () => {
    expect(/html\[data-look="night"\] \.hd-halloween\s*\{\s*display:\s*none/.test(css)).toBe(true);
    expect(/html\[data-look="win98"\] \.hd-halloween\s*\{[^}]*display:\s*none/.test(css)).toBe(false);
  });

  it("control: Thanksgiving, winter and no season draw no scene", () => {
    for (const s of ["thanksgiving", "winter", null]) {
      const c = render(s);
      expect(c.querySelector(".hd-halloween"), String(s)).toBeNull();
      act(() => root!.unmount());
      root = null;
    }
  });
});

describe("the sprites", () => {
  const sprites = { moon: moonSprite(), pumpkin: pumpkinSprite(), tray: trayPumpkinSprite() };

  it("are rectangular grids of known pixels", () => {
    for (const [name, sp] of Object.entries(sprites)) {
      const w = sp[0].length;
      for (const row of sp) {
        expect(row.length, name).toBe(w);
        expect(row, name).toMatch(/^[.MSBORYG]+$/);
      }
    }
    expect(sprites.tray).toHaveLength(16);
    expect(sprites.tray[0]).toHaveLength(16);
  });

  it("hold what they claim: a shaded moon with bats on it; a lit, stemmed, ribbed pumpkin", () => {
    const has = (sp: readonly string[], c: string) => sp.join("").includes(c);
    for (const c of ["M", "S", "B"]) expect(has(sprites.moon, c), c).toBe(true);
    for (const c of ["O", "R", "Y", "G"]) expect(has(sprites.pumpkin, c), c).toBe(true);
    // The dither: moon and shade alternating along a row somewhere.
    expect(sprites.moon.some((r) => r.includes("SMSMS"))).toBe(true);
  });

  it("spriteRuns draws every pixel exactly once", () => {
    for (const sp of Object.values(sprites)) {
      const back = sp.map((r) => [...".".repeat(r.length)]);
      for (const [x, y, w, c] of spriteRuns(sp)) for (let i = 0; i < w; i++) back[y][x + i] = c;
      expect(back.map((r) => r.join(""))).toEqual([...sp]);
    }
  });

  it("every colour is a palette token defined in globals.css", () => {
    const globals = readFileSync(path.resolve(import.meta.dirname, "../../../app/globals.css"), "utf8");
    for (const fill of Object.values(PIXEL_FILL)) {
      const name = /^var\((--hd-[a-z-]+)\)$/.exec(fill)?.[1];
      expect(name, fill).toBeTruthy();
      expect(globals).toMatch(new RegExp(`${name}:\\s*#[0-9A-Fa-f]{6};`));
    }
  });
});
