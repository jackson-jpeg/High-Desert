/**
 * Spectrum Waterfall Visualization
 *
 * Frequency data scrolls vertically — newest at top, oldest fading below.
 * Uses an ImageData buffer shifted down each frame.
 */

import type { Visualization } from "./types";
import { PHOSPHOR_GREEN, DESERT_AMBER } from "./types";

let cachedDataArray: Uint8Array<ArrayBuffer> | null = null;
let cachedBufferLength = 0;
let imageBuffer: ImageData | null = null;
let bufferW = 0;
let bufferH = 0;

function getDataArray(length: number): Uint8Array<ArrayBuffer> {
  if (!cachedDataArray || cachedBufferLength !== length) {
    cachedDataArray = new Uint8Array(length);
    cachedBufferLength = length;
  }
  return cachedDataArray;
}

function ensureBuffer(w: number, h: number): ImageData {
  if (!imageBuffer || bufferW !== w || bufferH !== h) {
    imageBuffer = new ImageData(w, h);
    bufferW = w;
    bufferH = h;
  }
  return imageBuffer;
}

// Parse hex color to RGB
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const greenRgb = hexToRgb(PHOSPHOR_GREEN);
const amberRgb = hexToRgb(DESERT_AMBER);

function freqColor(
  val: number,
): [number, number, number] {
  // Interpolate from dark green to bright amber
  const t = val / 255;
  return [
    Math.floor(greenRgb[0] * (1 - t) * 0.3 + amberRgb[0] * t),
    Math.floor(greenRgb[1] * (1 - t) * 0.3 + amberRgb[1] * t),
    Math.floor(greenRgb[2] * (1 - t) * 0.3 + amberRgb[2] * t),
  ];
}

export const waterfall: Visualization = {
  id: "waterfall",
  name: "Waterfall",

  draw(ctx, analyser, w, h) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = getDataArray(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const buf = ensureBuffer(w, h);
    const data = buf.data;

    // Shift buffer down by 1 pixel row
    // Copy from bottom to top to avoid overwriting
    for (let y = h - 1; y > 0; y--) {
      const dstOffset = y * w * 4;
      const srcOffset = (y - 1) * w * 4;
      for (let x = 0; x < w * 4; x++) {
        data[dstOffset + x] = data[srcOffset + x];
      }
    }

    // Draw new frequency line at top row
    for (let x = 0; x < w; x++) {
      const binIndex = Math.floor((x / w) * bufferLength);
      const val = dataArray[binIndex];
      const [r, g, b] = freqColor(val);
      const offset = x * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }

    ctx.putImageData(buf, 0, 0);
  },

  drawIdle(ctx, w, h) {
    const buf = ensureBuffer(w, h);
    const data = buf.data;

    // Fade existing content toward black
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.floor(data[i] * 0.98);
      data[i + 1] = Math.floor(data[i + 1] * 0.98);
      data[i + 2] = Math.floor(data[i + 2] * 0.98);
      // Keep alpha at 255
    }

    ctx.putImageData(buf, 0, 0);
  },
};
