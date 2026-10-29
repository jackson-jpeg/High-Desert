import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The holiday season in the shell (docs/seasons.md): the real DesktopShell,
 * with the real SeasonSky and StatusBar, under each `<html data-season>`.
 * Halloween has no falling sky: the test that it draws nothing is the guard
 * against the flying bats coming back.
 * The sky draws into a recording 2D context (jsdom has no canvas), frames
 * stepped by hand, so "it drew snow" is counted, not assumed. Outside a
 * season (the control) nothing is drawn and the status bar has no greeting.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/library" }));
vi.mock("@/hooks/usePresence", () => ({ usePresence: () => ({ online: 0, listening: 0 }) }));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => undefined }));
vi.mock("@/db", () => ({ db: {}, getPreference: () => new Promise(() => {}), setPreference: async () => {} }));
vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => false, useMediaQuery: () => false }));
vi.mock("@/components/desktop/Starfield", () => ({ Starfield: () => null }));

const { DesktopShell } = await import("@/components/desktop/DesktopShell");
const { SKY_COUNT } = await import("@/components/desktop/SeasonSky");

let root: Root;
let container: HTMLDivElement;
let frames: FrameRequestCallback[] = [];
let drawn: Record<string, number> = {};
let reduceMotion = false;

function fakeContext() {
  const count = (name: string) => () => {
    drawn[name] = (drawn[name] ?? 0) + 1;
  };
  return new Proxy({} as Record<string, unknown>, {
    get: (_t, k: string) => (["arc", "quadraticCurveTo", "fill", "clearRect"].includes(k) ? count(k) : () => {}),
    set: () => true,
  });
}

function mount(season: string | null, look = "night") {
  if (season) document.documentElement.setAttribute("data-season", season);
  else document.documentElement.removeAttribute("data-season");
  document.documentElement.dataset.look = look;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<DesktopShell episodeCount={1413}>{null}</DesktopShell>));
}

/** Run the frames queued so far, `n` times over. */
function step(n = 1) {
  for (let i = 0; i < n; i++) {
    const queued = frames;
    frames = [];
    for (const f of queued) f(1000 + i * 16);
  }
}

beforeEach(() => {
  frames = [];
  drawn = {};
  reduceMotion = false;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
    frames = [];
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(fakeContext as never);
  window.matchMedia = ((q: string) => ({
    matches: q.includes("reduce") ? reduceMotion : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.removeAttribute("data-season");
  vi.restoreAllMocks();
});

const sky = () => document.querySelector("canvas.hd-season-sky");
const greeting = () => document.querySelector("[data-season-greeting]");

describe("the holiday sky", () => {
  it("winter: snow, one flake per arc, the desktop count in Night", () => {
    mount("winter");
    expect(sky()?.getAttribute("data-season-sky")).toBe("winter");
    step(1);
    expect(drawn.arc).toBe(SKY_COUNT.winter[0]);
  });

  it("Win98 draws a third as many, over its windows", () => {
    mount("winter", "win98");
    step(1);
    expect(drawn.arc).toBe(Math.round(SKY_COUNT.winter[0] / 3));
  });

  it("Halloween: nothing moves (its scene is still, HalloweenScene.tsx)", () => {
    mount("halloween");
    step(3);
    expect(sky()).toBeNull();
    expect(drawn).toEqual({});
    expect(frames.length).toBe(0);
  });

  it("Thanksgiving: leaves", () => {
    mount("thanksgiving");
    step(1);
    expect(drawn.quadraticCurveTo).toBe(2 * SKY_COUNT.thanksgiving[0]);
  });

  it("asked for less motion: the canvas stays empty", () => {
    reduceMotion = true;
    mount("winter");
    step(5);
    expect(drawn.arc ?? 0).toBe(0);
  });

  it("stops while the tab is hidden, and starts again when it is back", () => {
    mount("winter");
    step(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.length).toBe(0);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.length).toBe(1);
  });

  it("control: outside a season there is no sky and nothing is drawn", () => {
    mount(null);
    step(3);
    expect(sky()).toBeNull();
    expect(drawn).toEqual({});
  });
});

describe("the status bar's greeting", () => {
  it("Halloween keeps its Ghost to Ghost badge", () => {
    mount("halloween");
    expect(greeting()?.textContent).toBe("Ghost to Ghost");
    // The pumpkin is the pixel one, not an emoji (docs/seasons.md).
    const pumpkin = greeting()?.querySelector('[data-testid="badge-pumpkin"]');
    expect(pumpkin?.getAttribute("shape-rendering")).toBe("crispEdges");
    expect(pumpkin?.querySelectorAll("rect").length).toBeGreaterThan(20);
  });
  it("Thanksgiving and winter say hello, with no em dash", () => {
    mount("thanksgiving");
    expect(greeting()?.textContent).toBe("🦃 Happy Thanksgiving");
    act(() => root.unmount());
    container.remove();
    mount("winter");
    expect(greeting()?.textContent).toBe("❄ Happy holidays");
    expect(greeting()?.textContent).not.toContain("—");
  });
  it("control: no season, no greeting", () => {
    mount(null);
    expect(greeting()).toBeNull();
  });
});
