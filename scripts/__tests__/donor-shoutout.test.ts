// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SUPPORTERS, TIERS, tierOf, totalOf } from "@/lib/support/supporters";
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
  it("reads exactly the supporters the Stats page thanks, in order, with total, gifts and tier", () => {
    expect(S.parseSupporters(source)).toEqual(
      SUPPORTERS.map((s) => ({ name: s.name, amount: totalOf(s), gifts: [...s.gifts], tier: tierOf(s).id })),
    );
    // Several gifts: the admin console's `amount` is their sum.
    expect(S.parseSupporters('SUPPORTERS = [\n  { name: "Ann B.", gifts: [10, 40] },\n  { name: "Cal D.", gifts: [5] },\n];')).toEqual([
      { name: "Ann B.", amount: 50, gifts: [10, 40], tier: "owner" },
      { name: "Cal D.", amount: 5, gifts: [5], tier: "caller" },
    ]);
  });

  it("keeps the same tiers as the Stats page", () => {
    expect(S.TIERS).toEqual(TIERS);
  });

  it("Station Owners get their own sentence first, then everyone else, each named once", () => {
    const people = [
      { name: "Ann B.", gifts: [5] },
      { name: "Cal D.", gifts: [50] },
      { name: "Eve F.", gifts: [15] },
      { name: "Gus H.", gifts: [30, 30] },
    ];
    for (let i = 0; i < S.TEMPLATE_COUNT; i++) {
      const text = S.shoutoutText(people, i)!;
      expect(text.startsWith("A special thank you to our Station Owners: Cal D. and Gus H. ")).toBe(true);
      const after = text.slice(S.ownersSentence(["Cal D.", "Gus H."]).length);
      expect(after).toContain("Ann B. and Eve F.");
      expect(after).not.toContain("Cal D.");
      expect(after).not.toContain("Gus H.");
      expect(text).not.toContain("..");
      expect(text.length).toBeLessThanOrEqual(500);
    }
    expect(S.shoutoutText([{ name: "Cal D.", gifts: [50] }, { name: "Ann B.", gifts: [5] }], 0)).toMatch(
      /^A special thank you to our Station Owner: Cal D\. Thank you to the listeners who keep High Desert on the air: Ann B\. /,
    );
    // Only owners: one sentence, never named twice.
    const only = S.shoutoutText([{ name: "Cal D.", gifts: [50] }], 0)!;
    expect(only.match(/Cal D\./g)).toHaveLength(1);
    // No owners: as before.
    expect(S.shoutoutText([{ name: "Ann B.", gifts: [5] }], 0)).not.toContain("Station Owner");
  });

  it("today's shout-out names Joseph K. as the Station Owner, then the rest", () => {
    const text = S.shoutoutText(S.parseSupporters(source), 0)!;
    expect(text).toMatch(/^A special thank you to our Station Owner: Joseph K\. /);
    expect(text).toContain("Austin M., Alexandra M., Rachel B. and Craig A.");
    expect(text.length).toBeLessThanOrEqual(500);
  });

  it("names every supporter, newest first, in each phrasing, with no em dash and no amounts", () => {
    for (let i = 0; i < S.TEMPLATE_COUNT; i++) {
      const text = S.shoutoutText(SUPPORTERS, i)!;
      for (const s of SUPPORTERS) expect(text).toContain(s.name);
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
    const many = Array.from({ length: 80 }, (_, i) => ({ name: `Person${i} X.`, gifts: [i === 0 ? 50 : 5] }));
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
