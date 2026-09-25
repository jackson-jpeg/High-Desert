// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate, unmigrate } from "../migrate.mjs";

/**
 * The one-time move from the torrent gateway's cache (data/<infohash>/<file>
 * + .complete) into nginx's pin directory. 16 GB of verified files that must
 * not be re-downloaded, and must not be lost: every assertion about a file
 * that could not be placed is on what *survives*.
 */

let cleanup = [];
afterEach(async () => {
  for (const f of cleanup.reverse()) await f();
  cleanup = [];
});
const exists = (p) => access(p).then(() => true, () => false);

const ih = (c) => c.repeat(40);
const E = {
  moved: { fh: "archive:coll:1995-08-21 - $95,000 Junk Mail #2 [h1].mp3", ih: ih("a"), len: 11 },
  moved2: { fh: "archive:coll:1996-01-01 - Second.mp3", ih: ih("b"), len: 12 },
  partial: { fh: "archive:coll:1997-01-01 - Partial.mp3", ih: ih("c"), len: 13 },
  wrongSize: { fh: "archive:coll:1998-01-01 - Wrong size.mp3", ih: ih("d"), len: 14 },
  missing: { fh: "archive:coll:1999-01-01 - Marked but missing.mp3", ih: ih("f"), len: 15 },
};
const INDEX = Object.fromEntries(Object.values(E).map((e) => [e.fh, { infohash: e.ih, length: e.len }]));
const fileName = (fh) => fh.replace(/^archive:[^:]+:/, "");

async function oldLayout({ only } = {}) {
  const tmp = await mkdtemp(path.join(tmpdir(), "hd-migrate-"));
  cleanup.push(() => rm(tmp, { recursive: true, force: true }));
  const cacheDir = path.join(tmp, "cache");
  const stateDir = path.join(tmp, "state");
  const put = async (e, { size = e.len, complete = true, file = true } = {}) => {
    const d = path.join(cacheDir, "data", e.ih);
    await mkdir(d, { recursive: true });
    if (file) await writeFile(path.join(d, fileName(e.fh)), Buffer.alloc(size, e.ih.charCodeAt(0)));
    if (complete) await writeFile(path.join(d, ".complete"), "");
  };
  await mkdir(cacheDir, { recursive: true });
  const want = only ?? Object.keys(E).concat("unknown");
  if (want.includes("moved")) await put(E.moved);
  if (want.includes("moved2")) await put(E.moved2);
  if (want.includes("partial")) await put(E.partial, { size: 5, complete: false });
  if (want.includes("wrongSize")) await put(E.wrongSize, { size: 3 });
  if (want.includes("missing")) await put(E.missing, { file: false });
  if (want.includes("unknown")) {
    await mkdir(path.join(cacheDir, "data", ih("e")), { recursive: true });
    await writeFile(path.join(cacheDir, "data", ih("e"), "x.mp3"), "?");
  }
  await writeFile(path.join(cacheDir, "pins.json"), JSON.stringify([E.moved.ih]));
  await writeFile(path.join(cacheDir, "state.json"), "{}");
  const pin = (e) => path.join(stateDir, "pins", e.fh);
  const old = (e) => path.join(cacheDir, "data", e.ih, fileName(e.fh));
  return { cacheDir, stateDir, pin, old };
}

