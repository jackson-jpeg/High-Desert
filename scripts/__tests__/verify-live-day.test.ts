// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { candidatesFor, check, communityKey as scriptKey, importable, monthDays, nextPacificDay, sourceFor, walkedSet } from "../verify-live-day.mjs";
import { communityKey } from "@/lib/utils/community-key";
import { onThisDateKeys, rankByPlays, type CatalogRow } from "@/lib/live/schedule";

/**
 * The station's nightly pre-air walk (scripts/verify-live-day.mjs). It must
 * walk what can actually air on the day — the same on-this-date block and
 * fan-favorite order the station builds — and judge a repaired show by the
 * copy the mirror serves.
 */

const CATALOG: CatalogRow[] = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../public/seed/library.json"), "utf8"));

/** n frames of MPEG-1 Layer III, 44.1 kHz; `mono` per frame. */
function mp3(layout: boolean[]): Buffer {
  const FRAME = 417;
  const buf = Buffer.alloc(FRAME * layout.length);
  layout.forEach((mono, i) => buf.writeUInt32BE(mono ? 0xfffb90c4 : 0xfffb9004, i * FRAME));
  return buf;
}

describe("what can air on a day", () => {
  const plays = new Map(CATALOG.slice(0, 200).map((r, i) => [communityKey(r)!, 500 - i]));

  it("keys plays exactly as the stats tables do", () => {
    for (const r of CATALOG.slice(0, 50)) expect(scriptKey(r)).toBe(communityKey(r));
  });

  it("month-days fold 29 Feb onto 28 Feb like the station", () => {
    for (const d of ["2027-02-28", "2028-02-28", "2028-02-29", "2026-10-12"]) expect(monthDays(d)).toEqual(onThisDateKeys(d));
  });

  it("walks the day's on-this-date shows and the station's top favorites in its order, nothing already checked", () => {
    const day = "2026-10-12";
    const todo: CatalogRow[] = candidatesFor(day, { catalog: CATALOG, plays, checked: new Set(), favorites: 20 });
    const otd = CATALOG.filter((r) => r.airDate?.slice(5) === "10-12" && (r.duration ?? 0) > 0).map((r) => r.fileHash);
    expect(otd.length).toBeGreaterThan(0);
    expect(todo.slice(0, otd.length).map((r) => r.fileHash)).toEqual(otd);
    const top = rankByPlays({ catalog: CATALOG, plays }).slice(0, 20).map((r) => r.fileHash);
    for (const h of top) expect(todo.map((r) => r.fileHash)).toContain(h);

    const checked = new Set([otd[0], top[0]]);
    const again: CatalogRow[] = candidatesFor(day, { catalog: CATALOG, plays, checked, favorites: 20 });
    expect(again.map((r) => r.fileHash)).not.toContain(otd[0]);
    expect(again.map((r) => r.fileHash)).not.toContain(top[0]);
    expect(again).toHaveLength(todo.length - 2);
  });

  it("a frozen day's own slots come first", () => {
    const slots = [{ fileHash: CATALOG[900].fileHash }];
    const todo: CatalogRow[] = candidatesFor("2026-10-12", { catalog: CATALOG, plays, checked: new Set(), frozen: { slots, ranking: [] } as never, favorites: 5 });
    expect(todo[0].fileHash).toBe(CATALOG[900].fileHash);
  });

  it("the next Pacific day, across UTC midnight", () => {
    // 2026-10-12T05:00Z is 22:00 on the 11th in Los Angeles.
    expect(nextPacificDay(Date.parse("2026-10-12T05:00:00Z"))).toBe("2026-10-12");
    expect(nextPacificDay(Date.parse("2026-10-12T08:00:00Z"))).toBe("2026-10-13");
  });
});

describe("what counts as walked", () => {
  it("a bad verdict on a repaired show is walked again; every other verdict stands", () => {
    const rows = [
      { file_hash: "fixed", ok: false },
      { file_hash: "fixed-ok", ok: true },
      { file_hash: "broken", ok: false },
      { file_hash: "fine", ok: true },
    ];
    const walked = walkedSet(rows, new Set(["fixed", "fixed-ok"]));
    expect([...walked].sort()).toEqual(["broken", "fine", "fixed-ok"]);
  });
});

describe("walking a file", () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), "hd-verify-"));
  mkdirSync(path.join(stateDir, "pins"));
  mkdirSync(path.join(stateDir, "repaired"));
  const row = { fileHash: "archive:coll:x.mp3", sourceUrl: "http://127.0.0.1:9/never", duration: 1000, airDate: "1990-01-01" };

  it("judges a repaired show by the mirror's copy, ahead of a pin of the broken original", async () => {
    writeFileSync(path.join(stateDir, "pins", row.fileHash), mp3([...Array(300).fill(false), ...Array(300).fill(true)]));
    writeFileSync(path.join(stateDir, "repaired", row.fileHash), mp3(Array(600).fill(true)));
    const repaired = new Set([row.fileHash]);
    expect(sourceFor(row, { stateDir, repaired }).kind).toBe("repaired");
    expect(await check(row, { stateDir, repaired })).toMatchObject({ ok: true, from: "repaired" });
    // Control: without the repair record, the pin of the original is walked and fails.
    expect(await check(row, { stateDir, repaired: new Set() })).toMatchObject({ ok: false, reason: "midstream-change", from: "pin" });
  });

  it("an unreadable file is no verdict at all", async () => {
    const r = await check({ ...row, fileHash: "archive:coll:gone.mp3" }, { stateDir, repaired: new Set() });
    expect(r.error).toBeTruthy();
    expect(r).not.toHaveProperty("ok");
  });

  it("imports only scan rows with a verdict, never a repaired show's original", () => {
    const scan = new Map([
      ["a", { fileHash: "a", ok: true, reason: null }],
      ["b", { fileHash: "b", ok: false, reason: "midstream-change" }],
      ["c", { fileHash: "c", ok: false, reason: "unreadable", error: "HTTP 503" }],
      ["d", { fileHash: "d", ok: false, reason: "midstream-change" }],
    ]);
    expect(importable(scan, new Set(["d"])).map((r: { fileHash: string }) => r.fileHash)).toEqual(["a", "b"]);
  });
});
