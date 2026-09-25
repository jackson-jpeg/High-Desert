// Canvas cannot resolve var(): concrete values from the checked palette copy.
import { PALETTE } from "@/lib/palette";

export interface Visualization {
  id: string;
  name: string;
  draw: (
    ctx: CanvasRenderingContext2D,
    analyser: AnalyserNode,
    w: number,
    h: number,
  ) => void;
  drawIdle: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

export const PHOSPHOR_GREEN = PALETTE.greenBright;
export const GLOW_COLOR = "rgba(51, 255, 51, 0.4)";
export const DESERT_AMBER = PALETTE.amber;
/** Over-level: the top segments of the bars and the VU needle past 0 dB. */
export const PEAK_RED = PALETTE.peak;
export const PEAK_WHITE = PALETTE.chromeLighter;
export const LINE_WIDTH = 2;
export const GLOW_WIDTH = 6;
