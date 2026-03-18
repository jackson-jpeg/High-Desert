/**
 * Frequency Bars Visualization
 *
 * Classic spectrum analyzer with ~24 segmented bars, color-coded by amplitude.
 * Peak hold dots decay slowly for a professional meter look.
 */

import type { Visualization } from "./types";
import { PHOSPHOR_GREEN, DESERT_AMBER } from "./types";

const BAR_COUNT = 24;

let cachedDataArray: Uint8Array<ArrayBuffer> | null = null;
let cachedBufferLength = 0;
let peakHolds: number[] = [];
let ghostPulses: number[] = [];
let ghostAlphas: number[] = [];

function getDataArray(length: number): Uint8Array<ArrayBuffer> {
  if (!cachedDataArray || cachedBufferLength !== length) {
    cachedDataArray = new Uint8Array(length);
    cachedBufferLength = length;
  }
  return cachedDataArray;
}

function ensurePeaks() {
  if (peakHolds.length !== BAR_COUNT) {
    peakHolds = new Array(BAR_COUNT).fill(0);
  }
}

function getBarValue(
  dataArray: Uint8Array,
  bufferLength: number,
  barIndex: number,
): number {
  const binsPerBar = Math.floor(bufferLength / BAR_COUNT);
  const start = barIndex * binsPerBar;
  let sum = 0;
  for (let i = start; i < start + binsPerBar && i < bufferLength; i++) {
    sum += dataArray[i];
  }
  return sum / binsPerBar / 255;
}

function segmentColor(segY: number, totalSegs: number): string {
  const pct = segY / totalSegs;
  if (pct > 0.85) return "#FF3333";
  if (pct > 0.65) return DESERT_AMBER;
  return PHOSPHOR_GREEN;
}

export const bars: Visualization = {
  id: "bars",
  name: "Frequency Bars",

  draw(ctx, analyser, w, h) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = getDataArray(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    ensurePeaks();

    ctx.clearRect(0, 0, w, h);

    const segH = Math.max(2, Math.floor(h / 40));
    const segGap = Math.max(1, Math.floor(segH / 3));
    const barWidth = Math.floor(w / BAR_COUNT) - 2;
    const totalSegs = Math.floor(h / (segH + segGap));

    for (let i = 0; i < BAR_COUNT; i++) {
      const val = getBarValue(dataArray, bufferLength, i);
      const barHeight = val * h;
      const segs = Math.floor(
        (barHeight / h) * totalSegs,
      );
      const x = i * (barWidth + 2) + 1;

      // Draw segments
      for (let s = 0; s < segs; s++) {
        const y = h - s * (segH + segGap) - segH;
        ctx.fillStyle = segmentColor(s, totalSegs);
        ctx.fillRect(x, y, barWidth, segH);
      }

      // Peak hold
      const peakY = val * h;
      if (peakY > peakHolds[i]) {
        peakHolds[i] = peakY;
      } else {
        peakHolds[i] = Math.max(0, peakHolds[i] - 1);
      }

      if (peakHolds[i] > 0) {
        const py = h - peakHolds[i];
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(x, py, barWidth, 2);
      }
    }
  },

  drawIdle(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);

    if (ghostPulses.length !== BAR_COUNT) {
      ghostPulses = new Array(BAR_COUNT).fill(0);
      ghostAlphas = new Array(BAR_COUNT).fill(0);
    }

    const segH = Math.max(2, Math.floor(h / 40));
    const segGap = Math.max(1, Math.floor(segH / 3));
    const barWidth = Math.floor(w / BAR_COUNT) - 2;
    const totalSegs = Math.floor(h / (segH + segGap));

    // Randomly trigger ghost pulses
    for (let i = 0; i < BAR_COUNT; i++) {
      if (ghostAlphas[i] <= 0 && Math.random() < 0.005) {
        ghostPulses[i] = Math.random() * 0.1 * h;
        ghostAlphas[i] = 0.6;
      }

      if (ghostAlphas[i] > 0) {
        ghostAlphas[i] -= 0.02;
        const segs = Math.floor((ghostPulses[i] / h) * totalSegs);
        const x = i * (barWidth + 2) + 1;

        ctx.globalAlpha = Math.max(0, ghostAlphas[i]);
        for (let s = 0; s < segs; s++) {
          const y = h - s * (segH + segGap) - segH;
          ctx.fillStyle = PHOSPHOR_GREEN;
          ctx.fillRect(x, y, barWidth, segH);
        }
        ctx.globalAlpha = 1;
      }
    }
  },
};
