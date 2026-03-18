/**
 * Lissajous X-Y Scope Visualization
 *
 * Plots audio data as an X-Y oscilloscope with 90° phase offset.
 * Trail effect via semi-transparent fill. Color shifts with amplitude.
 * Idle draws slowly morphing Lissajous figures.
 */

import type { Visualization } from "./types";
import { PHOSPHOR_GREEN, GLOW_COLOR, DESERT_AMBER } from "./types";

let cachedDataArray: Uint8Array<ArrayBuffer> | null = null;
let cachedBufferLength = 0;

function getDataArray(length: number): Uint8Array<ArrayBuffer> {
  if (!cachedDataArray || cachedBufferLength !== length) {
    cachedDataArray = new Uint8Array(length);
    cachedBufferLength = length;
  }
  return cachedDataArray;
}

/**
 * Interpolate between phosphor green and desert amber based on amplitude.
 * Quiet passages stay green, loud moments flare amber.
 */
function amplitudeColor(energy: number): string {
  // energy 0-1
  const t = Math.min(1, energy * 1.5);
  const r = Math.floor(51 * (1 - t) + 230 * t);
  const g = Math.floor(255 * (1 - t) + 180 * t);
  const b = Math.floor(51 * (1 - t) + 42 * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function amplitudeGlow(energy: number): string {
  const t = Math.min(1, energy * 1.5);
  const r = Math.floor(51 * (1 - t) + 230 * t);
  const g = Math.floor(255 * (1 - t) + 180 * t);
  const b = Math.floor(51 * (1 - t) + 42 * t);
  return `rgba(${r}, ${g}, ${b}, 0.3)`;
}

export const lissajous: Visualization = {
  id: "lissajous",
  name: "Lissajous",

  draw(ctx, analyser, w, h) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = getDataArray(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    // Compute amplitude energy (0-1)
    let maxDeviation = 0;
    for (let i = 0; i < bufferLength; i++) {
      const dev = Math.abs(dataArray[i] - 128);
      if (dev > maxDeviation) maxDeviation = dev;
    }
    const energy = maxDeviation / 128;

    // Faster trail decay when loud, slower when quiet — keeps trace visible
    const trailAlpha = 0.04 + energy * 0.12;
    ctx.fillStyle = `rgba(0, 0, 0, ${trailAlpha})`;
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    // Scale expands slightly with amplitude for a breathing effect
    const baseScale = Math.min(w, h) * 0.4;
    const scale = baseScale * (0.85 + energy * 0.15);
    const phaseOffset = Math.floor(bufferLength / 4);
    const dim = Math.min(w, h);

    const mainColor = amplitudeColor(energy);
    const glowColor = amplitudeGlow(energy);

    // Glow pass
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = Math.max(3, dim * 0.025);
    ctx.beginPath();
    for (let i = 0; i < bufferLength - phaseOffset; i++) {
      const x = cx + ((dataArray[i] - 128) / 128) * scale;
      const y = cy + ((dataArray[i + phaseOffset] - 128) / 128) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Main line
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = Math.max(1, dim * 0.008);
    ctx.shadowColor = mainColor;
    ctx.shadowBlur = 6 + energy * 14;
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
    ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const scale = Math.min(w, h) * 0.3;
    const t = Date.now() * 0.0003;

    const freqX = 2 + Math.sin(t) * 1.5;
    const freqY = 3 + Math.cos(t * 0.7) * 1.5;
    const phase = t * 2;
    const points = 500;
    const dim = Math.min(w, h);

    // Glow
    ctx.strokeStyle = GLOW_COLOR;
    ctx.lineWidth = Math.max(2, dim * 0.02);
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
    ctx.lineWidth = Math.max(1, dim * 0.008);
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
