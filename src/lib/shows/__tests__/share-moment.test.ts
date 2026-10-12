import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { Episode } from "@/db/schema";
import {
  momentLabel,
  momentShareText,
  parseMomentSeconds,
  showKeyShareUrl,
  showShareUrl,
  validMoment,
} from "@/lib/shows/share";
import { libraryIntentHref, parseLibraryIntent } from "@/lib/library/intents";
import { peekRequestedStart, requestStartAt, resetRequestedStartForTests, takeRequestedStart } from "@/audio/requested-start";
import { shareHref } from "@/components/library/EpisodeShareButton";
import { forgetShowSlugsForTests, lookupShowSlug } from "@/hooks/useShowSlug";
import { shareLink } from "@/components/share/share-link";
import { startMoment } from "@/hooks/library/useLibraryIntents";
import { onHdEvent } from "@/lib/events";
import { useToastStore } from "@/stores/toast-store";
import { proxy } from "@/proxy";
import nextConfig from "../../../../next.config";

/**
 * Sharing a show and a moment of it (docs/show-pages.md, "Sharing"): the
 * links, the library intent that carries `t`, the one-shot requested start,
 * the slug lookup, the share sheet's fallbacks and the moment's one address.
 * The real playEpisode starting there is src/hooks/__tests__/requested-start-play.test.ts.
 */

const ORIGIN = "https://highdesert.space";
const KEY = "ultimate-art-bell-collection--1992-12-12_Area_51";

describe("moment seconds", () => {
  it("takes 1 to 5 digits and nothing else; a typo is no moment, never an error", () => {
    expect(parseMomentSeconds("5025")).toBe(5025);
    expect(parseMomentSeconds("0")).toBe(0);
    for (const bad of [null, undefined, "", "1h", "-5", "5.5", "123456", " 5", "0x10"]) expect(parseMomentSeconds(bad), String(bad)).toBeNull();
  });

  it("is inside the show, or not a moment", () => {
    expect(validMoment(5025, 10_800)).toBe(5025);
    expect(validMoment(10_800, 10_800)).toBeNull();
    expect(validMoment(10_799, 10_800.4)).toBe(10_799);
    expect(validMoment(500, undefined)).toBe(500);
    expect(validMoment(null, 10_800)).toBeNull();
  });

  it("is said the way the player says time, with no em dash", () => {
    expect(momentLabel(5025)).toBe("1:23:45");
    expect(momentLabel(245)).toBe("4:05");
    expect(momentLabel(0)).toBe("0:00");
    expect(momentShareText("Area 51", 5025)).toBe("Area 51, from 1:23:45. Listen on High Desert");
    expect(momentShareText("Area 51", 5025)).not.toContain("—");
  });
});

describe("share links", () => {
  it("a show shares its page; a moment adds whole seconds", () => {
    expect(showShareUrl(ORIGIN, "1992-12-12-area-51")).toBe(`${ORIGIN}/show/1992-12-12-area-51`);
    expect(showShareUrl(ORIGIN, "1992-12-12-area-51", 5025.9)).toBe(`${ORIGIN}/show/1992-12-12-area-51?t=5025`);
    expect(showKeyShareUrl(ORIGIN, KEY, 12)).toBe(`${ORIGIN}/show/key/${encodeURIComponent(KEY)}?t=12`);
  });

  it("the Share button sends the show page once the slug is known, the old ?ep= link until then", () => {
    const ep = { fileName: "1992-12-12_Area_51.mp3", archiveIdentifier: "ultimate-art-bell-collection" } as Episode;
    expect(shareHref(ORIGIN, ep, "1992-12-12-area-51")).toBe(`${ORIGIN}/show/1992-12-12-area-51`);
    expect(shareHref(ORIGIN, ep, undefined)).toMatch(/\/library\?ep=/);
    expect(shareHref(ORIGIN, ep, null)).toMatch(/\/library\?ep=/);
  });
});

describe("the library intent carries t, only with a show", () => {
  it("parses t beside show and writes it back", () => {
    const intent = parseLibraryIntent(new URLSearchParams(`show=${KEY}&t=5025`));
    expect(intent).toEqual({ show: KEY, t: 5025 });
    expect(parseLibraryIntent(new URLSearchParams(libraryIntentHref(intent).split("?")[1]))).toEqual(intent);
  });

  it("ignores t on its own, and a t that is not whole seconds", () => {
    expect(parseLibraryIntent(new URLSearchParams("t=5025"))).toEqual({});
    expect(parseLibraryIntent(new URLSearchParams(`show=${KEY}&t=1h`))).toEqual({ show: KEY });
    expect(libraryIntentHref({ t: 5 })).toBe("/library");
  });
});

describe("requested start", () => {
  beforeEach(() => resetRequestedStartForTests());

  it("is taken once, by its own show", () => {
    requestStartAt("a", 90.7);
    expect(takeRequestedStart({ fileHash: "b" })).toBeNull();
    expect(takeRequestedStart({ fileHash: "a", duration: 100 })).toBe(90);
    expect(takeRequestedStart({ fileHash: "a", duration: 100 })).toBeNull();
  });

  it("drops a start at or past the end, and refuses nonsense", () => {
    requestStartAt("a", 100);
    expect(takeRequestedStart({ fileHash: "a", duration: 100 })).toBeNull();
    requestStartAt("a", -1);
    requestStartAt("", 5);
    expect(peekRequestedStart()).toBeNull();
  });
});

