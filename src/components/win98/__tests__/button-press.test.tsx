import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../Button";

/**
 * Pressed, a Win98 button moves its label one pixel down and right by moving
 * padding from one side to the other — never by adding any. The pressed
 * padding used to be the medium size's for every size, so "Change name" (a
 * small button) grew 16×4 px on mousedown and could wrap away from the pointer
 * before the click landed. Held here as the invariant, per size, from the
 * classes the component actually renders: pressed top+bottom and left+right
 * equal the resting ones on desktop (`md:`), where the press is drawn.
 */

// Tailwind's spacing scale, in px, for the steps these buttons use.
const STEP: Record<string, number> = { "0.5": 2, "1": 4, "1.5": 6, "2": 8, "2.5": 10, "3": 12, "4": 16, "6": 24 };

function classesOf(size: "sm" | "md" | "lg"): string[] {
  const html = renderToStaticMarkup(<Button size={size}>x</Button>);
  return /class="([^"]*)"/.exec(html)![1].split(/\s+/);
}

/** The resting desktop padding: an `md:` override if present, else the base class. */
function resting(cls: string[], axis: "x" | "y"): number {
  const pick = (prefix: string) =>
    cls.find((c) => c.startsWith(prefix))?.slice(prefix.length);
  const v = pick(`md:p${axis}-`) ?? pick(`p${axis}-`);
  expect(v, `p${axis} for this size`).toBeDefined();
  return STEP[v!];
}

function pressed(cls: string[], side: "t" | "b" | "l" | "r"): number {
  const c = cls.find((x) => x.startsWith(`md:active:p${side}-[`));
  expect(c, `md:active:p${side}`).toBeDefined();
  return Number(/\[(\d+)px\]/.exec(c!)![1]);
}

describe("Win98 Button: pressing never resizes it", () => {
  for (const size of ["sm", "md", "lg"] as const) {
    it(`${size}: pressed padding sums to the resting padding, shifted down and right`, () => {
      const cls = classesOf(size);
      const x = resting(cls, "x");
      const y = resting(cls, "y");
      expect(pressed(cls, "l") + pressed(cls, "r")).toBe(2 * x);
      expect(pressed(cls, "t") + pressed(cls, "b")).toBe(2 * y);
      expect(pressed(cls, "l")).toBe(x + 1);
      expect(pressed(cls, "t")).toBe(y + 1);
    });
  }
});
