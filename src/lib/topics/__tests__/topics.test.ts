// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assignTopicSlugs, TOPIC_SLUG_PATTERN } from "../../../../scripts/lib/topic-slugs.mjs";
import { rewrittenSlugs } from "../../../../scripts/lib/show-slugs.mjs";
import { readCatalogFiles } from "@/lib/shows/load";
import { buildShowCatalog } from "@/lib/shows/catalog";
import {
  candidateTags,
  deriveTopics,
  GENERIC_TAGS,
  NO_TOPIC_CATEGORIES,
  SUBJECTS,
  TAG_COVERED_BY_CATEGORY,
  TAG_MIN,
  TAG_NAMES,
  TOPIC_MIN,
  matchText,
  type TopicRow,
} from "@/lib/topics/rules";
import { buildTopicCatalog, guestTopics, relatedTopics, topicsOfShow, SHOW_TOPICS_MAX } from "@/lib/topics/catalog";
import { topicJsonLd, breadcrumbJsonLd, topicCrumbs } from "@/lib/shows/jsonld";
import { validateJsonLd } from "../../../../scripts/lib/jsonld-check.mjs";

/**
 * Topic pages (docs/show-pages.md, "Topic pages"): which topics the rule
 * makes, from the real catalog, and the add-only slug map. A topic URL is
 * shared and indexed like a show's, so a committed slug never changes.
 */

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const MAP_FILE = "data/topic-slugs.json";
const { rows, slugs: showSlugs } = readCatalogFiles(ROOT);
const catalog = buildShowCatalog(rows, showSlugs);
const topicRows = catalog.shows.map((s) => s.row) as TopicRow[];
const topicSlugs = JSON.parse(readFileSync(path.join(ROOT, MAP_FILE), "utf8")) as Record<string, string>;
const defs = deriveTopics(topicRows);
const tc = buildTopicCatalog(catalog, topicSlugs);
const DASH = "—";

describe("the topic rule over the real catalog", () => {
  it("makes a topic of every category but Other", () => {
    const categories = new Set(topicRows.map((r) => r.aiCategory).filter(Boolean) as string[]);
    for (const c of categories) {
      const has = defs.some((d) => d.id === `category:${c}`);
      expect(has, c).toBe(!NO_TOPIC_CATEGORIES.has(c));
    }
  });

  it("names every tag the rule wants a page for: a new tag past the threshold is a decision, not a default", () => {
    // Fails when a tag crosses TAG_MIN: add it to TAG_NAMES (a subject) or GENERIC_TAGS (not one).
    expect(candidateTags(topicRows).filter((t) => !TAG_NAMES[t])).toEqual([]);
  });

  it("gives no page to a generic tag, a tag a category covers, or one under the threshold", () => {
    const tags = new Set(defs.filter((d) => d.kind === "tag").map((d) => d.id.slice(4)));
    for (const g of GENERIC_TAGS) expect(tags.has(g), g).toBe(false);
    for (const c of Object.keys(TAG_COVERED_BY_CATEGORY)) expect(tags.has(c), c).toBe(false);
    for (const d of defs.filter((x) => x.kind === "tag")) expect(d.fileHashes.length, d.id).toBeGreaterThanOrEqual(TAG_MIN);
  });

  it("lists at least TOPIC_MIN shows on every topic, each one a show with a page", () => {
    for (const d of defs) {
      expect(d.fileHashes.length, d.id).toBeGreaterThanOrEqual(TOPIC_MIN);
      for (const h of d.fileHashes) expect(catalog.byHash.has(h), `${d.id}: ${h}`).toBe(true);
    }
  });

  it("finds the famous subjects by phrase, beyond what their tag found", () => {
    const mel = defs.find((d) => d.id === "subject:mels-hole")!;
    const titles = mel.fileHashes.map((h) => catalog.byHash.get(h)!.row.title);
    expect(titles).toContain("Coast to Coast AM - Mel's Hole Update");
    expect(titles).toContain("Coast to Coast AM - Contact and Disclosure with Dr. Steven Greer, Mel Waters First Appearance");
    const tagged = topicRows.filter((r) => r.aiTags?.includes("mels hole")).length;
    expect(mel.fileHashes.length).toBeGreaterThan(tagged);
    const area51 = defs.find((d) => d.id === "subject:area-51")!;
    expect(area51.fileHashes.map((h) => catalog.byHash.get(h)!.slug)).toContain("1992-12-12-area-51-john-lear-bob-lazar");
  });

  it("a subject replaces the tags it covers", () => {
    const tagIds = new Set(defs.filter((d) => d.kind === "tag").map((d) => d.id.slice(4)));
    for (const s of SUBJECTS) for (const t of s.tags ?? []) expect(tagIds.has(t), `${s.key} covers ${t}`).toBe(false);
  });

  it("matches a subject's phrase in the title, topic, guest, summary or tags", () => {
    const row = (r: Partial<TopicRow>) => matchText({ fileHash: "x", ...r });
    const mel = SUBJECTS.find((s) => s.key === "mels-hole")!.pattern;
    expect(mel.test(row({ title: "Coast to Coast AM - Mel's Hole Returns" }))).toBe(true);
    expect(mel.test(row({ aiSummary: "Callers ask about Mel Waters." }))).toBe(true);
    expect(mel.test(row({ aiTags: ["mels hole"] }))).toBe(true);
    expect(mel.test(row({ title: "Coast to Coast AM - Holes in Space" }))).toBe(false);
  });

  it("no topic's name or first line has an em dash", () => {
    for (const d of defs) {
      expect(d.name.includes(DASH), d.id).toBe(false);
      expect(d.intro.includes(DASH), d.id).toBe(false);
    }
  });
});