describe("startMoment (Open in High Desert from a moment)", () => {
  const ep = { id: 1, fileHash: "archive:x:1.mp3", fileName: "1.mp3", title: "One" } as Episode;
  let played: Episode[];
  let off: () => void;
  const setActivation = (isActive: boolean | undefined) =>
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      get: () => (isActive === undefined ? undefined : { isActive, hasBeenActive: isActive }),
    });

  beforeEach(() => {
    resetRequestedStartForTests();
    useToastStore.setState({ toasts: [] });
    played = [];
    off = onHdEvent("play-episode", (e) => played.push(e as Episode));
  });
  afterEach(() => {
    off();
    setActivation(undefined);
  });

  it("plays at once while the tap that brought the listener still counts", () => {
    setActivation(true);
    startMoment(ep, 300);
    expect(played).toEqual([ep]);
    expect(peekRequestedStart()).toEqual({ fileHash: ep.fileHash, at: 300 });
  });

  it("without a live gesture, starts nothing and says press play; the ▶ then starts there", () => {
    setActivation(false);
    startMoment(ep, 5025);
    expect(played).toEqual([]);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["Press play to start at 1:23:45."]);
    expect(peekRequestedStart()).toEqual({ fileHash: ep.fileHash, at: 5025 });
  });

  it("where the browser cannot say, it is treated as permitted", () => {
    setActivation(undefined);
    startMoment(ep, 1);
    expect(played).toEqual([ep]);
  });
});

describe("lookupShowSlug", () => {
  beforeEach(() => forgetShowSlugsForTests());

  it("asks once per show; a 404 is an answer, a failure is asked again", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ slug: "s1", path: "/show/s1" }), { status: 200 }));
    expect(await lookupShowSlug("k1", ok as unknown as typeof fetch)).toBe("s1");
    expect(await lookupShowSlug("k1", ok as unknown as typeof fetch)).toBe("s1");
    expect(ok).toHaveBeenCalledTimes(1);
    expect(String((ok.mock.calls[0] as unknown[])[0])).toBe("/api/shows/link?key=k1");

    const missing = vi.fn(async () => new Response("{}", { status: 404 }));
    expect(await lookupShowSlug("k2", missing as unknown as typeof fetch)).toBeNull();
    expect(await lookupShowSlug("k2", missing as unknown as typeof fetch)).toBeNull();
    expect(missing).toHaveBeenCalledTimes(1);

    const broken = vi.fn(async () => new Response("", { status: 503 }));
    await lookupShowSlug("k3", broken as unknown as typeof fetch);
    await lookupShowSlug("k3", broken as unknown as typeof fetch);
    expect(broken).toHaveBeenCalledTimes(2);
  });
});

describe("shareLink", () => {
  const link = { title: "T", text: "x", url: `${ORIGIN}/show/s?t=5` };
  const set = (share: unknown, writeText: unknown) => {
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: writeText ? { writeText } : undefined });
  };
  beforeEach(() => useToastStore.setState({ toasts: [] }));
  afterEach(() => set(undefined, undefined));

  it("hands the link to the share sheet where there is one", async () => {
    const share = vi.fn(async () => {});
    set(share, vi.fn());
    expect(await shareLink(link)).toBe("shared");
    expect(share).toHaveBeenCalledWith(link);
  });

  it("closing the sheet is not a failure: nothing is copied", async () => {
    const writeText = vi.fn(async () => {});
    set(vi.fn(async () => Promise.reject(new DOMException("x", "AbortError"))), writeText);
    expect(await shareLink(link)).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies where there is no sheet, or it refused; shows the link where it cannot copy", async () => {
    const writeText = vi.fn(async () => {});
    set(undefined, writeText);
    expect(await shareLink(link, "Link copied: starts at 0:05")).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(link.url);
    set(vi.fn(async () => Promise.reject(new DOMException("x", "NotAllowedError"))), writeText);
    expect(await shareLink(link)).toBe("copied");
    set(undefined, vi.fn(async () => Promise.reject(new Error("denied"))));
    expect(await shareLink(link)).toBe("shown");
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(link.url);
  });
});

describe("a moment has one address", () => {
  it("the page it is rewritten to redirects to /show/<slug>?t=", () => {
    for (const from of ["/show/x/moment/5025", "/win98/show/x/moment/5025", "/night/show/x/moment/5025/"]) {
      const res = proxy(new NextRequest(`${ORIGIN}${from}`));
      expect(res.status, from).toBe(308);
      expect(res.headers.get("location"), from).toBe(`${ORIGIN}/show/x?t=5025`);
    }
  });

  it("next.config rewrites ?t= to the moment page before the look rewrite, night first", async () => {
    const rw = (await nextConfig.rewrites!()) as unknown as {
      beforeFiles: { source: string; has?: { type: string; key: string; value?: string }[]; destination: string }[];
    };
    const [night, win98] = rw.beforeFiles;
    expect(night.destination).toBe("/night/show/:slug/moment/:t");
    expect(night.has?.map((h) => h.key)).toEqual(["hd_look", "t"]);
    expect(win98.destination).toBe("/win98/show/:slug/moment/:t");
    const t = win98.has!.find((h) => h.key === "t")!.value!;
    const re = new RegExp(`^${t.replace("(?<t>", "(")}$`);
    expect(re.test("5025")).toBe(true);
    expect(re.test("123456")).toBe(false);
    expect(re.test("1h")).toBe(false);
  });
});
