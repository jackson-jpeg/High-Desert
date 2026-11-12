// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assembleSchedule } from "@/services/live/days";
import { buildDay, NOT_ART_HOSTED, type CatalogRow, type DayProgram } from "@/lib/live/schedule";

/**
 * A day frozen before data/hosts.json (2026-11-12) can hold a show someone
 * other than Art hosted. The published schedule swaps it out at read time
 * (applyHostSwap), so the station never airs it whatever was frozen.
 */

const CATALOG: CatalogRow[] = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../public/seed/library.json"), "utf8"));
const byHash = new Map(CATALOG.map((r) => [r.fileHash, r]));
const NOORY = [...NOT_ART_HOSTED].find((h) => h.includes("2001-11-12"))!;

describe("the published schedule never airs a frozen non-Art slot", () => {
  const day = "2026-11-13";
  const built = buildDay(day, { catalog: CATALOG, plays: new Map() }, []);
  const frozen: DayProgram = { ...built, slots: built.slots.map((s, i) => (i === 1 ? { ...s, fileHash: NOORY, title: "Noory" } : s)) };
  const ctx = { archiveDown: false, manifest: null };

  it("swaps it for a fan favorite in the same slot, and a tab tuned in then hears the swap", () => {
    const at = frozen.slots[1].start + 60_000;
    const s = assembleSchedule(at, frozen, null, ctx, byHash);
    expect(s.guide.some((x) => x.fileHash === NOORY)).toBe(false);
    expect(s.guide[1]).toMatchObject({ kind: "host-swap", replaces: NOORY, start: frozen.slots[1].start });
    expect(s.now && "slot" in s.now && s.now.slot.kind).toBe("host-swap");
  });

  it("control: a frozen day without one comes back as frozen", () => {
    const s = assembleSchedule(built.slots[1].start + 60_000, built, null, ctx, byHash);
    expect(s.guide).toEqual(built.slots);
  });
});
