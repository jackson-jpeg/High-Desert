// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { randomCallerName, numberedCallerName, lineFor, LINES, EPITHETS, PLACES, nameKey } from "../lib/names.mjs";
import { createModerator } from "../lib/moderation/index.mjs";
import { MAX_NAME_CHARS } from "../lib/config.mjs";
import * as shared from "../lib/shared/client-key.ts";
import * as app from "../../../src/lib/utils/client-key.ts";

describe("caller names", () => {
  it("are Art Bell style, never longer than the limit, and pass the name filter", () => {
    const mod = createModerator();
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const n = randomCallerName();
      seen.add(n);
      expect(n.length).toBeLessThanOrEqual(MAX_NAME_CHARS);
      expect(n).toMatch(
        new RegExp(
          `^(?:(?:${EPITHETS.join("|")}) in (?:${PLACES.join("|")})|(?:West|East) of the Rockies caller|Wildcard Line caller|International Line caller|Area 51 Line caller|First-Time Caller from .+|Caller from .+)$`,
        ),
      );
      expect(mod.name(n).ok, n).toBe(true);
    }
    // Enough variety that two callers rarely draw the same one.
    expect(seen.size).toBeGreaterThan(500);
  });

  it("numbered names (for a night that holds every plain one) stay inside the limit and pass the filter", () => {
    const mod = createModerator();
    const accept = (n) => mod.name(n).ok;
    for (let i = 0; i < 2000; i++) {
      const n = numberedCallerName(undefined, undefined, accept);
      expect(n.length, n).toBeLessThanOrEqual(MAX_NAME_CHARS);
      expect(n).toMatch(/ \d{4}$/);
      expect(mod.name(n).ok, n).toBe(true);
    }
    // A base too long for the number is drawn again, never truncated.
    const long = "X".repeat(MAX_NAME_CHARS);
    let calls = 0;
    const base = () => (calls++ === 0 ? long : "Short Base");
    expect(numberedCallerName(() => 5, base)).toBe("Short Base 1005");
    // One the filter refuses is drawn again.
    let n = 0;
    const numbers = [3554, 1234];
    const refusing = numberedCallerName((max) => (max === 9000 ? numbers[n++] - 1000 : 0), () => "Owl in Ely", (x) => !/55/.test(x));
    expect(refusing).toBe("Owl in Ely 1234");
  });

  it("uses the injected randomness", () => {
    expect(randomCallerName(() => 1)).toBe(`${EPITHETS[1]} in ${PLACES[1]}`);
    expect(randomCallerName(() => 0)).toBe("West of the Rockies caller");
  });

  it("compare case-, accent- and punctuation-insensitively", () => {
    expect(nameKey("Night Owl in Pahrump")).toBe(nameKey("  night-owl  in PAHRUMP!"));
    expect(nameKey("Café Owl")).toBe(nameKey("Cafe Owl"));
    expect(nameKey("Night Owl in Pahrump")).not.toBe(nameKey("Night Owl in Tonopah"));
  });
});

describe("lines", () => {
  it("are fixed per caller and spread across all twelve", () => {
    const counts = new Map();
    for (let i = 0; i < 1200; i++) {
      const ref = (i * 2654435761 >>> 0).toString(16).padStart(8, "0") + "0".repeat(56);
      expect(lineFor(ref)).toBe(lineFor(ref));
      counts.set(lineFor(ref), (counts.get(lineFor(ref)) ?? 0) + 1);
    }
    expect(counts.size).toBe(LINES.length);
    expect(LINES).toContain("West of the Rockies");
    expect(LINES).toContain("Area 51 Line");
  });
});

describe("custom names go through the same filter", () => {
  const mod = createModerator(() => ({ entries: [{ kind: "block", term: "zorblax", prefix: false, suffix: false }], version: 1 }));
  it("refuses profanity outright (never masks a name), links, phones, reserved names, odd characters, lengths", () => {
    expect(mod.name(Buffer.from("ZnVjayBvZmY=", "base64").toString())).toEqual({ ok: false, reason: "name-profane" });
    expect(mod.name("Z0RBLAX in Ely")).toEqual({ ok: false, reason: "name-profane" });
    expect(mod.name("Art Bell")).toEqual({ ok: false, reason: "name-reserved" });
    expect(mod.name("the admin")).toEqual({ ok: false, reason: "name-reserved" });
    expect(mod.name("<script>")).toEqual({ ok: false, reason: "name-chars" });
    expect(mod.name("x")).toEqual({ ok: false, reason: "name-too-short" });
    expect(mod.name("a".repeat(MAX_NAME_CHARS + 1))).toEqual({ ok: false, reason: "name-too-long" });
    expect(mod.name("  Desert   Rat in Beatty ")).toEqual({ ok: true, text: "Desert Rat in Beatty" });
  });
});

describe("client key: the service uses the app's own function", () => {
  it("lib/shared/client-key.ts is a symlink to src/lib/utils/client-key.ts", () => {
    const link = path.resolve(import.meta.dirname, "../lib/shared/client-key.ts");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe("../../../../src/lib/utils/client-key.ts");
    expect(realpathSync(link)).toBe(path.resolve(import.meta.dirname, "../../../src/lib/utils/client-key.ts"));
  });

  it("buckets exactly as the app does: IPv6 on the /64, v4-mapped folded", () => {
    for (const ip of ["1.2.3.4", "::ffff:1.2.3.4", "2001:db8:1:2:3:4:5:6", "2001:db8:1:2::9", "[2001:db8::1]:443", "1.2.3.4:5678", "junk"]) {
      expect(shared.clientKey(ip)).toBe(app.clientKey(ip));
    }
    expect(shared.clientKey("2001:db8:1:2:aaaa::1")).toBe(shared.clientKey("2001:db8:1:2:bbbb::2"));
    expect(shared.clientKey("::ffff:1.2.3.4")).toBe("1.2.3.4");
  });
});
