import { describe, it, expect } from "vitest";
import type { Episode } from "@/db/schema";
import { suggestPlayable } from "@/lib/library/playable-suggestions";

const e = (name: string, over: Partial<Episode> = {}) =>
  ({ fileHash: `archive:coll:${name}.mp3`, fileName: `${name}.mp3`, title: name, ...over }) as Episode;

const target = e("target", { guestName: "Linda Moulton Howe", aiCategory: "Cattle Mutilations", airDate: "1998-05-10" });

describe("suggestPlayable", () => {
  it("same guest first, then category, then year — nearest air date first within each", () => {
    const g1 = e("g-far", { guestName: "Linda Moulton Howe", airDate: "2001-01-01" });
    const g2 = e("g-near", { guestName: "Linda Moulton Howe", airDate: "1998-06-01" });
    const c1 = e("c", { aiCategory: "Cattle Mutilations", airDate: "1999-01-01" });
    const y1 = e("y", { airDate: "1998-12-31" });
    const all = [g1, c1, y1, g2, target];
    const got = suggestPlayable(target, all, new Set(all.map((x) => x.fileHash)));
    expect(got.map((s) => [s.reason, s.episode.title])).toEqual([
      ["guest", "g-near"],
      ["guest", "g-far"],
      ["category", "c"],
    ]);
  });

  it("only shows the mirror holds, never the target itself", () => {
    const g = e("g", { guestName: "Linda Moulton Howe" });
    const y = e("y", { airDate: "1998-01-01" });
    const got = suggestPlayable(target, [target, g, y], new Set([target.fileHash, y.fileHash]));
    expect(got.map((s) => s.episode.title)).toEqual(["y"]);
  });

  it("fills with the nearest-dated playable shows when the tiers run short, and says so", () => {
    const n1 = e("n1", { airDate: "2000-01-01" });
    const n2 = e("n2", { airDate: "1990-01-01" });
    const got = suggestPlayable(target, [n1, n2], new Set([n1.fileHash, n2.fileHash]));
    expect(got.map((s) => [s.reason, s.episode.title])).toEqual([
      ["nearby", "n1"],
      ["nearby", "n2"],
    ]);
  });

  it("three at most, and the order never depends on input order", () => {
    const many = Array.from({ length: 10 }, (_, i) => e(`y${i}`, { airDate: "1998-05-10" }));
    const set = new Set(many.map((x) => x.fileHash));
    const a = suggestPlayable(target, many, set).map((s) => s.episode.title);
    const b = suggestPlayable(target, [...many].reverse(), set).map((s) => s.episode.title);
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
  });
});
