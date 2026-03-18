import type { Visualization } from "./types";
import { oscilloscope } from "./viz-oscilloscope";

/** Create a placeholder visualization that draws nothing */
function placeholder(id: string, name: string): Visualization {
  return {
    id,
    name,
    draw() {},
    drawIdle() {},
  };
}

export const VISUALIZATIONS: Visualization[] = [
  oscilloscope,
  placeholder("bars", "Frequency Bars"),
  placeholder("waterfall", "Waterfall"),
  placeholder("vu", "VU Meter"),
  placeholder("lissajous", "Lissajous"),
  placeholder("radar", "Radar"),
  placeholder("starfield", "Starfield"),
  placeholder("milkdrop", "Milkdrop"),
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
