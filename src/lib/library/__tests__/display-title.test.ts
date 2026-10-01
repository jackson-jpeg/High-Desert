import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { episodeTitle, keyTitle, looksLikeFileName, UNTITLED } from "@/lib/library/display-title";
import { communityKey } from "@/lib/utils/community-key";

/**
 * A file name can never be shown as a title (2026-10-01). On Air printed
 * "Art-Bell_Midnight_In_the_Desert--2015-12-08_--_Ar…", a community key, for a
 * show the listener's library did not hold.
 */

const SCREENSHOT_KEY =
  "Art-Bell_Midnight_In_the_Desert--2015-12-08_-_Art_Bell_MITD_-_Dr_David_Jacobs_Alien_Experimentation_on_Humans";

interface SeedRow {
  title: string;
  fileName: string;
  archiveIdentifier?: string;
}
const catalog = JSON.parse(readFileSync(path.join(process.cwd(), "public", "seed", "library.json"), "utf8")) as SeedRow[];

describe("looksLikeFileName", () => {
  it("knows a file name, a key and an encoded path", () => {
    for (const s of [
      SCREENSHOT_KEY,
      "Art-Bell_Midnight_In_the_Desert--2015-12-08_--_Ar",
      "2015-12-08 - Art Bell MITD - Dr David Jacobs.mp3",
      "1997-09-11%20Coast.mp3",
      "",
    ]) {
      expect(looksLikeFileName(s), s).toBe(true);
    }
  });

  it("passes every catalog title", () => {
    expect(catalog.filter((r) => looksLikeFileName(r.title)).map((r) => r.title)).toEqual([]);
  });
});

describe("episodeTitle", () => {
  it("is the row's own title for every catalog row, unchanged", () => {
    expect(catalog.filter((r) => episodeTitle(r) !== r.title).map((r) => r.title)).toEqual([]);
  });

  it("never returns a file name: a title that is one, or a missing title, gives the name made readable", () => {
    const fileName = "2015-12-08 - Art Bell MITD - Dr David Jacobs Alien Experimentation on Humans.mp3";
    for (const ep of [
      { title: fileName, fileName },
      { title: undefined, fileName },
      { title: "", fileName },
      { title: "Some_Show_Name", fileName: "Some_Show_Name.mp3" },
      { title: null, fileName: "a_b%20c.ogg" },
    ]) {
      const t = episodeTitle(ep);
      expect(looksLikeFileName(t), `${JSON.stringify(ep)} → ${t}`).toBe(false);
    }
    expect(episodeTitle({ fileName })).toBe("2015-12-08 - Art Bell MITD - Dr David Jacobs Alien Experimentation on Humans");
    expect(episodeTitle({})).toBe(UNTITLED);
  });
});

describe("keyTitle (an id from the stats API)", () => {
  const row = catalog.find((r) => r.fileName.startsWith("2015-12-08 - Art Bell MITD"))!;
  const key = communityKey(row)!;

  it("the screenshot's key is that row's", () => {
    expect(key).toBe(SCREENSHOT_KEY);
  });

  it("uses the local row, then the catalog title, and is never the key", () => {
    expect(keyTitle(row, key)).toBe(row.title);
    expect(keyTitle(undefined, key, row.title)).toBe("Midnight in the Desert - Alien Experimentation on Humans");
    const bare = keyTitle(undefined, key, null);
    expect(bare).not.toContain("_");
    expect(bare).not.toContain(row.archiveIdentifier!);
    expect(looksLikeFileName(bare)).toBe(false);
    // A catalog title that is itself a file name is passed over.
    expect(looksLikeFileName(keyTitle(undefined, key, row.fileName))).toBe(false);
  });
});

describe("no surface spells its own title fallback", () => {
  // Identity, not display: dedupKey groups rows by what they are called, and
  // its key must not move with how a name is shown.
  const ALLOWED = new Set([path.join("src", "db", "deduplicate.ts"), path.join("src", "lib", "library", "display-title.ts")]);
  const FALLBACK = /\btitle\s*(\|\||\?\?)\s*[\w$.?]*fileName|\btitle\s*(\|\||\?\?)\s*[\w$.?]*episodeId/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== "__tests__") walk(p, out);
      } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("every title || fileName / title ?? id in src/ goes through display-title.ts", () => {
    const offenders = walk("src")
      .filter((f) => !ALLOWED.has(f))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => ({ f, i: i + 1, line }))
          .filter(({ line }) => FALLBACK.test(line)),
      )
      .map(({ f, i, line }) => `${f}:${i}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
