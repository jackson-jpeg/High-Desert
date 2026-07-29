import { describe, it, expect } from "vitest";
import { formatFileSize, LARGE_EPISODE_BYTES } from "../format";
import catalog from "../../../../public/seed/library.json";

/**
 * File size sits next to the runtime on the episode card because runtime alone
 * does not predict the wait. These are community rips at wildly varying
 * bitrates, so a three-hour show might be 25MB or 190MB — and a listener who
 * cannot tell the difference reads a slow start as a broken site, which is the
 * conclusion this whole thread of work exists to stop them reaching.
 */

describe("formatFileSize", () => {
  it("says nothing when the size is unknown", () => {
    // Not every episode has one, and "0 MB" next to a runtime reads as broken.
    expect(formatFileSize(null)).toBe("");
    expect(formatFileSize(undefined)).toBe("");
    expect(formatFileSize(0)).toBe("");
    expect(formatFileSize(NaN)).toBe("");
  });

  it("keeps one decimal only where it carries information", () => {
    expect(formatFileSize(3_900_000)).toBe("3.9 MB");
    expect(formatFileSize(38_900_000)).toBe("39 MB");
    expect(formatFileSize(268_500_000)).toBe("269 MB");
  });

  it("does not round a real file down to nothing", () => {
    expect(formatFileSize(77_380)).toBe("<1 MB");
  });
});

describe("LARGE_EPISODE_BYTES", () => {
  const sizes = (catalog as { fileSize?: number }[])
    .map((e) => e.fileSize ?? 0)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);

  it("flags the outliers and not the ordinary three-hour show", () => {
    const flagged = sizes.filter((n) => n >= LARGE_EPISODE_BYTES).length;
    const share = flagged / sizes.length;
    // Warning early on a quarter of the catalog would train the eye past it;
    // warning on nothing makes the threshold decorative. ~4% is the real tail.
    expect(share).toBeGreaterThan(0.005);
    expect(share).toBeLessThan(0.12);
  });

  it("sits above the median episode by a wide margin", () => {
    const median = sizes[Math.floor(sizes.length / 2)];
    expect(LARGE_EPISODE_BYTES).toBeGreaterThan(median * 2);
  });
});
