import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { playUiSound, resetUiSoundsForTest, setUiSounds, uiSoundBlocked, uiSoundsOn, UI_SOUNDS_KEY } from "@/audio/ui-sounds";
import { programItems, settingsItems, startMenuItems, submenuOf, type StartItem } from "@/components/looks/win98/start-menu";
import { tonightEntries, TONIGHT_MAX } from "@/components/looks/win98/start-programs-data";
import { SHOW_YEARS, TOP_GUESTS } from "@/lib/shows/start-programs";
import { readCatalogFiles } from "@/lib/shows/load";
import { buildShowCatalog } from "@/lib/shows/catalog";
import { showYears } from "@/lib/shows/archive";
import { onAirIndex } from "@/components/tonight/OnAirMarker";
import { logbookLine } from "@/components/library/SignalTraffic";
import { formatStationTime } from "@/lib/live/format";

/**
 * Push 5 of docs/UI-PLAN.md: the Start menu as a launcher, the interface
 * sounds and their switch, Tonight as a program guide, the logbook, the 404.
 */

const src = path.resolve(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(src, p), "utf8");

// ---------------------------------------------------------------- sounds

class FakeNode {
  connect(n: unknown) {
    return n;
  }
}
class FakeParam {
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime() {}
}
const started: string[] = [];
class FakeContext {
  state = "running";
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  resume() {}
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam() });
  }
  createOscillator() {
    return Object.assign(new FakeNode(), { type: "sine", frequency: new FakeParam(), start: () => started.push("osc"), stop() {} });
  }
  createBuffer(_c: number, len: number) {
    return { getChannelData: () => new Float32Array(len) };
  }
  createBufferSource() {
    return Object.assign(new FakeNode(), { buffer: null, start: () => started.push("noise"), stop() {} });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: "", frequency: { value: 0 } });
  }
}

