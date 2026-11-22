import { describe, it, expect } from "vitest";
import { readCatalogFiles } from "@/lib/shows/load";
import { buildShowCatalog } from "@/lib/shows/catalog";
import { buildTopicCatalog } from "@/lib/topics/catalog";
import { readTopicSlugs } from "@/lib/topics/load";
import { guestPeople, personKey } from "@/lib/shows/people";
import { nextShow } from "@/lib/shows/next";

/**
 * A show page's next show (src/lib/shows/next.ts), on the real catalog:
 * the same guest first (their next appearance), else the same topic.
 */

const { rows, slugs } = readCatalogFiles();
const catalog = buildShowCatalog(rows, slugs);
const topics = buildTopicCatalog(catalog, readTopicSlugs());
const all = [...catalog.bySlug.values()];
const topicsOf = (slug: string) => topics.byShow.get(slug) ?? [];
const sharesGuest = (a: (typeof all)[number], b: (typeof all)[number]) => {
  const keys = new Set(guestPeople(a.row).map(personKey));
  return guestPeople(b.row).some((p) => keys.has(personKey(p)));
};

describe("nextShow", () => {
  it("Area 51 (John Lear and Bob Lazar) goes to John Lear's next show after 1992-12-12", () => {
    const area51 = catalog.bySlug.get("1992-12-12-area-51-john-lear-bob-lazar")!;
    const next = nextShow(area51, catalog, topicsOf(area51.slug))!;
    expect(next.reason).toBe("guest");
    expect(next.guest).toBe("John Lear");
    expect(next.show.row.airDate! > area51.row.airDate!).toBe(true);
    // The nearest one: no John Lear show aired between them.
    const lear = catalog.byPerson.get(personKey("John Lear"))!;
    const between = lear.filter((s) => s.row.airDate! > area51.row.airDate! && s.row.airDate! < next.show.row.airDate!);
    expect(between).toEqual([]);
  });

  it("a guest with shows before and after this one goes to the nearest after, never back to the earliest", () => {
    // Area 51 alone cannot tell the two apart: John Lear's earliest other
    // show is also his next one after 1992-12-12.
    let middles = 0;
    for (const show of all) {
      const next = nextShow(show, catalog, topicsOf(show.slug));
      if (next?.reason !== "guest") continue;
      const theirs = (catalog.byPerson.get(personKey(next.guest!)) ?? []).filter((s) => s.slug !== show.slug);
      // Air order, then slug: a night's second file (same date) comes after its first.
      const key = (s: typeof show) => `${s.row.airDate ?? ""} ${s.slug}`;
      const here = key(show);
      const before = theirs.some((s) => key(s) < here);
      const after = theirs.filter((s) => key(s) > here);
      if (!before || !after.length) continue;
      middles++;
      const nearest = after.map(key).sort()[0];
      expect(key(next.show), show.slug).toBe(nearest);
    }
    expect(middles).toBeGreaterThan(10);
  });

  it("a guest's last show goes back to their earliest", () => {
    const lear = [...catalog.byPerson.get(personKey("John Lear"))!].sort((a, b) =>
      (a.row.airDate ?? "").localeCompare(b.row.airDate ?? ""),
    );
    const last = lear[lear.length - 1];
    const next = nextShow(last, catalog, topicsOf(last.slug))!;
    expect(next.reason).toBe("guest");
    expect(next.show.slug).toBe(lear[0].slug);
  });

  it("for every show: never itself, always a show with a page, guest first, else a topic it shares", () => {
    let guest = 0;
    let topic = 0;
    for (const show of all) {
      const next = nextShow(show, catalog, topicsOf(show.slug));
      const anotherGuestShow = guestPeople(show.row).some((p) =>
        (catalog.byPerson.get(personKey(p)) ?? []).some((s) => s.slug !== show.slug),
      );
      if (!next) {
        expect(anotherGuestShow, show.slug).toBe(false);
        expect(topicsOf(show.slug).some((t) => t.shows.some((s) => s.slug !== show.slug)), show.slug).toBe(false);
        continue;
      }
      expect(next.show.slug, show.slug).not.toBe(show.slug);
      expect(catalog.bySlug.get(next.show.slug), show.slug).toBe(next.show);
      if (anotherGuestShow) {
        expect(next.reason, show.slug).toBe("guest");
        expect(sharesGuest(show, next.show), show.slug).toBe(true);
        guest++;
      } else {
        expect(next.reason, show.slug).toBe("topic");
        expect(next.topic!.shows.some((s) => s.slug === next.show.slug), show.slug).toBe(true);
        expect(next.topic, show.slug).toBe(topicsOf(show.slug)[0]);
        topic++;
      }
    }
    // Not vacuous: both rules carry real weight on this catalog.
    expect(guest).toBeGreaterThan(100);
    expect(topic).toBeGreaterThan(100);
  }, 30_000);

  it("a topic pick is the nearest show after this one on that topic", () => {
    const show = all.find((s) => {
      const n = nextShow(s, catalog, topicsOf(s.slug));
      return n?.reason === "topic" && n.show.row.airDate! > s.row.airDate!;
    })!;
    const next = nextShow(show, catalog, topicsOf(show.slug))!;
    const between = next.topic!.shows.filter(
      (s) => s.slug !== show.slug && s.row.airDate! > show.row.airDate! && s.row.airDate! < next.show.row.airDate!,
    );
    expect(between).toEqual([]);
  });

  it("control: with no topics given, a show with no other guest show has no next", () => {
    const loner = all.find((s) => nextShow(s, catalog, topicsOf(s.slug))?.reason === "topic")!;
    expect(nextShow(loner, catalog, topicsOf(loner.slug))).not.toBeNull();
    expect(nextShow(loner, catalog, [])).toBeNull();
  });
});
