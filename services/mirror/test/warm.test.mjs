// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { choosePins, communityKeyOf } from "../warm.mjs";
import { parseTorrent, verifyAgainst } from "../lib/torrent-file.mjs";
import { meanSteal } from "../lib/steal.mjs";
import { torrentFromStream } from "../../../scripts/build-torrent-index.mjs";
import { communityKey } from "../../../src/lib/utils/community-key";
import catalog from "../../../public/seed/library.json";

describe("communityKeyOf", () => {
  it("is the app's communityKey for every catalog episode (it is restated, so it is checked)", () => {
    for (const e of catalog) expect(communityKeyOf(e.fileHash), e.fileHash).toBe(communityKey(e));
  });
});

describe("choosePins", () => {
  const index = {
    "archive:c:a.mp3": { infohash: "a", length: 6 },
    "archive:c:b.mp3": { infohash: "b", length: 5 },
    "archive:c:c.mp3": { infohash: "c", length: 3 },
    "archive:c:d.mp3": { infohash: "d", length: 1 },
  };
  const plays = ["a", "b", "c", "d", "zz-not-in-catalog"].map((k, i) => ({ episodeId: `c--${k}`, plays: 10 - i }));

  it("takes most-played first, whole files, and fills the budget with smaller ones further down", () => {
    const { pins, bytes } = choosePins(plays, index, 10);
    expect(pins.map((p) => p.infohash)).toEqual(["a", "c", "d"]);
    expect(bytes).toBe(10);
  });

  it("never exceeds the budget", () => {
    for (let budget = 0; budget < 20; budget++) expect(choosePins(plays, index, budget).bytes).toBeLessThanOrEqual(budget);
  });
});

describe("verifyAgainst", () => {
  const bytes = Buffer.from(Array.from({ length: 700_000 }, (_, i) => (i * 7) & 0xff));

  it("accepts the torrent's own bytes and rejects one flipped byte or a short file", async () => {
    const t = await torrentFromStream("x.mp3", Readable.from([bytes]), { webseed: "https://example.org/x.mp3" });
    const parsed = parseTorrent(t.torrent);
    expect(parsed.infohash).toBe(t.infohash);
    expect(parsed.urlList).toEqual(["https://example.org/x.mp3"]);
    await expect(verifyAgainst(parsed, Readable.from([bytes]))).resolves.toBe(bytes.length);

    const bad = Buffer.from(bytes);
    bad[400_000] ^= 1;
    await expect(verifyAgainst(parsed, Readable.from([bad]))).rejects.toThrow(/piece 1/);
    await expect(verifyAgainst(parsed, Readable.from([bytes.subarray(0, 600_000)]))).rejects.toThrow();
  });
});

describe("meanSteal", () => {
  const sar = `Linux 6.8.0 (srv) 09/24/26 _x86_64_ (2 CPU)

00:00:01        CPU     %user     %nice   %system   %iowait    %steal     %idle
21:40:01        all      5.00      0.00      2.00      0.10     10.00     82.90
21:50:01        all      5.00      0.00      2.00      0.10     30.00     62.90
22:00:01        all      5.00      0.00      2.00      0.10     50.00     42.90
22:10:01        all      5.00      0.00      2.00      0.10     70.00     22.90
Average:        all      5.00      0.00      2.00      0.10     40.00     52.90
`;
  it("averages the last N minutes of %steal, ignoring the Average line", () => {
    expect(meanSteal(sar, 30)).toBe(50);
    expect(meanSteal(sar, 10)).toBe(70);
  });
  it("no samples is null, not zero", () => {
    expect(meanSteal("", 30)).toBeNull();
  });
});