describe("interface sounds", () => {
  let activated = true;
  beforeEach(() => {
    started.length = 0;
    activated = true;
    localStorage.clear();
    resetUiSoundsForTest();
    vi.stubGlobal("AudioContext", FakeContext);
    Object.defineProperty(navigator, "userActivation", { configurable: true, get: () => ({ hasBeenActive: activated }) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("are off until the listener turns them on, and play nothing while off", () => {
    expect(uiSoundsOn()).toBe(false);
    expect(uiSoundBlocked()).toBe("off");
    expect(playUiSound("click")).toBe(false);
    expect(started).toEqual([]);
  });

  it("play once turned on, each sound its own way", () => {
    setUiSounds(true);
    expect(localStorage.getItem(UI_SOUNDS_KEY)).toBe("on");
    expect(playUiSound("click")).toBe(true);
    expect(playUiSound("tune")).toBe(true);
    expect(started).toEqual(["noise", "osc"]);
    setUiSounds(false);
    expect(localStorage.getItem(UI_SOUNDS_KEY)).toBeNull();
    expect(playUiSound("click")).toBe(false);
  });

  it("make nothing before a tap, even when on", () => {
    setUiSounds(true);
    activated = false;
    expect(uiSoundBlocked()).toBe("no-gesture");
    expect(playUiSound("open")).toBe(false);
    expect(started).toEqual([]);
  });

  it("make nothing while the tab is hidden", () => {
    setUiSounds(true);
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    expect(playUiSound("hover")).toBe(false);
    vis.mockRestore();
  });

  it("are never offered on iOS, and use their own context, never the player's", () => {
    const sounds = read("audio/ui-sounds.ts");
    expect(sounds).toMatch(/if \(isIOSDevice\(\)\) return false;/);
    expect(sounds).not.toMatch(/from "@\/audio\/engine"/);
    expect(sounds).not.toMatch(/mediaSession/);
  });

  it("are wired: Start opening, hover, a pick, the dial's lock", () => {
    expect(read("components/looks/win98/Taskbar.tsx")).toMatch(/if \(startOpen\) playUiSound\("open"\);/);
    expect(read("components/looks/win98/Taskbar.tsx")).toMatch(/playUiSound\("click"\);\n\s+setStartOpen\(false\);/);
    expect(read("components/looks/win98/StartMenu.tsx").match(/playUiSound\("hover"\)/g)).toHaveLength(2);
    expect(read("hooks/useRadioDial.ts")).toMatch(/playUiSound\("tune"\)/);
  });

  it("have a switch in Night's More sheet", () => {
    const sheet = read("components/mobile/MobileMenuSheet.tsx");
    expect(sheet).toMatch(/data-testid="more-sounds"/);
    expect(sheet).toMatch(/onClick=\{uiSounds\.toggle\}/);
  });
});

// ---------------------------------------------------------------- Start

const labels = (items: readonly StartItem[]) => items.map((i) => i.label);

describe("the Start menu as a launcher", () => {
  const { rows, slugs } = readCatalogFiles();
  const catalog = buildShowCatalog(rows, slugs);

  it("By Year lists every year with shows, each to its page, in its era", () => {
    expect([...SHOW_YEARS]).toEqual(showYears(catalog).map((y) => Number(y.year)));
    const years = submenuOf(programItems({}).find((i) => i.id === "years")!)!;
    expect(years.map((y) => y.action)).toEqual(SHOW_YEARS.map((y) => ({ kind: "route", href: `/shows/${y}` })));
    expect(years.every((y) => y.era)).toBe(true);
    expect(years.find((y) => y.label === "1997")!.era).toBe("peak");
  });

  it("Guests lists the 20 guests with the most shows, host aside, A to Z", () => {
    const top = [...catalog.guests.values()]
      .filter((g) => g.slug !== "art-bell")
      .sort((a, b) => b.shows.length - a.shows.length || a.name.localeCompare(b.name))
      .slice(0, 20)
      .map((g) => ({ name: g.name, slug: g.slug }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    expect(TOP_GUESTS).toEqual(top);
    const guests = submenuOf(programItems({}).find((i) => i.id === "guests")!)!;
    expect(guests).toHaveLength(20);
    expect(guests[0].action).toEqual({ kind: "route", href: `/guest/${TOP_GUESTS[0].slug}` });
  });

  it("Recent Shows lists the last five, each opening in the Library; none says so", () => {
    const recent = Array.from({ length: 7 }, (_, i) => ({ title: `Show ${i}`, key: `coll--show_${i}` }));
    const items = submenuOf(programItems({ recent }).find((i) => i.id === "recent")!)!;
    expect(labels(items)).toEqual(["Show 0", "Show 1", "Show 2", "Show 3", "Show 4"]);
    expect(items[0].action).toEqual({ kind: "route", href: "/library?show=coll--show_0" });
    const none = submenuOf(programItems({ recent: [] }).find((i) => i.id === "recent")!)!;
    expect(none[0].action).toEqual({ kind: "route", href: "/library" });
  });

  it("Tonight's Shows: the show on the air tunes in, the rest open the program guide", () => {
    const now = Date.UTC(2026, 10, 28, 6, 0);
    const h = 3_600_000;
    const guide = [
      { title: "Earlier", start: now - 4 * h, end: now - 2 * h },
      { title: "On now", start: now - h, end: now + h },
      { title: "Next", start: now + h, end: now + 3 * h },
    ];
    const tonight = tonightEntries(guide, now);
    expect(tonight).toEqual([
      { time: formatStationTime(now - h), title: "On now", onAir: true },
      { time: formatStationTime(now + h), title: "Next", onAir: false },
    ]);
    const items = submenuOf(programItems({ tonight }).find((i) => i.id === "tonight")!)!;
    expect(items[0].action).toEqual({ kind: "tune" });
    expect(items[0].label).toContain("(on the air)");
    expect(items[1].action).toEqual({ kind: "route", href: "/tonight" });
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `S${i}`, start: now + i * h, end: now + (i + 1) * h }));
    expect(tonightEntries(many, now)).toHaveLength(TONIGHT_MAX);
    expect(submenuOf(programItems({}).find((i) => i.id === "tonight")!)![0].action).toEqual({ kind: "route", href: "/tonight" });
  });

  it("keeps every accelerator on the main menu unique, and the programs after Stats", () => {
    const items = startMenuItems({ isAdmin: true, isMobile: false });
    const accels = items.map((i) => i.accel.toLowerCase());
    expect(new Set(accels).size).toBe(accels.length);
    const ids = items.map((i) => i.id);
    expect(ids.slice(ids.indexOf("stats") + 1, ids.indexOf("stats") + 5)).toEqual(["tonight", "recent", "guests", "years"]);
  });

  it("Settings offers Sounds only where they can play, and says whether they are on", () => {
    expect(labels(settingsItems({ isMobile: false }))).toEqual(["Display..."]);
    expect(labels(settingsItems({ isMobile: false, sounds: { supported: false, on: false } }))).toEqual(["Display..."]);
    const off = settingsItems({ isMobile: false, sounds: { supported: true, on: false } }).find((i) => i.id === "sounds")!;
    expect(off.label).toBe("Sounds: Off");
    expect(off.action).toEqual({ kind: "sounds" });
    expect(settingsItems({ isMobile: false, sounds: { supported: true, on: true } }).find((i) => i.id === "sounds")!.label).toBe("Sounds: On");
  });

  it("the Taskbar acts on tune and sounds", () => {
    const bar = read("components/looks/win98/Taskbar.tsx");
    expect(bar).toMatch(/case "tune":\n\s+\/\/[^\n]*\n\s+tuneIn\(\);/);
    expect(bar).toMatch(/case "sounds":\n\s+return sounds\.toggle\(\);/);
  });
});

// ---------------------------------------------------------------- the rest

describe("Tonight, the logbook, the lost signal", () => {
  it("the program guide lights the slot on the air, and none outside the day", () => {
    const slots = [
      { start: 0, end: 10 },
      { start: 10, end: 20 },
    ];
    expect(onAirIndex(slots, 5)).toBe(0);
    expect(onAirIndex(slots, 10)).toBe(1);
    expect(onAirIndex(slots, 20)).toBe(-1);
    const view = read("components/tonight/TonightView.tsx");
    expect(view).toContain("The program guide, midnight to midnight Pacific");
    expect(view).toMatch(/data-slot-start=\{e\.start\}\n\s+data-slot-end=\{e\.end\}/);
    expect(view).toContain('<OnAirMarker listId="hd-tonight-guide" />');
  });

  it("Tonight names no real magazine", () => {
    const text = read("components/tonight/TonightView.tsx") + read("styles/program-guide.css");
    expect(text).not.toMatch(/TV ?Guide|Radio Times/i);
  });

  it("the logbook says the room in a sentence", () => {
    const say = (a: number, b: number) => logbookLine(a, b).join("");
    expect(say(15, 5)).toBe("15 people are in the desert, 5 have the radio on");
    expect(say(1, 1)).toBe("1 person is in the desert, 1 has the radio on");
    expect(say(3, 0)).toBe("3 people are in the desert, nobody has the radio on");
  });

  it("the 404 shows the dial sweeping for a station, and both ways back", () => {
    const page = read("app/[look]/not-found.tsx");
    expect(page).toContain('data-testid="lost-signal"');
    expect(page).toMatch(/<YearDial airDate=\{null\} \/>\s*<span className="hd-tuning-in-sweep" \/>/);
    expect(page).toContain('href="/live"');
    expect(page).toContain('href="/library"');
  });

  it("nothing new blinks faster than once a second or moves without the motion gate", () => {
    const css = read("styles/program-guide.css");
    const gate = css.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(css.slice(0, gate)).not.toMatch(/animation:/);
    for (const m of css.matchAll(/animation:[^;]*?(\d+(?:\.\d+)?)s/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(1);
    expect(renderToStaticMarkup(createElement("span", null, logbookLine(2, 1).join("")))).not.toContain("—");
  });
});
