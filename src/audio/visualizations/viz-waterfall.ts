/**
 * Spectrum Waterfall Visualization
 *
 * Frequency data scrolls vertically — newest at top, oldest fading below.
 * Uses logarithmic frequency scaling to concentrate the interesting voice
 * frequencies (80Hz-4kHz) where they're visible, instead of wasting 75%
 * of the width on inaudible high frequencies.
 */

import type { Visualization } from "./types";

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

/**
 * Map a pixel x-position to a frequency bin using log scale.
 * This makes low frequencies (voice) take up more space.
 */
function logBinIndex(x: number, w: number, binCount: number): number {
  // Map x to [0,1], apply log scale, map to bin
  const minLog = Math.log(1);
  const maxLog = Math.log(binCount);
  const logVal = minLog + (x / w) * (maxLog - minLog);
  return Math.min(binCount - 1, Math.floor(Math.exp(logVal)));
}

/**
 * Color gradient: black → deep blue → phosphor green → amber → white
 * More color variation makes the spectrogram readable and beautiful.
 */
function freqColor(val: number): [number, number, number] {
  if (val < 20) return [0, 0, 0];

  const t = val / 255;

  if (t < 0.25) {
    // Black → deep blue/green
    const s = t / 0.25;
    return [0, Math.floor(s * 30), Math.floor(s * 50)];
  } else if (t < 0.5) {
    // Deep blue/green → phosphor green
    const s = (t - 0.25) / 0.25;
    return [0, Math.floor(30 + s * 225), Math.floor(50 - s * 20)];
  } else if (t < 0.75) {
    // Phosphor green → amber
    const s = (t - 0.5) / 0.25;
    return [Math.floor(s * 230), Math.floor(255 - s * 70), Math.floor(30 * (1 - s))];
  } else {
    // Amber → bright white
    const s = (t - 0.75) / 0.25;
    return [
      Math.floor(230 + s * 25),
      Math.floor(185 + s * 70),
      Math.floor(s * 200),
    ];
  }
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
    for (let y = h - 1; y > 0; y--) {
      const dstOffset = y * w * 4;
      const srcOffset = (y - 1) * w * 4;
      for (let x = 0; x < w * 4; x++) {
        data[dstOffset + x] = data[srcOffset + x];
      }
    }

    // Draw new frequency line at top row — log-scaled
    for (let x = 0; x < w; x++) {
      const binIndex = logBinIndex(x, w, bufferLength);
      // Average a few neighboring bins for smoother look
      const lo = Math.max(0, binIndex - 1);
      const hi = Math.min(bufferLength - 1, binIndex + 1);
      const val = (dataArray[lo] + dataArray[binIndex] + dataArray[hi]) / 3;
      // Boost low values so quiet speech still shows
      const boosted = Math.min(255, val * 1.4);
      const [r, g, b] = freqColor(boosted);
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
    }

    ctx.putImageData(buf, 0, 0);
  },
};
