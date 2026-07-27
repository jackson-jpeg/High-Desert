import type { Visualization } from "./types";
import { oscilloscope } from "./viz-oscilloscope";
import { milkdrop } from "./viz-milkdrop";

/**
 * Visualisation registry.
 *
 * All eight renderers used to be imported statically, which pulled ~1,200
 * lines of canvas code into the always-mounted player even though exactly one
 * is ever drawn. The two defaults stay eager — `oscilloscope` everywhere,
 * `milkdrop` on iOS (see isIOSDevice in useOscilloscope) — so the first frame
 * never waits on a network round trip. The other six load on demand.
 *
 * `getVisualization` remains synchronous because it is called from inside the
 * draw loop. When a renderer has not loaded yet it returns the default and
 * starts the import, so the canvas shows the default for a frame or two rather
 * than going blank.
 */

export interface VizMeta {
  id: string;
  name: string;
}

/** Order defines the cycle order when clicking the oscilloscope. */
export const VISUALIZATION_META: VizMeta[] = [
  { id: "oscilloscope", name: "Oscilloscope" },
  { id: "bars", name: "Frequency Bars" },
  { id: "waterfall", name: "Waterfall" },
  { id: "vu", name: "VU Meter" },
  { id: "lissajous", name: "Lissajous" },
  { id: "radar", name: "Radar" },
  { id: "starfield", name: "Starfield" },
  { id: "milkdrop", name: "Milkdrop" },
];

const DEFAULT_ID = "oscilloscope";

const loaders: Record<string, () => Promise<Visualization>> = {
  oscilloscope: async () => oscilloscope,
  milkdrop: async () => milkdrop,
  bars: () => import("./viz-bars").then((m) => m.bars),
  waterfall: () => import("./viz-waterfall").then((m) => m.waterfall),
  vu: () => import("./viz-vu").then((m) => m.vuMeters),
  lissajous: () => import("./viz-lissajous").then((m) => m.lissajous),
  radar: () => import("./viz-radar").then((m) => m.radar),
  starfield: () => import("./viz-starfield").then((m) => m.starfield),
};

const cache = new Map<string, Visualization>([
  [oscilloscope.id, oscilloscope],
  [milkdrop.id, milkdrop],
]);

const inFlight = new Map<string, Promise<Visualization>>();

/**
 * Load and cache a renderer. Safe to call repeatedly — concurrent calls for
 * the same id share a single import, and a failed chunk fetch resolves to the
 * default rather than rejecting, so playback rendering can never break.
 */
export function ensureVisualization(id: string): Promise<Visualization> {
  const cached = cache.get(id);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(id);
  if (pending) return pending;

  const load = loaders[id];
  if (!load) return Promise.resolve(cache.get(DEFAULT_ID)!);

  const p = load()
    .then((viz) => {
      cache.set(id, viz);
      inFlight.delete(id);
      return viz;
    })
    .catch(() => {
      inFlight.delete(id);
      return cache.get(DEFAULT_ID)!;
    });

  inFlight.set(id, p);
  return p;
}

/**
 * Synchronous accessor for the draw loop. Returns the default while a
 * not-yet-loaded renderer is being fetched.
 */
export function getVisualization(id: string): Visualization {
  const hit = cache.get(id);
  if (hit) return hit;
  void ensureVisualization(id);
  return cache.get(DEFAULT_ID)!;
}

/** Display name without needing the renderer itself. */
export function getVizName(id: string): string {
  return VISUALIZATION_META.find((v) => v.id === id)?.name ?? VISUALIZATION_META[0].name;
}

export function nextVisualization(currentId: string): VizMeta {
  const idx = VISUALIZATION_META.findIndex((v) => v.id === currentId);
  return VISUALIZATION_META[(idx + 1) % VISUALIZATION_META.length];
}

export type { Visualization } from "./types";
export {
  PHOSPHOR_GREEN,
  GLOW_COLOR,
  DESERT_AMBER,
  LINE_WIDTH,
  GLOW_WIDTH,
} from "./types";
export { drawStatic } from "./static";