describe("migrate", () => {
  it("moves each complete, correctly sized file by rename — the same inode, no copy — and writes the manifest", async () => {
    const w = await oldLayout();
    const ino = (await stat(w.old(E.moved))).ino;
    const r = await migrate({ cacheDir: w.cacheDir, stateDir: w.stateDir, index: INDEX });
    expect(r.moved).toBe(2);
    expect((await stat(w.pin(E.moved))).ino).toBe(ino);
    expect((await stat(w.pin(E.moved))).mode & 0o777).toBe(0o644);
    expect(await exists(path.join(w.cacheDir, "data", E.moved.ih))).toBe(false);
    const m = JSON.parse(await readFile(path.join(w.stateDir, "manifest.json"), "utf8"));
    expect(m.fileHashes).toEqual([E.moved.fh, E.moved2.fh]);
  });

  it("never deletes what it could not place: a wrong-sized file, a missing one, an unknown torrent and a partial all stay put", async () => {
    const w = await oldLayout();
    const r = await migrate({ cacheDir: w.cacheDir, stateDir: w.stateDir, index: INDEX });
    expect((await readFile(w.old(E.wrongSize))).length).toBe(3);
    expect(await exists(path.join(w.cacheDir, "data", E.wrongSize.ih, ".complete"))).toBe(true);
    expect(await exists(path.join(w.cacheDir, "data", E.missing.ih, ".complete"))).toBe(true);
    expect(await exists(path.join(w.cacheDir, "data", ih("e"), "x.mp3"))).toBe(true);
    expect(await exists(w.old(E.partial))).toBe(true);
    expect(await exists(w.pin(E.wrongSize))).toBe(false);
    expect(r.kept.map((k) => k.infohash).sort()).toEqual([E.wrongSize.ih, ih("e"), E.missing.ih].sort());
    expect(r.partialsKept).toBe(1);
    // data/ is not empty, so the old gateway's bookkeeping stays too.
    expect(await exists(path.join(w.cacheDir, "pins.json"))).toBe(true);
  });

  it("is idempotent: a second run moves nothing, loses nothing, and writes the same manifest", async () => {
    const w = await oldLayout();
    const first = await migrate({ cacheDir: w.cacheDir, stateDir: w.stateDir, index: INDEX });
    const second = await migrate({ cacheDir: w.cacheDir, stateDir: w.stateDir, index: INDEX });
    expect(second.moved).toBe(0);
    expect(second.manifest).toEqual(first.manifest);
    expect((await readFile(w.pin(E.moved))).length).toBe(E.moved.len);
    expect((await readFile(w.old(E.wrongSize))).length).toBe(3);
  });

  it("finishes an interrupted run: a pin already in place and its leftover original", async () => {
    const w = await oldLayout({ only: ["moved"] });
    await mkdir(path.join(w.stateDir, "pins"), { recursive: true });
    await writeFile(w.pin(E.moved), Buffer.alloc(E.moved.len, 7)); // placed; the original not yet removed
    const r = await migrate({ cacheDir: w.cacheDir, stateDir: w.stateDir, index: INDEX });
    expect(r.already).toBe(1);
    expect((await readFile(w.pin(E.moved)))[0]).toBe(7);
    expect(await exists(path.join(w.cacheDir, "data"))).toBe(false);
  });

  it("with --drop-partials removes never-verified downloads, and nothing else", async () => {
    const w = await oldLayout();
    const r = await migrate({ cacheDir: w.cacheDir, stateDir: w.stateDir, index: INDEX, dropPartials: true });
    expect(r.partialsDropped).toBe(1);
    expect(await exists(path.join(w.cacheDir, "data", E.partial.ih))).toBe(false);
    expect((await readFile(w.old(E.wrongSize))).length).toBe(3);
  });

  it("once everything is placed, data/ and the gateway's pins.json and state.json go", async () => {
    const w = await oldLayout({ only: ["moved", "moved2"] });
    await migrate({ cacheDir: w.cacheDir, stateDir: w.stateDir, index: INDEX });
    expect(await readdir(w.cacheDir)).toEqual([]);
    expect((await readdir(path.join(w.stateDir, "pins"))).sort()).toEqual([E.moved.fh, E.moved2.fh].sort());
  });

  it("with nothing to migrate it still writes a manifest from what is pinned", async () => {
    const w = await oldLayout({ only: [] });
    await rm(path.join(w.cacheDir, "data"), { recursive: true, force: true });
    const r = await migrate({ cacheDir: w.cacheDir, stateDir: w.stateDir, index: INDEX });
    expect(r.manifest.count).toBe(0);
  });

  it("--reverse (rollback) puts every pin back where the gateway reads it, marked complete and pinned", async () => {
    const w = await oldLayout({ only: ["moved", "moved2"] });
    const ino = (await stat(w.old(E.moved))).ino;
    await migrate({ cacheDir: w.cacheDir, stateDir: w.stateDir, index: INDEX });
    const r = await unmigrate({ cacheDir: w.cacheDir, stateDir: w.stateDir, index: INDEX });
    expect(r.restored).toBe(2);
    expect((await stat(w.old(E.moved))).ino).toBe(ino);
    expect(await exists(path.join(w.cacheDir, "data", E.moved.ih, ".complete"))).toBe(true);
    expect(JSON.parse(await readFile(path.join(w.cacheDir, "pins.json"), "utf8"))).toEqual([E.moved.ih, E.moved2.ih].sort());
    expect(await readdir(path.join(w.stateDir, "pins"))).toEqual([]);
  });
});
