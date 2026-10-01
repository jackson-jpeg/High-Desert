import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { guestRepeatsTitle, shownGuest } from "@/lib/library/guest";

/**
 * Guest fields that only repeated the title were cleared from the seed on
 * 2026-10-01 (docs/catalog-guests.md); a library seeded earlier still has them
 * and hides them through `shownGuest()`.
 */

interface SeedRow {
  title: string;
  airDate?: string;
  guestName?: string;
}
const catalog = JSON.parse(readFileSync(path.join(process.cwd(), "public", "seed", "library.json"), "utf8")) as SeedRow[];

describe("guest fields that repeat the title", () => {
  it("none is left in the seed", () => {
    expect(catalog.filter((r) => guestRepeatsTitle(r.title, r.guestName)).map((r) => `${r.airDate} ${r.guestName}`)).toEqual([]);
  });

  it("an old library's row hides it: 1997-09-11, the listener's example", () => {
    const old = {
      title: "Coast to Coast AM - Open Lines with Area 51 Employees",
      guestName: "Open Lines with Area 51 Employees Call-in",
    };
    expect(shownGuest(old)).toBeUndefined();
    expect(shownGuest({ title: "Coast to Coast AM - Ghost to Ghost 1997 Night 1", guestName: "Ghost To Ghost 1997 Night 1" })).toBeUndefined();
    expect(shownGuest({ title: "Coast to Coast AM - Open Lines on the Unabomber", guestName: "Open Lines & Unabomber" })).toBeUndefined();
  });

  it("a person whose name is the title is a real guest, and stays", () => {
    const hoagland = catalog.find((r) => r.title === "Coast to Coast AM - Richard C. Hoagland" && r.guestName);
    expect(hoagland?.guestName).toBe("Richard C. Hoagland");
    expect(shownGuest(hoagland)).toBe("Richard C. Hoagland");
    expect(shownGuest({ title: "Coast to Coast AM - Paul Stonehill & Gordon Lightfoot", guestName: "Paul Stonehill" })).toBe(
      "Paul Stonehill",
    );
  });

  it("the guests the seed still has are all still shown", () => {
    const withGuest = catalog.filter((r) => r.guestName);
    expect(withGuest.length).toBeGreaterThan(1000);
    expect(withGuest.filter((r) => shownGuest(r) !== r.guestName!.trim()).map((r) => r.guestName)).toEqual([]);
  });
});
