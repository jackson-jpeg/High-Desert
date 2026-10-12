import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";
import { EpisodeCard } from "@/components/library/EpisodeCard";
import { LookProvider } from "@/hooks/useLook";
import { onHdEvent } from "@/lib/events";
import { itemHeightFor, ITEM_HEIGHT_MOBILE, ITEM_HEIGHT_W98_PHONE } from "@/hooks/useTextScale";
import type { Look } from "@/lib/look/look";

/**
 * Win98 on a phone draws the library as a dense Details list, not cards: one
 * two-line row per show (title; date, guest, length), navy when selected, at
 * ITEM_HEIGHT_W98_PHONE, which the virtual list uses for its offsets. Every
 * row action stays. Night keeps its cards.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const ep = {
  id: 7,
  fileHash: "archive:coll:7.mp3",
  fileName: "7.mp3",
  archiveIdentifier: "coll",
  title: "Coast to Coast AM - Area 51",
  airDate: "1996-11-02",
  guestName: "Bob Lazar",
  showType: "coast",
  duration: 3 * 3600,
  playCount: 0,
} as unknown as Episode;

function renderIn(look: Look, props: Partial<Parameters<typeof EpisodeCard>[0]> = {}) {
  const card = createElement(EpisodeCard, { episode: ep, onClick: () => {}, ...props });
  act(() => root.render(createElement(LookProvider, { look }, card as ReactNode)));
  return host.querySelector<HTMLElement>('[role="option"]')!;
}

describe("Win98 phone library rows", () => {
  it("are dense Details rows in Win98: the title, then date, guest and length", () => {
    const row = renderIn("win98");
    expect(row.className).toContain("hd-w98-row");
    expect(row.className).not.toContain("p-2.5");
    const details = row.querySelector<HTMLElement>('[data-row-layout="w98-details"]')!;
    expect(details).not.toBeNull();
    expect(details.textContent).toContain("Coast to Coast AM - Area 51");
    expect(details.textContent).toContain("Bob Lazar");
    expect(details.textContent).toContain("3h 0m");
    // The card layout is not drawn on a phone at all.
    const card = [...row.querySelectorAll<HTMLElement>(".md\\:hidden")].find((el) => el !== details);
    expect(card?.classList.contains("hidden")).toBe(true);
  });

  it("keep every row action: the guest, the star (a 44 px target), selection", () => {
    const toggled: Episode[] = [];
    const row = renderIn("win98", { onToggleFavorite: (e) => toggled.push(e), isSelected: true });
    const details = row.querySelector<HTMLElement>('[data-row-layout="w98-details"]')!;
    const guests: string[] = [];
    const off = onHdEvent("show-guest", (g) => guests.push(g));
    act(() => details.querySelector<HTMLElement>('[data-row-action="guest"]')!.click());
    off();
    expect(guests).toEqual(["Bob Lazar"]);
    const star = details.querySelector<HTMLElement>('[data-row-action="favorite"]')!;
    expect(star.className).toContain("min-w-touch");
    expect(star.className).toContain("min-h-touch");
    act(() => star.click());
    expect(toggled).toEqual([ep]);
    expect(row.getAttribute("aria-selected")).toBe("true");
  });

  it("Night keeps its cards", () => {
    const row = renderIn("night");
    expect(row.className).not.toContain("hd-w98-row");
    expect(row.querySelector('[data-row-layout="w98-details"]')).toBeNull();
    expect(row.querySelector<HTMLElement>(".md\\:hidden")?.classList.contains("hidden")).toBe(false);
  });

  it("the list lays them out at their own height, past the touch floor", () => {
    expect(ITEM_HEIGHT_W98_PHONE).toBeGreaterThanOrEqual(44);
    expect(itemHeightFor(true, 1, "win98")).toBe(ITEM_HEIGHT_W98_PHONE);
    expect(itemHeightFor(true, 1, "night")).toBe(ITEM_HEIGHT_MOBILE);
    expect(itemHeightFor(true, 1.3, "win98")).toBe(Math.round(ITEM_HEIGHT_W98_PHONE * 1.3));
    expect(itemHeightFor(false, 1, "win98")).toBe(itemHeightFor(false, 1, "night"));
  });
});
