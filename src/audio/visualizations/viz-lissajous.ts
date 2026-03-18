/**
 * Lissajous X-Y Scope Visualization
 *
 * Plots audio data as an X-Y oscilloscope with 90° phase offset.
 * Trail effect via semi-transparent fill. Idle draws morphing Lissajous figures.
 */

import type { Visualization } from "./types";
import { PHOSPHOR_GREEN, GLOW_COLOR } from "./types";

let cachedDataArray: Uint8Array<ArrayBuffer> | null = null;
let cachedBufferLength = 0;

function getDataArray(length: number): Uint8Array<ArrayBuffer> {
  if (!cachedDataArray || cachedBufferLength !== length) {
    cachedDataArray = new Uint8Array(length);
    cachedBufferLength = length;
  }
  return cachedDataArray;
}

export const lissajous: Visualization = {
  id: "lissajous",
  name: "Lissajous",

  draw(ctx, analyser, w, h) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = getDataArray(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    // Trail effect
    ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const scale = Math.min(w, h) * 0.4;
    const phaseOffset = Math.floor(bufferLength / 4);

    // Glow
    ctx.strokeStyle = GLOW_COLOR;
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (let i = 0; i < bufferLength - phaseOffset; i++) {
      const x = cx + ((dataArray[i] - 128) / 128) * scale;
      const y = cy + ((dataArray[i + phaseOffset] - 128) / 128) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Main line
    ctx.strokeStyle = PHOSPHOR_GREEN;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = PHOSPHOR_GREEN;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    for (let i = 0; i < bufferLength - phaseOffset; i++) {
      const x = cx + ((dataArray[i] - 128) / 128) * scale;
      const y = cy + ((dataArray[i + phaseOffset] - 128) / 128) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  },

  drawIdle(ctx, w, h) {
    // Trail effect
    ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const scale = Math.min(w, h) * 0.3;
    const t = Date.now() * 0.0003;

    // Slowly morphing frequency ratios
    const freqX = 2 + Math.sin(t) * 1.5;
    const freqY = 3 + Math.cos(t * 0.7) * 1.5;
    const phase = t * 2;

    const points = 500;

    // Glow
    ctx.strokeStyle = GLOW_COLOR;
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const p = (i / points) * Math.PI * 2;
      const x = cx + Math.sin(freqX * p + phase) * scale;
      const y = cy + Math.sin(freqY * p) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Main line
    ctx.strokeStyle = PHOSPHOR_GREEN;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = PHOSPHOR_GREEN;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const p = (i / points) * Math.PI * 2;
      const x = cx + Math.sin(freqX * p + phase) * scale;
      const y = cy + Math.sin(freqY * p) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  },
};
