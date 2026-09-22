import { describe, it, expect } from "vitest";
import { communityKey } from "../community-key";
import catalog from "../../../../public/seed/library.json";

/**
 * communityKey is the id every community stat is filed under, and the server
 * accepts only keys in the allowlist generated from the same catalog
 * (scripts/gen-community-keys.mjs). A key that changes shape in the client
 * silently files every play under an id the server rejects — the plays are
 * simply not counted, with nothing on screen to say so.
 *
 * `allowlist.test.ts` checks the allowlist matches this function over the
 * catalog; this checks the function itself, on real filenames.
 */

type Row = { fileName: string; archiveIdentifier?: string | null };
const ROWS = catalog as Row[];

describe("communityKey", () => {
  it("is the collection id, a double dash, and the sanitized filename without its extension", () => {
    expect(
      communityKey({
        archiveIdentifier: "coll",
        fileName: "1993-09-03 - Coast to Coast AM with Art Bell -  John Lear - UFOs. Art and Ramona's Black Triangle Sighting.mp3",
      }),
    ).toBe("coll--1993-09-03_-_Coast_to_Coast_AM_with_Art_Bell_-__John_Lear_-_UFOs__Art_and_Ramona_s_Black_Triangle_Sighting");
  });

  it("strips only the last extension: a dot inside the name is part of the name", () => {
    expect(communityKey({ archiveIdentifier: "c", fileName: "Maj. Ed Dames.mp3" })).toBe("c--Maj__Ed_Dames");
    expect(communityKey({ archiveIdentifier: "c", fileName: "a.b.c" })).toBe("c--a_b");
  });

  it("caps the filename part at 120 characters", () => {
    const key = communityKey({ archiveIdentifier: "c", fileName: `${"x".repeat(300)}.mp3` })!;
    expect(key).toBe(`c--${"x".repeat(120)}`);
  });

  it("is null for a local file, which has no collection to be counted under", () => {
    expect(communityKey({ archiveIdentifier: undefined, fileName: "local.mp3" })).toBeNull();
    expect(communityKey({ archiveIdentifier: null, fileName: "local.mp3" })).toBeNull();
    expect(communityKey({ archiveIdentifier: "", fileName: "local.mp3" })).toBeNull();
  });

  it("gives every catalog episode a distinct, URL-safe key", () => {
    const keys = ROWS.map((r) => communityKey(r));
    expect(keys.every((k) => typeof k === "string" && /^[A-Za-z0-9_-]+--[A-Za-z0-9_-]{1,120}$/.test(k))).toBe(true);
    expect(new Set(keys).size).toBe(ROWS.length);
  });
});
