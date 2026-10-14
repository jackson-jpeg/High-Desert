import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readCatalogFiles } from "@/lib/shows/load";
import { buildShowCatalog } from "@/lib/shows/catalog";
import { requestLinePage } from "@/lib/live/request-line-page";
import { ShowShell } from "@/components/shows/ShowShell";
import { RequestLineView } from "@/components/request-line/RequestLineView";
import { RequestLineList } from "@/components/request-line/RequestLineList";
import { RequestItButton } from "@/components/request-line/RequestItButton";
import { requestCloseAt, pacificDayBounds } from "@/lib/live/schedule";
import { validateJsonLd } from "../../../../scripts/lib/jsonld-check.mjs";
import { ShowView } from "@/components/shows/ShowView";
import { EpisodeManageBar } from "@/components/library/EpisodeActions";

/**
 * The Request Line page, its list and the Request it button (2026-10-14,
 * docs/request-line.md). The page is server HTML a crawler reads whole: the
 * nominations with their votes, tonight's pick once locked, valid structured
 * data, links that resolve, no em dash. In the browser the list adds this
 * listener's marks, one-tap votes, Share for their own pick and an admin's
 * Veto; the button says what happened beside itself.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const { rows, slugs } = readCatalogFiles(ROOT);
const catalog = buildShowCatalog(rows, slugs);
const DAY = "2026-10-14";
const NOON = pacificDayBounds(DAY).start + 12 * 3_600_000;
const DASH = "—";
const area51 = catalog.bySlug.get("1992-12-12-area-51-john-lear-bob-lazar")!;
const other = catalog.shows.find((s) => s !== area51 && s.row.guestName)!;

const nom = (id: number, show: typeof area51, votes: number, extra = {}) => ({
  id,
  fileHash: show.row.fileHash,
  title: show.row.title ?? "",
  airDate: show.row.airDate ?? null,
  guestName: show.row.guestName ?? null,
  name: `Caller ${id}`,
  place: id === 1 ? "Pahrump" : null,
  note: id === 1 ? "Art at his best" : null,
  votes,
  ...extra,
});

function doc(html: string) {
  return new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");
}
function render(page: ReturnType<typeof requestLinePage>, available = true, now = NOON) {
  return doc(renderToStaticMarkup(createElement(ShowShell, null, createElement(RequestLineView, { page, available, now }))));
}
function resolves(href: string) {
  const p = href.split("?")[0];
  if (p.startsWith("/show/")) return catalog.bySlug.has(p.slice(6));
  if (p.startsWith("/tonight/")) return /^\/tonight\/\d{4}-\d{2}-\d{2}$/.test(p);
  return ["/", "/library", "/live", "/stats", "/tonight", "/topics", "/request-line"].includes(p);
}
function checkPage(d: Document) {
  for (const a of d.querySelectorAll("a[href]")) expect(resolves(a.getAttribute("href")!), a.getAttribute("href")!).toBe(true);
  for (const s of d.querySelectorAll('script[type="application/ld+json"]')) expect(validateJsonLd(JSON.parse(s.textContent!))).toEqual([]);
  expect(d.body.textContent).not.toContain(DASH);
  expect(d.querySelectorAll("h1")).toHaveLength(1);
}

describe("the Request Line page, server rendered", () => {
  it("lists the day's nominations with their votes, who picked them and their notes, most voted first", () => {
    const page = requestLinePage(DAY, [nom(1, area51, 5), nom(2, other, 2)], null, catalog);
    const d = render(page);
    checkPage(d);
    expect(d.querySelector("article.hd-request-line")!.getAttribute("data-request-day")).toBe(DAY);
    const rowsEl = [...d.querySelectorAll('[data-testid="request-row"]')];
    expect(rowsEl).toHaveLength(2);
    expect(rowsEl[0].textContent).toContain("Picked by Caller 1, calling from Pahrump");
    expect(rowsEl[0].textContent).toContain("Art at his best");
    expect(rowsEl[0].querySelector('[data-testid="request-votes"]')!.textContent).toContain("5");
    expect(rowsEl[0].querySelector(`a[href="/show/${area51.slug}"]`)).not.toBeNull();
    expect(d.body.textContent).toContain("Up for tonight");
    expect(d.body.textContent).toContain("Voting closes at");
    // Structured data names the nominated shows' pages.
    const ld = [...d.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!));
    const coll = ld.find((n) => n["@type"] === "CollectionPage");
    expect(coll.mainEntity.numberOfItems).toBe(2);
    expect(page.card.title).toBe("Vote for my pick on High Desert");
    expect(page.card.subtitle).toBe(`Leading tonight: ${area51.row.title}`);
  });

  it("once locked, tonight's pick and who asked for it head the page", () => {
    const page = requestLinePage("2026-10-15", [], { fileHash: area51.row.fileHash, by: "Night Owl", place: "Pahrump", votes: 7 }, catalog);
    const d = render(page, true, requestCloseAt(DAY) + 60_000);
    checkPage(d);
    const t = d.querySelector('[data-testid="request-tonight"]')!;
    expect(t.textContent).toContain(area51.row.title!);
    expect(t.textContent).toContain("requested by Night Owl, calling from Pahrump");
    expect(t.textContent).toContain("7 votes");
    // After 6 PM the list is tomorrow's.
    expect(d.body.textContent).toContain("Up for tomorrow night");
  });

  it("the empty night: nobody nominated, a fan favorite plays, and the list invites the first pick", () => {
    const page = requestLinePage(DAY, [], { fileHash: null, by: null, place: null, votes: 0 }, catalog);
    const d = render(page);
    checkPage(d);
    expect(d.querySelector('[data-testid="request-tonight"]')!.textContent).toContain("a fan favorite plays at 10 PM");
    expect(d.querySelector('[data-testid="request-empty"]')).not.toBeNull();
    expect(page.card.subtitle).toBe("Pick tonight's 10 PM show on High Desert Live");
  });

  it("without a database it says so, still a whole page", () => {
    const d = render(requestLinePage(DAY, [], null, catalog), false);
    checkPage(d);
    expect(d.body.textContent).toContain("cannot be read right now");
  });
});

describe("Request it, where a show is", () => {
  it("is on every show page, and hidden without JavaScript (the native player still works)", () => {
    const d = doc(renderToStaticMarkup(createElement(ShowShell, null, createElement(ShowView, { show: area51, catalog }))));
    expect(d.querySelector('[data-testid="request-it-button"]')!.textContent).toBe("Request it");
    expect(d.querySelector("noscript")!.innerHTML).toContain(".hd-request-it{display:none!important}");
  });

  it("is in the Library's episode panel (both looks share it) for a catalog show, never for a local file", () => {
    const ep = { ...area51.row, id: 1 } as never;
    expect(doc(renderToStaticMarkup(createElement(EpisodeManageBar, { episode: ep }))).querySelector('[data-testid="request-it-button"]')).not.toBeNull();
    const local = { id: 2, fileHash: "local:abc", fileName: "x.mp3", title: "X" } as never;
    expect(doc(renderToStaticMarkup(createElement(EpisodeManageBar, { episode: local }))).querySelector('[data-testid="request-it-button"]')).toBeNull();
  });
});

describe("in the browser", () => {
  let root: Root;
  let host: HTMLDivElement;
  let posts: { url: string; body: unknown }[];
  let state: Record<string, unknown>;
  beforeEach(() => {
    posts = [];
    state = {
      day: DAY,
      closesAt: requestCloseAt(DAY),
      startsAt: 0,
      nominated: true,
      tonight: null,
      admin: false,
      nominations: [
        { ...nom(1, area51, 5), mine: true, voted: true },
        { ...nom(2, other, 2), mine: false, voted: false },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          posts.push({ url, body });
          if (url === "/live-api/requests") {
            return body.fileHash === "archive:x:played.mp3"
              ? new Response(JSON.stringify({ error: "played-recently", message: "The station played that one in the last 30 days. Pick another." }), { status: 409 })
              : new Response(JSON.stringify({ joined: false, id: 9, counted: true, votes: 1 }), { status: 201 });
          }
          if (url === "/live-api/requests/vote") {
            (state.nominations as { id: number; votes: number; voted: boolean }[])[1].votes = 3;
            (state.nominations as { id: number; votes: number; voted: boolean }[])[1].voted = true;
            return new Response(JSON.stringify({ ok: true, counted: true, votes: 3 }), { status: 200 });
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify(state), { status: 200 });
      }),
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
  const settle = async () => {
    for (let i = 0; i < 4; i++) await act(async () => new Promise((r) => setTimeout(r, 5)));
  };
  const rowOf = (id: number) => host.querySelector<HTMLElement>(`[data-nomination="${id}"]`)!;

  it("marks this listener's own pick and vote; one tap votes and the count re-reads", async () => {
    const initial = requestLinePage(DAY, [nom(1, area51, 5), nom(2, other, 2)], null, catalog).nominations;
    act(() => root.render(<RequestLineList initial={initial} day={DAY} closesAt={Date.now() + 3_600_000} />));
    await settle();
    expect(rowOf(1).textContent).toContain("(you)");
    expect(rowOf(1).querySelector<HTMLButtonElement>('[data-testid="request-vote"]')!.disabled).toBe(true);
    expect(rowOf(1).querySelector('[data-testid="request-share"]')).not.toBeNull();
    expect(rowOf(2).querySelector('[data-testid="request-share"]')).toBeNull();
    expect(host.querySelector('[data-testid="request-veto"]')).toBeNull();
    await act(async () => rowOf(2).querySelector<HTMLButtonElement>('[data-testid="request-vote"]')!.click());
    await settle();
    expect(posts).toEqual([{ url: "/live-api/requests/vote", body: { nominationId: 2 } }]);
    expect(rowOf(2).querySelector('[data-testid="request-votes"]')!.textContent).toContain("3");
    expect(rowOf(2).querySelector('[data-testid="request-vote"]')!.textContent).toBe("Voted");
    expect(host.textContent).not.toContain(DASH);
  });

  it("after 6 PM Vote is off; an admin sees Veto", async () => {
    state.admin = true;
    act(() => root.render(<RequestLineList initial={[]} day={DAY} closesAt={Date.now() - 1} />));
    await settle();
    for (const b of host.querySelectorAll<HTMLButtonElement>('[data-testid="request-vote"]')) expect(b.disabled).toBe(true);
    expect(host.querySelectorAll('[data-testid="request-veto"]')).toHaveLength(2);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="request-veto"]')!.click());
    await settle();
    expect(posts[0]).toEqual({ url: "/live-api/admin/request-veto", body: { nominationId: 1 } });
  });

  it("Request it says what happened beside itself, with the way to the Request Line", async () => {
    act(() => root.render(<RequestItButton fileHash={area51.row.fileHash} />));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="request-it-button"]')!.click());
    await settle();
    const s = host.querySelector('[data-testid="request-it-status"]')!;
    expect(s.getAttribute("data-ok")).toBe("true");
    expect(s.textContent).toContain("Requested. It is on the Request Line with 1 vote.");
    expect(s.querySelector('a[href="/request-line"]')).not.toBeNull();
    expect(posts[0]).toEqual({ url: "/live-api/requests", body: { fileHash: area51.row.fileHash } });
  });

  it("a refused request shows the station's reason (the 30-day rule), not a generic error", async () => {
    act(() => root.render(<RequestItButton fileHash="archive:x:played.mp3" />));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="request-it-button"]')!.click());
    await settle();
    const s = host.querySelector('[data-testid="request-it-status"]')!;
    expect(s.getAttribute("data-ok")).toBe("false");
    expect(s.textContent).toContain("The station played that one in the last 30 days.");
    expect(s.textContent).not.toContain(DASH);
  });
});