describe("data/topic-slugs.json", () => {
  it("has a slug for every topic, every one its own, all lowercase words", () => {
    for (const d of defs) expect(topicSlugs[d.id], d.id).toMatch(TOPIC_SLUG_PATTERN);
    const values = Object.values(topicSlugs);
    expect(new Set(values).size).toBe(values.length);
    expect(tc.topics).toHaveLength(defs.length);
  });

  it("is complete: the generator would add nothing", () => {
    expect(assignTopicSlugs(topicSlugs, defs).added).toEqual([]);
  });

  it("never rewrites a committed slug (every version git has, against this one)", () => {
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
      expect(rewrittenSlugs(before, topicSlugs), `rewritten since ${c.slice(0, 7)}`).toEqual([]);
      compared++;
    }
    if (commits.length) expect(compared).toBeGreaterThan(0);
  });
});

describe("assignTopicSlugs (add-only)", () => {
  it("keeps a slug when the topic is renamed, suffixes a collision, drops a leading article", () => {
    const existing = { "subject:a": "phoenix-lights" };
    const { map, added } = assignTopicSlugs(existing, [
      { id: "subject:a", name: "The Lights Over Phoenix" },
      { id: "subject:b", name: "The Phoenix Lights" },
      { id: "tag:mars", name: "Mars" },
    ]);
    expect(map["subject:a"]).toBe("phoenix-lights");
    expect(map["subject:b"]).toBe("phoenix-lights-2");
    expect(map["tag:mars"]).toBe("mars");
    expect(added).toEqual(["subject:b", "tag:mars"]);
    expect(rewrittenSlugs(existing, map)).toEqual([]);
  });

  it("never reuses a retired topic's slug", () => {
    const { map } = assignTopicSlugs({ "tag:gone": "mars" }, [{ id: "tag:mars", name: "Mars" }]);
    expect(map["tag:mars"]).toBe("mars-2");
  });
});

describe("the topic catalog", () => {
  it("lists a topic's shows newest first", () => {
    for (const t of tc.topics) {
      const dates = t.shows.map((s) => s.row.airDate ?? "");
      expect(dates, t.slug).toEqual([...dates].sort().reverse());
    }
  });

  it("names a show's topics most specific first, bounded, each one listing that show", () => {
    const area51 = catalog.bySlug.get("1992-12-12-area-51-john-lear-bob-lazar")!;
    const topics = topicsOfShow(area51, tc);
    expect(topics.length).toBeGreaterThan(0);
    expect(topics.length).toBeLessThanOrEqual(SHOW_TOPICS_MAX);
    expect(topics[0].slug).toBe("area-51");
    const kinds = topics.map((t) => t.kind);
    expect(kinds.indexOf("category") === -1 || kinds.lastIndexOf("subject") < kinds.indexOf("category")).toBe(true);
    for (const t of topics) expect(t.shows).toContain(area51);
  });

  it("offers related topics that share at least two shows, never itself", () => {
    for (const t of tc.topics) {
      const mine = new Set(t.shows.map((s) => s.slug));
      for (const r of relatedTopics(t, tc)) {
        expect(r.slug).not.toBe(t.slug);
        expect(r.shows.filter((s) => mine.has(s.slug)).length, `${t.slug} -> ${r.slug}`).toBeGreaterThanOrEqual(2);
      }
    }
    expect(relatedTopics(tc.bySlug.get("mels-hole")!, tc).length).toBeGreaterThan(0);
  });

  it("gives a guest the topics most of their shows fall under", () => {
    const dames = [...catalog.guests.values()].find((g) => /Ed Dames/.test(g.name))!;
    expect(guestTopics(dames.shows, tc)[0].slug).toBe("remote-viewing");
  });

  it("has valid structured data on every topic page", () => {
    for (const t of tc.topics) {
      expect(validateJsonLd(topicJsonLd(t)), t.slug).toEqual([]);
      expect(validateJsonLd(breadcrumbJsonLd(topicCrumbs(t))), t.slug).toEqual([]);
    }
  });
});
