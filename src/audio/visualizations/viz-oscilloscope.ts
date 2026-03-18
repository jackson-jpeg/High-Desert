/**
 * Oscilloscope Visualization
 *
 * Classic phosphor-green waveform from AnalyserNode time-domain data.
 * Draws a polyline with glow effect, plus a breathing idle line.
 *
 * Typed arrays are cached to avoid per-frame allocation / GC pressure.
 */

import type { Visualization } from "./types";
import { PHOSPHOR_GREEN, GLOW_COLOR, LINE_WIDTH, GLOW_WIDTH } from "./types";

// Cached buffer — reused across frames
let cachedDataArray: Uint8Array<ArrayBuffer> | null = null;
let cachedBufferLength = 0;

function getDataArray(length: number): Uint8Array<ArrayBuffer> {
  if (!cachedDataArray || cachedBufferLength !== length) {
    cachedDataArray = new Uint8Array(length);
    cachedBufferLength = length;
  }
  return cachedDataArray;
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  getY: (x: number) => number,
): void {
  for (let x = 0; x < w; x++) {
    const y = getY(x);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  dataArray: Uint8Array,
  bufferLength: number,
  w: number,
  h: number,
): void {
  const sliceWidth = w / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0; // Normalize 0-255 to 0-2
    const y = (v * h) / 2;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
    x += sliceWidth;
  }
}

export const oscilloscope: Visualization = {
  id: "oscilloscope",
  name: "Oscilloscope",

  draw(ctx, analyser, w, h) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = getDataArray(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    ctx.clearRect(0, 0, w, h);

    // Glow layer (thicker, translucent)
    ctx.lineWidth = GLOW_WIDTH;
    ctx.strokeStyle = GLOW_COLOR;
    ctx.beginPath();
    drawWaveform(ctx, dataArray, bufferLength, w, h);
    ctx.stroke();

    // Main line (sharp, bright)
    ctx.lineWidth = LINE_WIDTH;
    ctx.strokeStyle = PHOSPHOR_GREEN;
    ctx.shadowColor = PHOSPHOR_GREEN;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    drawWaveform(ctx, dataArray, bufferLength, w, h);
    ctx.stroke();

    ctx.shadowBlur = 0;
  },

  drawIdle(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);

    const centerY = h / 2;
    const t = Date.now() * 0.001;
    const breathe = Math.sin(t * 0.8) * 2;

    const getY = (x: number) => {
      const noise =
        (Math.sin(x * 0.05 + t * 3) + Math.sin(x * 0.08 + t * 1.7)) * 0.5;
      return centerY + noise * breathe;
    };

    // Glow
    ctx.lineWidth = GLOW_WIDTH;
    ctx.strokeStyle = GLOW_COLOR;
    ctx.beginPath();
    drawLine(ctx, w, h, getY);
    ctx.stroke();

    // Main line
    ctx.lineWidth = LINE_WIDTH;
    ctx.strokeStyle = PHOSPHOR_GREEN;
    ctx.shadowColor = PHOSPHOR_GREEN;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    drawLine(ctx, w, h, getY);
    ctx.stroke();
    ctx.shadowBlur = 0;
  },
};
