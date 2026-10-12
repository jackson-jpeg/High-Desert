import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { PALETTE } from "@/lib/palette";

/**
 * The desktop signal meter in Win98 was faint: green LEDs on the gray face,
 * 1.4:1. Win98 now draws it as a progress bar, navy blocks in a sunken white
 * field (src/styles/look-win98.css, "The signal meter"). This holds both ends:
 * the component reads its colours from the meter's custom properties, and the
 * look's CSS sets them to colours that meet WCAG (3:1 for the blocks against
 * their field, 1.4.11; 4.5:1 for the label, 1.4.3), resolved through the
 * real stylesheets rather than restated here.
 */

vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));
const { SignalMeter } = await import("../SignalMeter");

function render(el: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(el));
  return { container };
}

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const full = n.length === 3 ? [...n].map((c) => c + c).join("") : n;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const globals = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** `var(--hd-w98-face)` -> its hex in globals.css, the one definition. */
function resolve(value: string): string {
  const m = /^var\(--hd-([a-z0-9-]+)\)$/.exec(value.trim());
  if (!m) throw new Error(`not a palette token: ${value}`);
  const def = new RegExp(`--hd-${m[1]}:\\s*(#[0-9a-fA-F]{3,6})\\b`).exec(globals);
  if (!def) throw new Error(`--hd-${m[1]} is not a colour in globals.css`);
  return def[1];
}

const css = readFileSync(join(process.cwd(), "src/styles/look-win98.css"), "utf8");

/** The declarations of one `html[data-look="win98"] <selector> { ... }` rule. */
function rule(selector: string): Record<string, string> {
  const head = `html[data-look="win98"] ${selector} {`;
  const at = css.indexOf(head);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const body = css.slice(at + head.length, css.indexOf("}", at));
  return Object.fromEntries(
    body
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d.includes(":"))
      .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]),
  );
}

describe("the signal meter", () => {
  it("reads its colours from the meter's custom properties, so a look can set them", () => {
    const { container } = render(<SignalMeter signalStrength={0.5} />);
    const segs = container.querySelectorAll<HTMLElement>(".hd-signal-seg");
    expect(segs).toHaveLength(10);
    expect(container.querySelectorAll(".hd-signal-seg[data-on]")).toHaveLength(5);
    expect(segs[0].style.backgroundColor).toContain("var(--signal-on");
    expect(segs[9].style.backgroundColor).toContain("var(--signal-off");
    expect(container.querySelector(".hd-signal-bar")).not.toBeNull();
    expect(container.querySelector(".hd-signal-label")?.textContent).toBe("Signal");
  });

  it("in Win98: navy blocks on white and an ink label, each past WCAG's ratio", () => {
    const meter = rule(".hd-signal");
    const on = resolve(meter["--signal-on"]);
    const field = resolve(rule(".hd-signal-bar").background);
    const label = resolve(rule(".hd-signal-label").color);
    const face = resolve("var(--hd-w98-face)");
    expect(contrast(on, field)).toBeGreaterThanOrEqual(3);
    expect(contrast(label, face)).toBeGreaterThanOrEqual(4.5);
    expect(meter["--signal-off"]).toBe("transparent");
    expect(meter["--signal-glow"]).toBe("none");
  });

  it("control: the old green LED on the gray face fails, so the ratio check can fail", () => {
    expect(contrast(PALETTE.greenBright, PALETTE.w98Face)).toBeLessThan(3);
  });
});
