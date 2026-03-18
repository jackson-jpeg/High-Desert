import type { Visualization } from "./types";
import { oscilloscope } from "./viz-oscilloscope";
import { bars } from "./viz-bars";
import { waterfall } from "./viz-waterfall";
import { vuMeters } from "./viz-vu";
import { lissajous } from "./viz-lissajous";
import { radar } from "./viz-radar";
import { starfield } from "./viz-starfield";
import { milkdrop } from "./viz-milkdrop";

export const VISUALIZATIONS: Visualization[] = [
  oscilloscope,
  bars,
  waterfall,
  vuMeters,
  lissajous,
  radar,
  starfield,
  milkdrop,
];

export function getVisualization(id: string): Visualization {
  return VISUALIZATIONS.find((v) => v.id === id) ?? VISUALIZATIONS[0];
}

export function nextVisualization(currentId: string): Visualization {
  const idx = VISUALIZATIONS.findIndex((v) => v.id === currentId);
  return VISUALIZATIONS[(idx + 1) % VISUALIZATIONS.length];
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
