// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SUPPORTERS } from "@/lib/support/supporters";
import * as S from "../donor-shoutout.mjs";

/**
 * The supporters' shout-out (scripts/donor-shoutout.mjs). It reads the same
 * file the Stats page renders, names everyone, never says it twice in one
 * gap, and only speaks in the evening, Pacific.
 */

const source = readFileSync(path.resolve(import.meta.dirname, "../../src/lib/support/supporters.ts"), "utf8");
// Pacific wall-clock time: daylight time until 1 November 2026, standard after.
const pacific = (iso: string, hour: number) =>
  Date.parse(`${iso}T${String(hour).padStart(2, "0")}:00:00${iso >= "2026-11-01" ? "-08:00" : "-07:00"}`);

describe("donor shout-out", () => {
  it("reads exactly the supporters the Stats page thanks, in order", () => {
    expect(S.parseSupporters(source)).toEqual(SUPPORTERS.map((s) => ({ name: s.name, amount: s.amount })));
  });

  it("names every supporter, newest first, in each phrasing, with no em dash and no amounts", () => {
    for (let i = 0; i < S.TEMPLATE_COUNT; i++) {
      const text = S.shoutoutText(SUPPORTERS, i)!;
      expect(text).toContain(S.listNames(SUPPORTERS.map((s) => s.name)));
      expect(text).not.toContain("—");
      expect(text).not.toMatch(/\$\d/);
      expect(text).not.toContain("..");
      expect(text.length).toBeLessThanOrEqual(500);
    }
    expect(S.listNames(["A"])).toBe("A");
    expect(S.listNames(["A", "B", "C"])).toBe("A, B and C");
    expect(S.shoutoutText([], 0)).toBeNull();
  });

  it("a long list stays under the notice limit and says how many more", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ name: `Person${i} X.`, amount: 5 }));
    const text = S.shoutoutText(many, 0)!;
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text).toMatch(/ and \d+ more\. /);
  });

  it("the gap is 4 to 6 days", () => {
    expect(S.nextGapHours(0)).toBe(96);
    expect(S.nextGapHours(0.999)).toBe(144);
  });

  it("due: only in the evening Pacific, and only once the gap has passed", () => {
    const last = { lastAt: new Date(pacific("2026-10-29", 20)).toISOString(), gapHours: 100 };
    // Never posted: the first evening hour.
    expect(S.due(null, pacific("2026-10-29", 19))).toBe(true);
    expect(S.due(null, pacific("2026-10-29", 10))).toBe(false);
    expect(S.due(null, pacific("2026-10-29", 23))).toBe(false);
    // 3 days on, an evening: not yet. 100 h on is past midnight; the next evening is.
    expect(S.due(last, pacific("2026-11-01", 20))).toBe(false);
    expect(S.due(last, pacific("2026-11-03", 0) + 3_600_000)).toBe(false);
    expect(S.due(last, pacific("2026-11-03", 18))).toBe(true);
  });

  it("status, for the admin console: the supporters, the last post, when the next may go, and its text", () => {
    const supporters = S.parseSupporters(source);
    const lastAt = new Date(pacific("2026-10-29", 20)).toISOString();
    const st = S.shoutoutStatus({ lastAt, gapHours: 100, template: 0, text: "the last one" }, supporters, pacific("2026-11-01", 20));
    expect(st.supporters).toEqual(supporters);
    expect(st.last).toEqual({ at: lastAt, text: "the last one" });
    expect(st.gapHours).toBe(100);
    expect(st.dueFrom).toBe(new Date(Date.parse(lastAt) + 100 * 3_600_000).toISOString());
    expect(st.due).toBe(false);
    expect(st.evening).toEqual({ from: 18, to: 23, tz: "America/Los_Angeles" });
    // The next phrasing, not the last one's.
    expect(st.preview).toBe(S.shoutoutText(supporters, 1));
    // Never posted: due in the evening, nothing last, no gap yet.
    const fresh = S.shoutoutStatus(null, supporters, pacific("2026-10-29", 19));
    expect(fresh).toMatchObject({ last: null, gapHours: null, dueFrom: null, due: true, preview: S.shoutoutText(supporters, 0) });
  });

  it("the timer and service are what the script expects", () => {
    const unit = readFileSync(path.resolve(import.meta.dirname, "../../deploy/highdesert-shoutout.service"), "utf8");
    expect(unit).toMatch(/ExecStart=\/usr\/bin\/node \/root\/High-Desert\/scripts\/donor-shoutout\.mjs\n/);
    expect(unit).toMatch(/EnvironmentFile=\/root\/\.high-desert-live\.env/);
    expect(unit).toMatch(/CPUQuota=10%/);
    const timer = readFileSync(path.resolve(import.meta.dirname, "../../deploy/highdesert-shoutout.timer"), "utf8");
    expect(timer).toMatch(/OnCalendar=\*-\*-\* \*:17:00/);
  });
});
