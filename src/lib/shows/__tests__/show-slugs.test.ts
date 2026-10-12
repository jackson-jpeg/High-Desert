// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assignSlugs, rewrittenSlugs, showSlugBase } from "../../../../scripts/lib/show-slugs.mjs";
import { SHOW_SLUG_PATTERN, slugify, guestSlug } from "@/lib/shows/slugify";
import type { CatalogRow } from "@/lib/shows/describe";

/**
 * Show slugs are URLs Google indexes and people share, so they are minted once
 * and never change (docs/show-pages.md). The committed map must cover every
 * catalog show, uniquely, and no committed slug may ever be rewritten.
 */

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const MAP_FILE = "data/show-slugs.json";
const rows = JSON.parse(readFileSync(path.join(ROOT, "public/seed/library.json"), "utf8")) as CatalogRow[];
const slugs = JSON.parse(readFileSync(path.join(ROOT, MAP_FILE), "utf8")) as Record<string, string>;

describe("data/show-slugs.json", () => {
  it("has a slug for every catalog show", () => {
    const missing = rows.filter((r) => !slugs[r.fileHash]).map((r) => r.fileHash);
    expect(missing).toEqual([]);
    expect(rows.length).toBeGreaterThan(1000);
  });

  it("gives every show its own slug", () => {
    const values = Object.values(slugs);
    expect(new Set(values).size).toBe(values.length);
  });

  it("every slug is the air date, then lowercase words", () => {
    for (const [hash, slug] of Object.entries(slugs)) {
      expect(slug, hash).toMatch(SHOW_SLUG_PATTERN);
    }
    for (const r of rows) expect(slugs[r.fileHash].startsWith(`${r.airDate}-`), r.fileHash).toBe(true);
  });

  it("is complete: the generator would add nothing", () => {
    expect(assignSlugs(slugs, rows).added).toEqual([]);
  });

  it("never rewrites a committed slug (every version git has, against this one)", () => {
    // Locally this walks the file's whole history; in CI's shallow clone only
    // HEAD is present, so the check there is the working tree against HEAD.
    const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    let commits: string[] = [];
    try {
      commits = git("log", "--format=%H", "--", MAP_FILE).split("\n").filter(Boolean);
    } catch {
      commits = [];
    }
    let compared = 0;
    for (const c of commits) {
      let before: Record<string, string>;
      try {
        before = JSON.parse(git("show", `${c}:${MAP_FILE}`));
      } catch {
        continue;
      }
      expect(rewrittenSlugs(before, slugs), `rewritten since ${c.slice(0, 7)}`).toEqual([]);
      compared++;
    }
    // Before the map's first commit there is nothing to hold it to.
    if (commits.length) expect(compared).toBeGreaterThan(0);
  });
});

describe("showSlugBase", () => {
  const base = (r: Partial<CatalogRow>) =>
    showSlugBase({ fileHash: "archive:x:y.mp3", fileName: "y.mp3", airDate: "1997-03-13", ...r } as CatalogRow);

  it("is the date, the subject without the programme's name, then the guest", () => {
    expect(base({ title: "Coast to Coast AM - Area 51", guestName: "John Lear and Bob Lazar", airDate: "1992-12-12" })).toBe(
      "1992-12-12-area-51-john-lear-bob-lazar",
    );
    expect(base({ title: "Dreamland - Crop Circles", guestName: "Colin Andrews" })).toBe("1997-03-13-crop-circles-colin-andrews");
  });

  it("names a guest once when the subject already does", () => {
    expect(base({ title: "Coast to Coast AM - Richard C. Hoagland", guestName: "Richard C. Hoagland" })).toBe(
      "1997-03-13-richard-c-hoagland",
    );
  });

  it("leaves out a guest field that only repeats the title", () => {
    expect(base({ title: "Coast to Coast AM - Open Lines", guestName: "Open Lines" })).toBe("1997-03-13-open-lines");
  });

  it("cuts long ones at a word, never leaving a dangling 'on'", () => {
    const slug = base({
      title: "Coast to Coast AM - Dannion Brinkley on Near Death Experiences, Linda Moulton Howe on Animal Mutilations",
    });
    expect(slug.length).toBeLessThanOrEqual(11 + 72);
    expect(slug).not.toMatch(/-(on|of|the)$/);
    expect(slug).toMatch(SHOW_SLUG_PATTERN);
  });

  it("never yields an empty slug", () => {
    expect(base({ title: "Coast to Coast AM - !!!" })).toBe("1997-03-13-show");
    expect(base({ title: "???", fileName: "???.mp3" })).toBe("1997-03-13-show");
  });
});

describe("assignSlugs (add-only)", () => {
  const row = (hash: string, title: string, airDate = "1999-01-01") =>
    ({ fileHash: hash, fileName: `${hash}.mp3`, title, airDate }) as CatalogRow;

  it("keeps an existing slug even when the show's title changes", () => {
    const existing = { a: "1999-01-01-old-title" };
    const { map, added } = assignSlugs(existing, [row("a", "Coast to Coast AM - New Title")]);
    expect(map.a).toBe("1999-01-01-old-title");
    expect(added).toEqual([]);
    expect(rewrittenSlugs(existing, map)).toEqual([]);
  });

  it("gives a newcomer that collides a suffix, and never reuses a retired slug", () => {
    const existing = { gone: "1999-01-01-ghosts" };
    const { map, added } = assignSlugs(existing, [row("b", "Coast to Coast AM - Ghosts"), row("c", "Dreamland - Ghosts")]);
    expect(map.gone).toBe("1999-01-01-ghosts");
    expect(map.b).toBe("1999-01-01-ghosts-2");
    expect(map.c).toBe("1999-01-01-ghosts-3");
    expect(added).toEqual(["b", "c"]);
  });

  it("rewrittenSlugs sees a change and a removal", () => {
    expect(rewrittenSlugs({ a: "x", b: "y" }, { a: "x2" })).toEqual(["a", "b"]);
  });
});

describe("slugify and guestSlug", () => {
  it("folds accents, joins apostrophes, drops 'and'", () => {
    expect(slugify("Erich von Däniken & Art's Friends")).toBe("erich-von-daniken-arts-friends");
  });

  it("drops a joining word a cut leaves at the end", () => {
    expect(slugify("alpha beta on gamma", 13)).toBe("alpha-beta");
    expect(slugify("tales of the desert", 12)).toBe("tales");
    expect(slugify("on the air")).toBe("on-the-air");
  });

  it("gives one guest one slug whatever the honorific", () => {
    expect(guestSlug("Dr. Roger Leir")).toBe("roger-leir");
    expect(guestSlug("Roger Leir")).toBe("roger-leir");
  });
});
