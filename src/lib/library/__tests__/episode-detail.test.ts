import { describe, it, expect } from "vitest";
import type { Episode } from "@/db/schema";
import {
  archiveDetailsUrl,
  draftFromEpisode,
  draftToFields,
  formatPlayStats,
  playbackProgress,
  shareText,
  shareUrl,
  sortSeriesParts,
} from "@/lib/library/episode-detail";

function ep(fields: Partial<Episode> = {}): Episode {
  return { id: 1, fileHash: "archive:c:a.mp3", fileName: "a.mp3", ...fields } as Episode;
}

describe("edit draft", () => {
  it("round-trips an episode's fields", () => {
    const e = ep({ title: "T", guestName: "G", airDate: "1997-03-13", topic: "X", showType: "coast", aiSummary: "S", aiCategory: "C", aiSeries: "R" });
    expect(draftToFields(draftFromEpisode(e))).toEqual({
      title: "T", guestName: "G", airDate: "1997-03-13", topic: "X", showType: "coast", aiSummary: "S", aiCategory: "C", aiSeries: "R",
    });
  });

  it("starts absent fields empty and an unknown show type as unknown", () => {
    const d = draftFromEpisode(ep());
    expect(d.title).toBe("");
    expect(d.showType).toBe("unknown");
  });

  it("turns an emptied field into undefined, which clears it", () => {
    const d = { ...draftFromEpisode(ep({ title: "Old", guestName: "Old" })), title: "", guestName: "" };
    const f = draftToFields(d);
    expect(f.title).toBeUndefined();
    expect(f.guestName).toBeUndefined();
    expect("title" in f).toBe(true);
  });
});

describe("formatPlayStats", () => {
  const NOW = new Date(2026, 8, 21, 12).getTime();
  const DAY = 86_400_000;

  it("is empty for an unplayed episode", () => {
    expect(formatPlayStats(ep(), NOW)).toBe("");
  });

  it("reads count, recency and progress", () => {
    expect(formatPlayStats(ep({ playCount: 3, lastPlayedAt: NOW - DAY, duration: 100, playbackPosition: 42 }), NOW))
      .toBe("Played 3x · yesterday · 42% heard");
    expect(formatPlayStats(ep({ playCount: 1, lastPlayedAt: NOW - 1000 }), NOW)).toBe("Played 1x · today");
    expect(formatPlayStats(ep({ playCount: 1, lastPlayedAt: NOW - 3 * DAY }), NOW)).toBe("Played 1x · 3d ago");
  });

  it("says completed at the end", () => {
    expect(formatPlayStats(ep({ playCount: 1, duration: 100, playbackPosition: 100 }), NOW)).toBe("Played 1x · completed");
  });
});

describe("playbackProgress", () => {
  it("is null without a position or a duration", () => {
    expect(playbackProgress(ep({ duration: 100 }))).toBeNull();
    expect(playbackProgress(ep({ playbackPosition: 10 }))).toBeNull();
    expect(playbackProgress(ep({ playbackPosition: 10, duration: 0 }))).toBeNull();
  });

  it("caps at 100% and marks past 90% as nearly done", () => {
    expect(playbackProgress(ep({ playbackPosition: 50, duration: 100 }))).toEqual({ percent: 50, nearlyDone: false });
    expect(playbackProgress(ep({ playbackPosition: 95, duration: 100 }))).toEqual({ percent: 95, nearlyDone: true });
    expect(playbackProgress(ep({ playbackPosition: 120, duration: 100 }))!.percent).toBe(100);
  });
});

describe("sortSeriesParts", () => {
  it("orders by part, unnumbered last, ties by air date", () => {
    const parts = [
      ep({ id: 1, aiSeriesPart: undefined, airDate: "1990-01-01" }),
      ep({ id: 2, aiSeriesPart: 2, airDate: "1990-01-02" }),
      ep({ id: 3, aiSeriesPart: 1, airDate: "1999-01-01" }),
      ep({ id: 4, aiSeriesPart: 2, airDate: "1990-01-01" }),
    ];
    expect(sortSeriesParts(parts).map((e) => e.id)).toEqual([3, 4, 2, 1]);
    expect(parts.map((e) => e.id)).toEqual([1, 2, 3, 4]); // input untouched
  });
});

describe("links", () => {
  it("shares by community key, which resolves in anyone's browser", () => {
    const e = ep({ id: 77, archiveIdentifier: "coll", fileName: "1997 Show.mp3" });
    expect(shareUrl("https://highdesert.space", e)).toBe("https://highdesert.space/library?ep=coll--1997_Show");
    expect(shareUrl("https://highdesert.space", ep())).toBe("https://highdesert.space/library");
  });

  it("builds the share text and archive link", () => {
    const e = ep({ title: "Area 51", guestName: "Bob Lazar", airDate: "1989-11-11", archiveIdentifier: "coll" });
    expect(shareText(e)).toBe("🎙️ Area 51 — Art Bell with Bob Lazar (1989-11-11) — Listen on High Desert");
    expect(archiveDetailsUrl(e)).toBe("https://archive.org/details/coll/a.mp3");
    expect(archiveDetailsUrl(ep())).toBeNull();
  });
});
