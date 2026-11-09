import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { SPONSOR_IDS, SPONSOR_LINE, SPONSORS } from "@/lib/support/sponsors";
import { SPOT_AUDIO } from "@/lib/live/breaks";

/** Station sponsors' copy and the rendered spots (docs/station-breaks.md). */

const ROOT = path.resolve(__dirname, "../../../..");
const spots = JSON.parse(readFileSync(path.join(ROOT, "data/station-breaks/spots.json"), "utf8")) as {
  voice: { model: string };
  spots: { id: string; cart: string; script: string }[];
};

describe("sponsors", () => {
  it("are Jackson's three apps, each with its App Store page", () => {
    expect(SPONSOR_IDS).toEqual(["sogojet", "screenreceipts", "simsunday"]);
    for (const s of Object.values(SPONSORS)) {
      expect(s.appStoreUrl).toMatch(/^https:\/\/apps\.apple\.com\/us\/app\/[a-z0-9-]+\/id\d{9,}$/);
    }
    expect(SPONSORS.sogojet.appStoreUrl).toContain("id6761575104");
    expect(SPONSORS.screenreceipts.appStoreUrl).toContain("id6762238386");
    expect(SPONSORS.simsunday.appStoreUrl).toContain("id6821134536");
  });

  it("say the App Store's own price: Screen Receipts is not free", () => {
    expect(SPONSORS.screenreceipts.price).toBe("$0.99 on the App Store");
    expect(SPONSORS.sogojet.price).toBe("Free on the App Store");
    expect(SPONSORS.simsunday.price).toBe("Free on the App Store");
  });

  it("no em dash in any copy a listener reads or hears", () => {
    const text = [SPONSOR_LINE, ...Object.values(SPONSORS).flatMap((s) => [s.name, s.headline, s.body, s.price]), ...spots.spots.map((s) => s.script)];
    for (const t of text) expect(t).not.toContain("—");
  });

  it("SoGoJet never claims a flight to a town with no airport", () => {
    const sogo = spots.spots.find((s) => s.id === "sogojet")!.script + SPONSORS.sogojet.body;
    expect(sogo).toMatch(/airport nearest/);
    expect(sogo).not.toMatch(/flights? to (Rachel|Point Pleasant)/i);
  });
});

describe("the rendered spots", () => {
  it("one per sponsor, with the cart the script names", () => {
    for (const s of spots.spots) {
      expect(SPOT_AUDIO[s.id]?.cart).toBe(s.cart);
      expect(SPONSORS[s.id as keyof typeof SPONSORS].cart).toBe(s.cart);
    }
    expect(Object.keys(SPOT_AUDIO).sort()).toEqual([...SPONSOR_IDS].sort());
  });

  it("are 15 to 20 seconds, and the files on disk are the ones measured", () => {
    for (const a of Object.values(SPOT_AUDIO)) {
      expect(a.durationSec).toBeGreaterThanOrEqual(15);
      expect(a.durationSec).toBeLessThanOrEqual(20);
      const file = path.join(ROOT, "public", a.url);
      const meta = (SPOT_AUDIO as Record<string, { bytes?: number; sha256?: string }>)[a.id];
      expect(statSync(file).size).toBe(meta.bytes);
      expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe(meta.sha256);
    }
  });
});
