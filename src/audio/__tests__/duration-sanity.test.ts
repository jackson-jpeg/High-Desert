import { describe, it, expect } from "vitest";
import { assessDuration } from "../duration-sanity";

/**
 * The catalog contains one episode with no audio in it — 77KB of ID3 tag
 * wrapping a JPEG, zero MP3 frames — and archive.org serves it with a clean 206
 * and the right content type. Pressing play on it produces nothing, which is
 * indistinguishable from "the show didn't start".
 *
 * The risk in fixing that is over-reach. 37 of the 1,313 episodes are under ten
 * minutes and all but one are real: statements, single hours, follow-ups. And
 * `duration` at `loadedmetadata` is an extrapolation for a VBR rip with no Xing
 * header, which describes most of this catalog. Refusing to play on the
 * strength of either signal would break working shows to fix a broken one.
 *
 * So most of these tests are about what must NOT be flagged.
 */

describe("assessDuration", () => {
  describe("what must never be flagged", () => {
    it("passes a full broadcast", () => {
      expect(
        assessDuration({ actual: 10_800, expected: 10_800, stage: "ended" }),
      ).toBe("ok");
    });

    it("passes a legitimately short segment with no catalogued duration", () => {
      // "Art's Statement on Sudden Resignation" is 102 seconds and real.
      expect(
        assessDuration({ actual: 102, expected: null, stage: "ended" }),
      ).toBe("ok");
    });

    it("passes a short segment whose catalogued duration agrees", () => {
      expect(assessDuration({ actual: 210, expected: 210, stage: "ended" })).toBe(
        "ok",
      );
    });

    it("ignores a wildly wrong estimate at metadata time", () => {
      // A VBR rip with no Xing header routinely reports nonsense here and
      // corrects itself later. Acting on it would reject a working three-hour
      // show outright.
      expect(
        assessDuration({ actual: 600, expected: 10_800, stage: "metadata" }),
      ).toBe("ok");
    });

    it("treats an unknown duration as no evidence", () => {
      expect(
        assessDuration({ actual: NaN, expected: 10_800, stage: "ended" }),
      ).toBe("ok");
    });

    it("treats an unbounded stream as no evidence", () => {
      expect(
        assessDuration({ actual: Infinity, expected: null, stage: "ended" }),
      ).toBe("ok");
    });

    it("tolerates a near miss rather than calling it truncated", () => {
      // 90 seconds short of a 3-minute clip is under the absolute shortfall
      // floor, so it stays silent even though the ratio looks bad.
      expect(assessDuration({ actual: 90, expected: 180, stage: "ended" })).toBe(
        "ok",
      );
    });

    it("does not flag a file merely a little shorter than catalogued", () => {
      expect(
        assessDuration({ actual: 9_000, expected: 10_800, stage: "ended" }),
      ).toBe("ok");
    });
  });

  describe("what must be caught", () => {
    it("calls a tag-only file empty, even before metadata settles", () => {
      // The real one: 77,380 bytes, zero frames, no duration in the catalog.
      expect(
        assessDuration({ actual: 0, expected: null, stage: "metadata" }),
      ).toBe("empty");
    });

    it("calls five seconds of nothing empty whatever the catalog claims", () => {
      expect(
        assessDuration({ actual: 4.2, expected: 10_800, stage: "metadata" }),
      ).toBe("empty");
    });

    it("calls a badly truncated file truncated once the file has been seen", () => {
      // Half an hour of a three-hour show: past both the ratio and the
      // absolute shortfall floor.
      expect(
        assessDuration({ actual: 1_800, expected: 10_800, stage: "ended" }),
      ).toBe("truncated");
    });
  });
});
