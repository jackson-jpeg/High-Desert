// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { Readable } from "node:stream";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { choosePins, communityKeyOf, runWarm } from "../warm.mjs";
import { fixtureMp3, torrentOf } from "./fixtures.mjs";
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

describe("runWarm", () => {
  let cleanup = [];
  afterEach(async () => {
    for (const f of cleanup.reverse()) await f();
    cleanup = [];
  });

  const GOOD = fixtureMp3(11, 700);
  const OTHER = fixtureMp3(12, 400);
  const OLD = fixtureMp3(13, 300);
  const names = { good: "1990-01-01 Good.mp3", other: "1990-02-02 Other.mp3", old: "1990-03-03 Old.mp3" };
  const fh = (n) => `archive:c:${n}`;

  async function world({ serve = {} } = {}) {
    const tmp = await mkdtemp(path.join(tmpdir(), "hd-warm-"));
    cleanup.push(() => rm(tmp, { recursive: true, force: true }));
    const stateDir = path.join(tmp, "state");
    const torrentDir = path.join(tmp, "torrents");
    await mkdir(torrentDir, { recursive: true });
    const index = {};
    for (const [k, bytes] of [["good", GOOD], ["other", OTHER], ["old", OLD]]) {
      const t = await torrentOf(names[k], bytes, `https://archive.test/${k}`);
      await writeFile(path.join(torrentDir, `${t.infohash}.torrent`), t.buf);
      index[fh(names[k])] = { infohash: t.infohash, length: t.length, pieceLength: t.parsed.pieceLength };
    }
    // What "archive.org" answers per URL; default: the true bytes.
    const bodies = { "https://archive.test/good": GOOD, "https://archive.test/other": OTHER, "https://archive.test/old": OLD, ...serve };
    const fetched = [];
    const fetchImpl = async (u) => {
      fetched.push(u);
      const b = bodies[u];
      return b ? new Response(b) : new Response("nope", { status: 404 });
    };
    const statusPath = path.join(tmp, "warm-status.json");
    const run = (over = {}) =>
      runWarm({
        stateDir,
        statusPath,
        torrentDir,
        index,
        budgetBytes: 10 * 1024 ** 3,
        floorBytes: 0,
        maxSteal: 20,
        steal: () => 3,
        plays: async () => [names.good, names.other].map((n, i) => ({ episodeId: communityKeyOf(fh(n)), plays: 9 - i })),
        fetchImpl,
        freeBytes: async () => 1e15,
        log: () => {},
        ...over,
      });
    const pins = async () => (await readdir(path.join(stateDir, "pins"))).sort();
    const manifest = async () => JSON.parse(await readFile(path.join(stateDir, "manifest.json"), "utf8"));
    return { stateDir, statusPath, index, run, pins, manifest, fetched };
  }

  it("downloads, verifies and pins the top episodes; the manifest lists exactly them", async () => {
    const w = await world();
    const status = await w.run();
    expect(await w.pins()).toEqual([fh(names.good), fh(names.other)].sort());
    const onDisk = await readFile(path.join(w.stateDir, "pins", fh(names.good)));
    expect(onDisk.equals(GOOD)).toBe(true);
    expect((await stat(path.join(w.stateDir, "pins", fh(names.good)))).mode & 0o777).toBe(0o644);
    const m = await w.manifest();
    expect(m.fileHashes).toEqual([fh(names.good), fh(names.other)].sort());
    expect(m.count).toBe(2);
    expect(status).toMatchObject({ outcome: "ok", pinned: 2, fetched: 2, failed: 0, bytes: GOOD.length + OTHER.length });
    expect(JSON.parse(await readFile(w.statusPath, "utf8"))).toMatchObject({ outcome: "ok", pinned: 2 });
  });

  it("a download that fails piece verification is never pinned, and leaves nothing behind", async () => {
    const bad = Buffer.from(GOOD);
    bad[200_000] ^= 0xff; // inside the file (291,900 bytes): piece 0 of 2
    const w = await world({ serve: { "https://archive.test/good": bad } });
    const status = await w.run();
    expect(await w.pins()).toEqual([fh(names.other)]);
    expect((await w.manifest()).fileHashes).toEqual([fh(names.other)]);
    expect(status).toMatchObject({ fetched: 1, failed: 1 });
    expect(await readdir(path.join(w.stateDir, "tmp"))).toEqual([]);
  });

  it("a short download is rejected the same way", async () => {
    const w = await world({ serve: { "https://archive.test/good": GOOD.subarray(0, 100_000) } });
    await w.run();
    expect(await w.pins()).toEqual([fh(names.other)]);
  });

  it("skips itself above the steal limit: no plays read, nothing fetched, nothing unpinned", async () => {
    const w = await world();
    await w.run();
    const before = await w.manifest();
    let asked = false;
    const status = await w.run({
      steal: () => 34.5,
      plays: async () => {
        asked = true;
        return [];
      },
    });
    expect(status).toMatchObject({ outcome: "skipped-steal", steal: 34.5 });
    expect(asked).toBe(false);
    expect(await w.pins()).toHaveLength(2);
    expect(await w.manifest()).toEqual(before);
    expect(JSON.parse(await readFile(w.statusPath, "utf8")).outcome).toBe("skipped-steal");
  });

  it("no steal data is not a reason to skip", async () => {
    const w = await world();
    expect((await w.run({ steal: () => null })).outcome).toBe("ok");
  });

  it("unpins what fell out of the top, keeps what is still in it without fetching it again", async () => {
    const w = await world();
    await w.run({ plays: async () => [{ episodeId: communityKeyOf(fh(names.old)), plays: 5 }, { episodeId: communityKeyOf(fh(names.good)), plays: 4 }] });
    expect(await w.pins()).toEqual([fh(names.good), fh(names.old)].sort());
    const fetchedBefore = w.fetched.length;
    const status = await w.run();
    expect(await w.pins()).toEqual([fh(names.good), fh(names.other)].sort());
    expect(status).toMatchObject({ pruned: 1, fetched: 1 });
    expect(w.fetched.slice(fetchedBefore)).toEqual(["https://archive.test/other"]);
    expect((await w.manifest()).fileHashes).not.toContain(fh(names.old));
  });

  it("an empty play list unpins nothing", async () => {
    const w = await world();
    await w.run();
    const status = await w.run({ plays: async () => [] });
    expect(status.outcome).toBe("no-plays");
    expect(await w.pins()).toHaveLength(2);
  });

  it("stops at the disk floor", async () => {
    const w = await world();
    const status = await w.run({ floorBytes: 1e9, freeBytes: async () => 1e9 + GOOD.length - 1 });
    expect(status.outcome).toBe("stopped-at-floor");
    expect(await w.pins()).toEqual([]);
  });
});
