import { describe, it, expect, beforeEach, vi } from "vitest";
import { BRIDGE_QUIET_URL, STATION_ID_URL, endBridge, initEngine, playBridge } from "@/audio/engine";

/** The bridge plays a break's spot, then the station ID, then quiet, on one element (docs/station-breaks.md). */

let el: HTMLAudioElement;
const path = () => new URL(el.src, "http://localhost").pathname;

beforeEach(() => {
  endBridge();
  el = new Audio();
  el.play = vi.fn(() => Promise.resolve());
  initEngine(el);
});

describe("playBridge", () => {
  it("with a spot: the spot, then the station ID, then quiet on a loop", async () => {
    await playBridge("/audio/breaks/sogojet.mp3");
    expect(path()).toBe("/audio/breaks/sogojet.mp3");
    el.dispatchEvent(new Event("ended"));
    expect(path()).toBe(STATION_ID_URL);
    expect(el.loop).toBe(false);
    el.dispatchEvent(new Event("ended"));
    expect(path()).toBe(BRIDGE_QUIET_URL);
    expect(el.loop).toBe(true);
  });

  it("without one: the station ID, then quiet, as before", async () => {
    await playBridge();
    expect(path()).toBe(STATION_ID_URL);
    el.dispatchEvent(new Event("ended"));
    expect(path()).toBe(BRIDGE_QUIET_URL);
  });

  it("a show taking the element drops what the bridge had queued", async () => {
    await playBridge("/audio/breaks/sogojet.mp3");
    endBridge();
    el.src = "https://archive.org/download/c/show.mp3";
    el.dispatchEvent(new Event("ended"));
    expect(el.src).toBe("https://archive.org/download/c/show.mp3");
  });
});
