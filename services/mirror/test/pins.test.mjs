// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readPins, writeManifest, manifestOf, layout } from "../lib/pins.mjs";

/**
 * /mirror/manifest is the episodes the mirror can play with archive.org gone.
 * The client decides from it, before any request, whether a start can work at
 * all: a listed file that is not whole on disk sends a listener into a wait
 * for nothing, and one left out is refused when it would have played.
 */

let cleanup = [];
afterEach(async () => {
  for (const f of cleanup.reverse()) await f();
  cleanup = [];
});

const INDEX = {
  "archive:coll:1997-01-01 Whole.mp3": { infohash: "a".repeat(40), length: 10 },
  "archive:coll:1998-02-02 Also whole.mp3": { infohash: "b".repeat(40), length: 20 },
  "archive:coll:1999-03-03 Short.mp3": { infohash: "c".repeat(40), length: 30 },
};

async function state() {
  const tmp = await mkdtemp(path.join(tmpdir(), "hd-pins-"));
  cleanup.push(() => rm(tmp, { recursive: true, force: true }));
  const stateDir = path.join(tmp, "state");
  const { pins } = layout(stateDir);
  await mkdir(pins, { recursive: true });
  await writeFile(path.join(pins, "archive:coll:1997-01-01 Whole.mp3"), Buffer.alloc(10, 1));
  await writeFile(path.join(pins, "archive:coll:1998-02-02 Also whole.mp3"), Buffer.alloc(20, 2));
  // A copy cut short (a full disk, a crash): the right name, not the right bytes.
  await writeFile(path.join(pins, "archive:coll:1999-03-03 Short.mp3"), Buffer.alloc(7, 3));
  // Not an episode at all, and a directory wearing an episode's name.
  await writeFile(path.join(pins, "archive:coll:stray.mp3"), Buffer.alloc(5));
  return { stateDir, pins, manifestPath: layout(stateDir).manifest };
}

describe("the manifest writer", () => {
  it("lists every whole catalog episode in the pin directory — nothing short, nothing unknown", async () => {
    const { stateDir } = await state();
    const m = await writeManifest({ stateDir, index: INDEX });
    expect(m.fileHashes).toEqual(["archive:coll:1997-01-01 Whole.mp3", "archive:coll:1998-02-02 Also whole.mp3"]);
    expect(m.count).toBe(2);
    expect(m.pinned).toBe(2);
    expect(m.version).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.parse(await readFile(layout(stateDir).manifest, "utf8"))).toEqual(m);
  });

  it("readPins reports each pin's size, for the status line", async () => {
    const { pins } = await state();
    expect((await readPins(pins, INDEX)).map((p) => p.bytes)).toEqual([10, 20]);
  });

  it("changes version when the playable set changes, and only then", async () => {
    const { stateDir, pins } = await state();
    const first = await writeManifest({ stateDir, index: INDEX });
    expect((await writeManifest({ stateDir, index: INDEX })).version).toBe(first.version);
    await writeFile(path.join(pins, "archive:coll:1999-03-03 Short.mp3"), Buffer.alloc(30, 3));
    const next = await writeManifest({ stateDir, index: INDEX });
    expect(next.version).not.toBe(first.version);
    expect(next.fileHashes).toContain("archive:coll:1999-03-03 Short.mp3");
  });

  it("the version is a digest of the sorted list, whatever order it is given in", () => {
    expect(manifestOf(["b", "a"]).version).toBe(manifestOf(["a", "b"]).version);
    expect(manifestOf(["a"]).version).not.toBe(manifestOf(["a", "b"]).version);
  });

  it("is written atomically: a reader holding the old file keeps the old bytes, and no temp file is left", async () => {
    const { stateDir, pins, manifestPath } = await state();
    await writeManifest({ stateDir, index: INDEX });
    const oldBody = await readFile(manifestPath, "utf8");
    const oldIno = (await stat(manifestPath)).ino;
    // nginx half way through sending the previous manifest.
    const reader = await open(manifestPath, "r");
    try {
      await rm(path.join(pins, "archive:coll:1998-02-02 Also whole.mp3"));
      await writeManifest({ stateDir, index: INDEX });
      const { buffer } = await reader.read({ buffer: Buffer.alloc(oldBody.length + 64), position: 0 });
      expect(buffer.toString("utf8").replace(/\0+$/, "")).toBe(oldBody);
    } finally {
      await reader.close();
    }
    expect((await stat(manifestPath)).ino).not.toBe(oldIno);
    expect(JSON.parse(await readFile(manifestPath, "utf8")).count).toBe(1);
    expect((await readdir(stateDir)).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it("an empty or missing pin directory is an empty manifest, not an error", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "hd-pins-empty-"));
    cleanup.push(() => rm(tmp, { recursive: true, force: true }));
    const m = await writeManifest({ stateDir: tmp, index: INDEX });
    expect(m).toMatchObject({ count: 0, fileHashes: [] });
  });
});
