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

export const PHOSPHOR_GREEN = "#33FF33";
export const GLOW_COLOR = "rgba(51, 255, 51, 0.4)";
export const DESERT_AMBER = "#D4A843";
export const LINE_WIDTH = 2;
export const GLOW_WIDTH = 6;
