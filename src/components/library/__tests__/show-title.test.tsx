import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Episode } from "@/db/schema";
import { ShowTitle } from "@/components/library/ShowTitle";
import { EpisodeCard } from "@/components/library/EpisodeCard";

/**
 * Show titles on a phone (2026-10-11). Every catalog title is "Show -
 * Episode", and at 390 px "Midnight in the Desert - " ate the line, in a
 * fallback bold sans (`font-sans`) instead of the site's type. The show is now
 * a kicker and the episode gets the line, everywhere a phone truncates one.
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

const MITD = "Midnight in the Desert - Open Lines: Inhuman Encounter Line";

describe("ShowTitle", () => {
  it("splits the show into the kicker and gives the episode the line", () => {
    act(() => root.render(createElement(ShowTitle, { title: MITD, className: "text-hd-15" })));
    const kicker = host.querySelector("[data-show-kicker]");
    const episode = host.querySelector("[data-show-episode]");
    expect(kicker?.textContent).toBe("Midnight in the Desert");
    expect(episode?.textContent).toBe("Open Lines: Inhuman Encounter Line");
    // The whole title is still there on hover, on both parts.
    expect(kicker?.getAttribute("title")).toBe(MITD);
    expect(episode?.getAttribute("title")).toBe(MITD);
    expect(episode?.className).toContain("truncate");
    expect(episode?.className).toContain("text-hd-15");
    expect(kicker?.className).toContain("text-hd-micro");
  });

  it("a title with no show part is all episode, with no kicker", () => {
    act(() => root.render(createElement(ShowTitle, { title: "My own recording" })));
    expect(host.querySelector("[data-show-kicker]")).toBeNull();
    expect(host.querySelector("[data-show-episode]")?.textContent).toBe("My own recording");
  });
});

describe("the phone library card", () => {
  const ep = {
    id: 1,
    fileHash: "archive:coll:1.mp3",
    fileName: "1.mp3",
    archiveIdentifier: "coll",
    title: MITD,
    airDate: "2016-03-01",
    showType: "special",
    topic: "Open Lines: Inhuman Encounter Line",
    playCount: 0,
  } as unknown as Episode;

  function phoneBlock(): HTMLElement {
    act(() => root.render(createElement(EpisodeCard, { episode: ep, onClick: () => {} })));
    const block = host.querySelector<HTMLElement>(".md\\:hidden");
    expect(block).not.toBeNull();
    return block!;
  }

  it("shows the show as the kicker and the episode as the title", () => {
    const block = phoneBlock();
    expect(block.querySelector("[data-show-kicker]")?.textContent).toBe("Midnight in the Desert");
    const title = block.querySelector("[data-show-episode]");
    expect(title?.textContent).toBe("Open Lines: Inhuman Encounter Line");
    expect(title?.className).toContain("font-bold");
  });

  it("draws nothing in the fallback sans", () => {
    const block = phoneBlock();
    expect(block.querySelector(".font-sans")).toBeNull();
    expect(block.innerHTML).not.toContain("font-sans");
  });

  it("does not repeat the title as the topic", () => {
    const block = phoneBlock();
    expect(block.textContent?.split("Open Lines: Inhuman Encounter Line").length).toBe(2);
  });
});

describe("no phone title is drawn in font-sans", () => {
  it("the card and the expanded player carry no font-sans", () => {
    for (const f of ["src/components/library/EpisodeCard.tsx", "src/components/player/AudioPlayer.tsx"]) {
      expect(readFileSync(path.join(process.cwd(), f), "utf8")).not.toMatch(/\bfont-sans\b/);
    }
  });
});
