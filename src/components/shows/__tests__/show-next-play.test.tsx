import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { ShowPlayButton } from "@/components/shows/ShowPlayButton";
import { ShowNextPlay } from "@/components/shows/ShowNextPlay";

/**
 * The Next card's Play (src/lib/shows/next.ts, ShowNextPlay.tsx): it plays
 * the next show in the page's own player, inside the tap, and the next show's
 * listen is counted, not this one's again.
 */

const THIS = "coll--1992-12-12_-_Area_51";
const NEXT = "coll--1993-01-08_-_Lear";
const NEXT_SOURCES = ["https://archive.org/download/coll/next.mp3", "/mirror/archive%3Acoll%3Anext.mp3"];

let root: Root;
let host: HTMLDivElement;
let audio: HTMLAudioElement;
const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
const playSpy = vi.fn(() => Promise.resolve());
const loadSpy = vi.fn();

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  playSpy.mockClear();
  loadSpy.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  audio = document.createElement("audio");
  audio.id = "show-audio-test";
  const first = document.createElement("source");
  first.src = "https://archive.org/download/coll/this.mp3";
  audio.appendChild(first);
  audio.play = playSpy as unknown as HTMLAudioElement["play"];
  audio.load = loadSpy;
  host.appendChild(audio);
  const mountPoint = document.createElement("div");
  host.appendChild(mountPoint);
  root = createRoot(mountPoint);
  act(() =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement(ShowPlayButton, { audioId: "show-audio-test", startAt: 120, episodeId: THIS }),
        createElement(ShowNextPlay, { audioId: "show-audio-test", sources: NEXT_SOURCES, episodeId: NEXT }),
      ),
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const playPosts = () =>
  fetchMock.mock.calls
    .filter((c) => (c as unknown[])[0] === "/api/stats/play")
    .map((c) => JSON.parse(((c as unknown[])[1] as RequestInit).body as string));
const nextButton = () => host.querySelector('[data-testid="show-next-play"] button') as HTMLButtonElement | null;

describe("ShowNextPlay", () => {
  it("plays the next show in the page's player, inside the tap", () => {
    act(() => nextButton()!.click());
    expect([...audio.querySelectorAll("source")].map((s) => s.getAttribute("src"))).toEqual(NEXT_SOURCES);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="show-next-play"]')!.getAttribute("data-state")).toBe("playing");
    expect(nextButton()).toBeNull();
  });

  it("the next show's listen is counted once it plays, after this show's", () => {
    audio.dispatchEvent(new Event("playing"));
    expect(playPosts()).toEqual([expect.objectContaining({ episodeId: THIS, surface: "show" })]);
    act(() => nextButton()!.click());
    audio.dispatchEvent(new Event("playing"));
    expect(playPosts()).toEqual([
      expect.objectContaining({ episodeId: THIS, surface: "show" }),
      expect.objectContaining({ episodeId: NEXT, surface: "show" }),
    ]);
  });

  it("this show's shared moment is not applied to the next show", () => {
    const seeks: number[] = [];
    let t = 0;
    Object.defineProperty(audio, "currentTime", {
      get: () => t,
      set: (v: number) => {
        seeks.push(v);
        t = v;
      },
      configurable: true,
    });
    const big = () => host.querySelector('[data-testid="show-play"]')!.textContent;
    expect(big()).toContain("Play from 2:00");
    act(() => nextButton()!.click());
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(seeks).toEqual([]);
    expect(big()).not.toContain("2:00");
  });

  it("control: without the switch, the moment is applied on loadedmetadata", () => {
    const seeks: number[] = [];
    Object.defineProperty(audio, "currentTime", {
      get: () => 0,
      set: (v: number) => seeks.push(v),
      configurable: true,
    });
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(seeks).toEqual([120]);
  });

  it("says when this show has ended, and still offers the next", () => {
    expect(host.textContent).not.toContain("That was the show.");
    act(() => {
      audio.dispatchEvent(new Event("ended"));
    });
    expect(host.textContent).toContain("That was the show.");
    expect(nextButton()).not.toBeNull();
  });

  it("control: without a press nothing about the player changes", () => {
    expect([...audio.querySelectorAll("source")].map((s) => s.getAttribute("src"))).toEqual([
      "https://archive.org/download/coll/this.mp3",
    ]);
    expect(playSpy).not.toHaveBeenCalled();
  });
});
