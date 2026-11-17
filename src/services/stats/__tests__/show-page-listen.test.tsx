import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { installShowListen, sourceOf, SHOW_HEARTBEAT_MS, type ShowListenDeps } from "@/services/stats/show-page-listen";
import { ShowPlayButton } from "@/components/shows/ShowPlayButton";
import { NOT_COUNTED_KEY } from "@/services/stats/not-counted";

/**
 * A show page's listen is counted (docs/show-pages.md, "Counting a listen"):
 * 713 desktop views and 0 plays in the 30 days to 2026-11-17, because the
 * page's native <audio> wrote nothing.
 */

const ORIGIN = "https://highdesert.space";
const KEY = "coll--1992-12-12_-_Area_51";

function fakeDeps() {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const timers = new Map<number, () => void>();
  let next = 1;
  const deps: ShowListenDeps = {
    post: (path, body) => posts.push({ path, body }),
    origin: ORIGIN,
    setInterval: (fn) => {
      const id = next++;
      timers.set(id, fn);
      return id;
    },
    clearInterval: (id) => timers.delete(id as number),
  };
  const tick = () => [...timers.values()].forEach((fn) => fn());
  return { deps, posts, timers, tick };
}

function audioPlaying(src: string): HTMLAudioElement {
  const audio = document.createElement("audio");
  Object.defineProperty(audio, "currentSrc", { get: () => src, configurable: true });
  return audio;
}

type Post = { path: string; body: Record<string, unknown> };
const plays = (posts: Post[]) => posts.filter((p) => p.path === "/api/stats/play");
const beats = (posts: Post[]) => posts.filter((p) => p.path === "/api/stats/heartbeat");

beforeEach(() => localStorage.clear());

describe("sourceOf", () => {
  it("names the mirror, archive.org and its storage nodes, and nothing else", () => {
    expect(sourceOf(`${ORIGIN}/mirror/abc#t=10`, ORIGIN)).toBe("mirror");
    expect(sourceOf("https://archive.org/download/x/y.mp3", ORIGIN)).toBe("archive");
    expect(sourceOf("https://ia800.us.archive.org/1/items/x/y.mp3", ORIGIN)).toBe("archive");
    expect(sourceOf("https://example.com/mirror/abc", ORIGIN)).toBeNull();
    expect(sourceOf("", ORIGIN)).toBeNull();
  });
});

describe("installShowListen", () => {
  it("counts one play on the first sound, with surface, source and key; resume is the same listen", () => {
    const { deps, posts } = fakeDeps();
    const audio = audioPlaying("https://archive.org/download/x/y.mp3");
    installShowListen(audio, KEY, deps);
    expect(posts).toEqual([]); // nothing until sound

    audio.dispatchEvent(new Event("playing"));
    audio.dispatchEvent(new Event("pause"));
    audio.dispatchEvent(new Event("playing"));

    expect(plays(posts)).toHaveLength(1);
    expect(plays(posts)[0].body).toMatchObject({ episodeId: KEY, surface: "show", source: "archive" });
    expect(typeof plays(posts)[0].body.sessionId).toBe("string");
  });

  it("says mirror when the browser fell through to the mirror source", () => {
    const { deps, posts } = fakeDeps();
    const audio = audioPlaying(`${ORIGIN}/mirror/abc`);
    installShowListen(audio, KEY, deps);
    audio.dispatchEvent(new Event("playing"));
    expect(plays(posts)[0].body.source).toBe("mirror");
  });

  it("beats with the show every minute while it plays, and stops on pause and on ended", () => {
    const { deps, posts, timers, tick } = fakeDeps();
    const audio = audioPlaying("https://archive.org/download/x/y.mp3");
    installShowListen(audio, KEY, deps);

    audio.dispatchEvent(new Event("playing"));
    expect(beats(posts)).toHaveLength(1);
    expect(beats(posts)[0].body).toMatchObject({ episodeId: KEY });
    expect(timers.size).toBe(1);
    tick();
    expect(beats(posts)).toHaveLength(2);

    audio.dispatchEvent(new Event("pause"));
    expect(timers.size).toBe(0);
    audio.dispatchEvent(new Event("playing"));
    expect(timers.size).toBe(1); // one clock, never two
    audio.dispatchEvent(new Event("playing"));
    expect(timers.size).toBe(1);
    audio.dispatchEvent(new Event("ended"));
    expect(timers.size).toBe(0);
    expect(SHOW_HEARTBEAT_MS).toBe(60_000);
  });

  it("a headless checker's page sends no heartbeat (control: the same page without the mark does)", () => {
    localStorage.setItem(NOT_COUNTED_KEY, "1");
    const { deps, posts } = fakeDeps();
    const audio = audioPlaying("https://archive.org/download/x/y.mp3");
    installShowListen(audio, KEY, deps);
    audio.dispatchEvent(new Event("playing"));
    expect(beats(posts)).toHaveLength(0);
  });

  it("teardown stops listening", () => {
    const { deps, posts, timers } = fakeDeps();
    const audio = audioPlaying("https://archive.org/download/x/y.mp3");
    const off = installShowListen(audio, KEY, deps);
    audio.dispatchEvent(new Event("playing"));
    off();
    expect(timers.size).toBe(0);
    audio.dispatchEvent(new Event("playing"));
    expect(plays(posts)).toHaveLength(1);
  });
});

describe("ShowPlayButton counts the page's listen, whichever control started it", () => {
  let root: Root;
  let host: HTMLDivElement;
  const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  function mount(episodeId: string | null) {
    const audio = document.createElement("audio");
    audio.id = "show-audio-test";
    host.appendChild(audio);
    const mountPoint = document.createElement("div");
    host.appendChild(mountPoint);
    root = createRoot(mountPoint);
    act(() => root.render(createElement(ShowPlayButton, { audioId: "show-audio-test", startAt: null, episodeId })));
    return audio;
  }

  const playPosts = () =>
    fetchMock.mock.calls.filter((c) => (c as unknown[])[0] === "/api/stats/play").map((c) => JSON.parse(((c as unknown[])[1] as RequestInit).body as string));

  it("the native controls' play (no button press) posts one play with surface show", () => {
    const audio = mount(KEY);
    audio.dispatchEvent(new Event("playing"));
    expect(playPosts()).toEqual([expect.objectContaining({ episodeId: KEY, surface: "show" })]);
  });

  it("control: a page with no key counts nothing", () => {
    const audio = mount(null);
    audio.dispatchEvent(new Event("playing"));
    expect(playPosts()).toEqual([]);
  });
});
