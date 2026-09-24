import { describe, it, expect } from "vitest";
import { buildListLayout } from "@/lib/library/list-layout";
import { prng, randInt } from "@/test-support/prng";

/**
 * Where rows and group headers sit. Row indices never change; only offsets
 * do, and every offset the list uses comes from here.
 */

describe("with no groups, it is the plain list (the old firstVisibleIndex)", () => {
  const plain = buildListLayout(100, [], 34, 26);
  it("rowAt is floor(y / rowHeight), clamped to the list", () => {
    expect(plain.rowAt(0)).toBe(0);
    expect(plain.rowAt(33)).toBe(0);
    expect(plain.rowAt(34)).toBe(1);
    expect(plain.rowAt(340)).toBe(10);
    expect(plain.rowAt(1e9)).toBe(99);
    expect(plain.rowAt(-50)).toBe(0);
    expect(buildListLayout(0, [], 34, 26).rowAt(100)).toBe(0);
  });
  it("adds no header height", () => {
    expect(plain.totalHeight).toBe(3400);
    expect(plain.rowTop(10)).toBe(340);
  });
});

describe("with groups, every group has a header directly above its first row", () => {
  // Rows 0-2 | 3 | 4-9 ; row 34px, header 26px.
  const L = buildListLayout(10, [0, 3, 4], 34, 26);

  it("puts each header immediately above its group's first row", () => {
    expect(L.headerTop(0)).toBe(0);
    expect(L.rowTop(0)).toBe(26);
    expect(L.rowTop(2)).toBe(26 + 2 * 34);
    expect(L.headerTop(1)).toBe(26 + 3 * 34);
    expect(L.rowTop(3)).toBe(L.headerTop(1) + 26);
    expect(L.headerTop(2)).toBe(L.rowTop(3) + 34);
    expect(L.rowTop(4)).toBe(L.headerTop(2) + 26);
    expect(L.totalHeight).toBe(10 * 34 + 3 * 26);
  });

  it("a header resolves to its group's first row", () => {
    expect(L.at(L.headerTop(1))).toEqual({ kind: "header", group: 1 });
    expect(L.rowAt(L.headerTop(1))).toBe(3);
    expect(L.rowAt(L.headerTop(2) + 25)).toBe(4);
  });

  it("round-trips, over random lists and groupings", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = prng(seed);
      const n = randInt(rand, 1, 60);
      const starts = [0];
      for (let i = 1; i < n; i++) if (rand() < 0.25) starts.push(i);
      const rowH = randInt(rand, 20, 120);
      const headH = randInt(rand, 10, 40);
      const layout = buildListLayout(n, starts, rowH, headH);

      let prevTop = -1;
      for (let i = 0; i < n; i++) {
        const top = layout.rowTop(i);
        expect(top, `seed ${seed}`).toBeGreaterThan(prevTop);
        prevTop = top;
        // Every pixel of the row maps back to the row.
        expect(layout.at(top), `seed ${seed} row ${i}`).toEqual({ kind: "row", index: i });
        expect(layout.at(top + rowH - 1), `seed ${seed} row ${i}`).toEqual({ kind: "row", index: i });
      }
      starts.forEach((first, g) => {
        expect(layout.rowTop(first) - layout.headerTop(g), `seed ${seed}`).toBe(headH);
        expect(layout.at(layout.headerTop(g)), `seed ${seed}`).toEqual({ kind: "header", group: g });
      });
      expect(layout.totalHeight).toBe(n * rowH + starts.length * headH);
      expect(layout.rowTop(n - 1) + rowH).toBe(layout.totalHeight);
    }
  });
});
