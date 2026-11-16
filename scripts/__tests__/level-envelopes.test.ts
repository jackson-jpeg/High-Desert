import { describe, expect, it } from "vitest";
import { backoffHours, parseEbur128, stationHashes, workOrder } from "../level-envelopes.mjs";

/** The shape of ffmpeg 6.1's ebur128 frame log (framelog=verbose), abridged. */
const LOG = `Input #0, mp3, from 'x.mp3':
[Parsed_ebur128_0 @ 0x5f] t: 0.1        TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x5f] t: 0.2        TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x5f] t: 0.3        TARGET:-23 LUFS    M: -40.1 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x5f] t: 0.4        TARGET:-23 LUFS    M: -21.5 S:-120.7     I: -21.5 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x5f] t: 0.5        TARGET:-23 LUFS    M: -20.0 S:-120.7     I: -20.7 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x5f] t: 0.6        TARGET:-23 LUFS    M:  -9.9 S:-120.7     I: -18.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x5f] Summary:

  Integrated loudness:
    I:         -18.0 LUFS
    Threshold: -28.0 LUFS
`;

describe("parseEbur128", () => {
  it("keeps one momentary value per 100 ms from the first full 400 ms window, and the integrated loudness", () => {
    const { L, lufs } = parseEbur128(LOG);
    expect(L).toEqual([-21.5, -20, -9.9]);
    expect(lufs).toBe(-18);
  });

  it("reads digital silence and -inf as silence, not a crash", () => {
    const { L } = parseEbur128(LOG.replace("M: -21.5", "M: -inf"));
    expect(L[0]).toBe(-120.7);
  });
});

describe("workOrder", () => {
  const row = (h: string, extra = {}) => ({ fileHash: h, archiveIdentifier: "c", fileName: `${h}.mp3`, ...extra });
  const catalog = [row("a"), row("b"), row("c"), row("d"), row("e")];
  const plays = new Map([
    ["c--b", 5],
    ["c--d", 9],
  ]);

  it("the station first, then by plays, then the rest; done and waiting skipped", () => {
    const order = workOrder({ catalog, plays, done: new Set(["d"]), waiting: new Set(["a"]), station: ["e", "e"] }).map((r: { fileHash: string }) => r.fileHash);
    expect(order).toEqual(["e", "b", "c"]);
  });

  it("with nothing done, every catalog show is in the list once", () => {
    const order = workOrder({ catalog, plays, done: new Set() });
    expect(order.map((r: { fileHash: string }) => r.fileHash)).toEqual(["d", "b", "a", "c", "e"]);
  });
});

describe("stationHashes", () => {
  const catalog = [{ fileHash: "x", airDate: "1997-11-17" }, { fileHash: "y", airDate: "1998-11-18" }];

  it("a frozen day: its slots and the top of its ranking", () => {
    const frozen = new Map([["2026-11-16", { slots: [{ fileHash: "s1" }, { fileHash: "s2" }], ranking: ["r1"] }]]);
    expect(stationHashes(["2026-11-16"], frozen, catalog)).toEqual(["s1", "s2", "r1"]);
  });

  it("a day not frozen yet: that date's own shows", () => {
    expect(stationHashes(["2026-11-17"], new Map(), catalog)).toEqual(["x"]);
  });
});

describe("backoffHours", () => {
  it("doubles, and never waits more than a week", () => {
    expect(backoffHours(1)).toBe(2);
    expect(backoffHours(3)).toBe(8);
    expect(backoffHours(40)).toBe(168);
  });
});
