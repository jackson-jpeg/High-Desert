// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ownLiveState, type Beat } from "../../e2e/own-presence";

/**
 * The rule e2e/live-qa.spec.ts "join, refresh, resume" judges its own page by.
 * It replaced a comparison with the site-wide live count, which another CI
 * worker tuned in at the same moment could shift (every local browser is one
 * client to the server). A rule that got these wrong would make the e2e test
 * pass on a page that never told the server anything true.
 */

const beat = (live: unknown, status = 200, sessionId = "s1"): Beat => ({ sessionId, live, status });

describe("ownLiveState", () => {
  it("knows nothing before the server has accepted a beat", () => {
    expect(ownLiveState([])).toBe("unknown");
    expect(ownLiveState([beat(true, 429), beat(true, 503)])).toBe("unknown");
  });

  it("is what the newest accepted beat said", () => {
    expect(ownLiveState([beat(undefined), beat(true)])).toBe("live");
    expect(ownLiveState([beat(true), beat(undefined)])).toBe("not-live");
  });

  it("ignores a beat the server refused: the mark there did not change", () => {
    expect(ownLiveState([beat(true), beat(undefined, 429)])).toBe("live");
    expect(ownLiveState([beat(undefined), beat(true, 429)])).toBe("not-live");
  });

  it("counts only the literal true, as the server does", () => {
    expect(ownLiveState([beat("true")])).toBe("not-live");
    expect(ownLiveState([beat(1)])).toBe("not-live");
  });

  it("can start after a reload, so the previous session's beats say nothing", () => {
    const beats = [beat(true, 200, "before"), beat(undefined, 200, "after")];
    expect(ownLiveState(beats, 1)).toBe("not-live");
    expect(ownLiveState([beat(true, 200, "before")], 1)).toBe("unknown");
  });
});
