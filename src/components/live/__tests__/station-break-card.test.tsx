// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { StationBreak } from "@/lib/live/breaks";
import { chatRows } from "@/lib/live/chat-rows";
import { cardBreaks, BREAK_CARD_KEEP_MS } from "@/hooks/useStationBreakRows";
import { breaksMuted, BREAKS_MUTED_KEY } from "@/lib/live/breaks-pref";
import { SPONSORS } from "@/lib/support/sponsors";
import { StationBreakCard, BREAK_OPEN, BREAK_CLOSE, breakElapsedSec } from "../StationBreakCard";
import { StationSponsors, nextSponsor, SPONSOR_ROTATION_KEY, SPONSOR_VISIT_KEY } from "@/components/library/StationSponsors";
import { resetSponsorNotesForTests } from "@/services/stats/sponsor-client";

/** The station break card in the phone lines, and the /stats panel (docs/station-breaks.md). */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T = Date.UTC(2026, 10, 17, 3, 27, 0);
const B: StationBreak = {
  id: "2026-11-16:evening",
  day: "2026-11-16",
  slot: "evening",
  spot: "sogojet",
  cart: "07",
  url: "/audio/breaks/sogojet.mp3",
  durationSec: 18,
  card: true,
  start: T,
  end: T + 18_000,
};

let root: Root;
let container: HTMLDivElement;
let posts: { app: string; surface: string; event: string }[];

function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
  return container;
}

beforeEach(() => {
  posts = [];
  resetSponsorNotesForTests();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.body) posts.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("StationBreakCard", () => {
  it("while the spot plays: the open marker, the lit lamp, Cart 07, the LCD in time, the plane, no close marker", () => {
    const c = render(<ol><StationBreakCard b={B} now={T + 9_000} /></ol>);
    expect(c.querySelector('[data-testid="break-open"]')!.textContent).toBe(BREAK_OPEN);
    expect(c.querySelector('[data-testid="break-lamp"]')!.className).toContain("hd-break-lamp-on");
    expect(c.querySelector('[data-testid="break-cart"]')!.textContent).toBe("Cart 07");
    expect(c.textContent).toContain("On air: station break");
    expect(c.querySelector('[data-testid="break-lcd-time"]')!.textContent).toBe("00:09 / 00:18");
    expect((c.querySelector('[data-testid="break-lcd-fill"]') as HTMLElement).style.width).toBe("50%");
    expect(c.querySelector('[data-testid="sponsor-plane"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="break-close"]')).toBeNull();
  });

  it("after it: the lamp out, the bar full, no plane, and Back to the show", () => {
    const c = render(<ol><StationBreakCard b={B} now={T + 30_000} /></ol>);
    expect(c.querySelector('[data-testid="break-lamp"]')!.className).not.toContain("hd-break-lamp-on");
    expect(c.querySelector('[data-testid="break-lcd-time"]')!.textContent).toBe("00:18 / 00:18");
    expect(c.querySelector('[data-testid="sponsor-plane"]')).toBeNull();
    expect(c.querySelector('[data-testid="break-close"]')!.textContent).toBe(BREAK_CLOSE);
  });

  it("the print ad: the app's name, the price as the App Store has it, the sign-off, Get the app to the real page", () => {
    const c = render(<ol><StationBreakCard b={{ ...B, spot: "screenreceipts", cart: "12" }} now={T + 30_000} /></ol>);
    expect(c.querySelector('[data-testid="sponsor-name"]')!.textContent).toBe("Screen Receipts");
    expect(c.querySelector('[data-testid="sponsor-coupon"]')!.textContent).toContain("Clip and save");
    expect(c.querySelector('[data-testid="sponsor-coupon"]')!.textContent).toContain("$0.99 on the App Store");
    expect(c.textContent).toContain("A word from the guy who keeps this station running.");
    const a = c.querySelector('[data-testid="sponsor-get"]') as HTMLAnchorElement;
    expect(a.textContent).toBe("Get the app");
    expect(a.getAttribute("href")).toBe(SPONSORS.screenreceipts.appStoreUrl);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("counts itself seen once, and a click on Get the app", () => {
    const c = render(<ol><StationBreakCard b={B} now={T + 30_000} /></ol>);
    expect(posts).toEqual([{ app: "sogojet", surface: "chat", event: "seen" }]);
    act(() => (c.querySelector('[data-testid="sponsor-get"]') as HTMLAnchorElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(posts[1]).toEqual({ app: "sogojet", surface: "chat", event: "click" });
  });

  it("Mute breaks mutes them for this browser", () => {
    const c = render(<ol><StationBreakCard b={B} now={T + 30_000} /></ol>);
    expect(breaksMuted()).toBe(false);
    act(() => (c.querySelector('[data-testid="break-mute"]') as HTMLButtonElement).click());
    expect(breaksMuted()).toBe(true);
    expect(localStorage.getItem(BREAKS_MUTED_KEY)).toBe("1");
    expect(posts.some((p) => p.event === "mute")).toBe(true);
  });

  it("no em dash on the card", () => {
    const c = render(<ol><StationBreakCard b={B} now={T + 9_000} /></ol>);
    expect(c.textContent).not.toContain("—");
  });

  it("the LCD's elapsed is held to the spot", () => {
    expect(breakElapsedSec(B, T - 5_000)).toBe(0);
    expect(breakElapsedSec(B, T + 60_000)).toBe(18);
  });
});

describe("which cards the lines draw", () => {
  it("cards only, once started, for six hours, and none when muted", () => {
    const quiet = { ...B, id: "x", card: false };
    const later = { ...B, id: "y", start: T + 3_600_000, end: T + 3_618_000 };
    expect(cardBreaks([B, quiet, later], T + 1, false)).toEqual([B]);
    expect(cardBreaks([B], T - 1, false)).toEqual([]);
    expect(cardBreaks([B], T + BREAK_CARD_KEEP_MS + 1, false)).toEqual([]);
    expect(cardBreaks([B], T + 1, true)).toEqual([]);
  });

  it("a break sits among the calls at the time its spot started", () => {
    const call = (id: number, at: number) => ({ id, at: new Date(at).toISOString(), name: "N", place: null, line: "Line 1", body: "hi" });
    const rows = chatRows([call(1, T - 60_000), call(2, T + 60_000)], [], [], [B]);
    expect(rows.map((r) => r.kind)).toEqual(["call", "break", "call"]);
  });
});

describe("Station sponsors on /stats", () => {
  it("one app per visit, the next in turn on the next visit", () => {
    expect(nextSponsor(null)).toBe("sogojet");
    expect(nextSponsor("sogojet")).toBe("screenreceipts");
    expect(nextSponsor("simsunday")).toBe("sogojet");
    localStorage.setItem(SPONSOR_ROTATION_KEY, "sogojet");
    const c = render(<StationSponsors />);
    expect(c.querySelector('[data-testid="sponsor-ad"]')!.getAttribute("data-app")).toBe("screenreceipts");
    expect(sessionStorage.getItem(SPONSOR_VISIT_KEY)).toBe("screenreceipts");
    expect(posts).toEqual([{ app: "screenreceipts", surface: "stats", event: "seen" }]);
    expect(c.querySelector('[data-testid="sponsor-plane"]')).toBeNull();
  });

  it("the same app for the rest of the sitting", () => {
    sessionStorage.setItem(SPONSOR_VISIT_KEY, "simsunday");
    localStorage.setItem(SPONSOR_ROTATION_KEY, "simsunday");
    const c = render(<StationSponsors />);
    expect(c.querySelector('[data-testid="sponsor-ad"]')!.getAttribute("data-app")).toBe("simsunday");
  });
});
