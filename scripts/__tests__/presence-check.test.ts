// @vitest-environment node
import { describe, it, expect } from "vitest";
// @ts-expect-error — a plain .mjs script with no type declarations
import { judgeSurfaces } from "../presence-check.mjs";

/**
 * The live check's judgement, without a browser. The browser half only reads
 * attributes and text; whether it calls a disagreement is decided here.
 */

const s = (surface: string, online: number, listening: number, poll = "4", shown?: number[]) => ({
  surface,
  online,
  listening,
  poll,
  shown: shown ?? (surface === "badge" ? [online] : [online, listening]),
});

describe("judgeSurfaces", () => {
  it("agrees when every surface shows the same numbers for one poll", () => {
    const r = judgeSurfaces([s("status-bar", 8, 3), s("on-air", 8, 3), s("signal-traffic", 8, 3)]);
    expect(r.verdict).toBe("agree");
  });

  it("the screenshot that started this: 8, 10 and a badge of 7 disagree", () => {
    const r = judgeSurfaces([s("badge", 8, 3, "4", [7]), s("status-bar", 8, 3), s("on-air", 10, 5)]);
    expect(r.verdict).toBe("disagree");
    expect(r.detail).toContain("on-air says 10/5");
    expect(r.detail).toContain("badge displays [7]");
  });

  it("a surface whose text differs from its tag is a disagreement", () => {
    const r = judgeSurfaces([s("status-bar", 8, 3), s("signal-traffic", 8, 3, "4", [10, 5])]);
    expect(r.verdict).toBe("disagree");
  });

  it("surfaces from different polls are re-read, not judged", () => {
    expect(judgeSurfaces([s("status-bar", 8, 3, "4"), s("on-air", 9, 3, "5")]).verdict).toBe("mid-update");
  });

  it("no surfaces is empty, not agreement", () => {
    expect(judgeSurfaces([]).verdict).toBe("empty");
  });
});
