import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { guestRepeatsTitle, MOVED_TO_TOPIC, shownGuest, topicFromGuest } from "@/lib/library/guest";

/**
 * Guest fields that only repeated the title were cleared from the seed on
 * 2026-10-01 (docs/catalog-guests.md); a library seeded earlier still has them
 * and hides them through `shownGuest()`.
 */

interface SeedRow {
  fileHash: string;
  title: string;
  airDate?: string;
  guestName?: string;
  topic?: string;
  aiTags?: string[];
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

describe("guest fields that describe the programme, moved to the topic (2026-10-09)", () => {
  const moved = Object.entries(MOVED_TO_TOPIC);

  it("ten rows, each in the seed with no guest and the guest's words as its topic", () => {
    expect(moved).toHaveLength(10);
    for (const [hash, guest] of moved) {
      const row = catalog.find((r) => r.fileHash === hash);
      expect(row, hash).toBeDefined();
      expect(row!.guestName, hash).toBeUndefined();
      expect(row!.topic, hash).toBe(topicFromGuest(guest));
    }
  });

  it("the old topic is kept as a tag: 2001-08-31, the listener's example", () => {
    const row = catalog.find((r) => r.airDate === "2001-08-31" && r.title === "Coast to Coast AM - Open Lines")!;
    expect(row.topic).toBe("Area 51, Earthquakes, and Crop Circles");
    expect(row.aiTags).toContain("area 51 earthquakes crop circles");
  });

  it("drops the file's hour note, nothing else", () => {
    expect(topicFromGuest("News, Commentary, Open Lines (hour 1)")).toBe("News, Commentary, Open Lines");
    expect(topicFromGuest("New Year's Predictions Night 2 (1st hour)")).toBe("New Year's Predictions Night 2");
    expect(topicFromGuest("Art's Secret")).toBe("Art's Secret");
  });

  it("an old library's row hides the moved guest, on that row only", () => {
    for (const [hash, guest] of moved) {
      expect(shownGuest({ fileHash: hash, title: "Coast to Coast AM - Anything", guestName: guest }), hash).toBeUndefined();
    }
    // Control: the same text on another row is still shown, and so is another guest on a moved row.
    const [hash, guest] = moved[0];
    expect(shownGuest({ fileHash: "archive:x:other.mp3", title: "Coast to Coast AM - Anything", guestName: "Art's Secret" })).toBe(
      "Art's Secret",
    );
    expect(shownGuest({ fileHash: hash, title: "Coast to Coast AM - Anything", guestName: "Linda Moulton Howe" })).toBe(
      "Linda Moulton Howe",
    );
    expect(guest).not.toBe("Linda Moulton Howe");
  });
});
