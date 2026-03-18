/**
 * Desert Starfield Visualization
 *
 * Stars drift and twinkle driven by audio energy bands.
 * Bass drives speed, treble drives twinkle, loud bass triggers shooting stars.
 */

import type { Visualization } from "./types";
import { PHOSPHOR_GREEN, DESERT_AMBER } from "./types";

let cachedDataArray: Uint8Array<ArrayBuffer> | null = null;
let cachedBufferLength = 0;

interface Star {
  x: number;
  y: number;
  size: number;
  speed: number;
  phase: number;
}

let stars: Star[] = [];
let lastW = 0;
let lastH = 0;

function getDataArray(length: number): Uint8Array<ArrayBuffer> {
  if (!cachedDataArray || cachedBufferLength !== length) {
    cachedDataArray = new Uint8Array(length);
    cachedBufferLength = length;
  }
  return cachedDataArray;
}

function initStars(w: number, h: number) {
  if (stars.length === 60 && lastW === w && lastH === h) return;
  stars = [];
  for (let i = 0; i < 60; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      size: Math.random() * 2 + 0.5,
      speed: Math.random() * 0.5 + 0.2,
      phase: Math.random() * Math.PI * 2,
    });
  }
  lastW = w;
  lastH = h;
}

function bandEnergy(
  dataArray: Uint8Array,
  start: number,
  end: number,
): number {
  let sum = 0;
  const count = end - start;
  for (let i = start; i < end; i++) {
    sum += dataArray[i];
  }
  return count > 0 ? sum / count / 255 : 0;
}

export const starfield: Visualization = {
  id: "starfield",
  name: "Starfield",

  draw(ctx, analyser, w, h) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = getDataArray(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    initStars(w, h);

    // Trail
    ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
    ctx.fillRect(0, 0, w, h);

    const bass = bandEnergy(dataArray, 0, Math.min(100, bufferLength));
    const treble = bandEnergy(
      dataArray,
      Math.min(400, bufferLength),
      bufferLength,
    );
    const t = Date.now() * 0.001;

    // Draw stars
    for (const star of stars) {
      star.x += star.speed * (1 + bass * 3);
      if (star.x > w) {
        star.x = 0;
        star.y = Math.random() * h;
      }

      const twinkle =
        Math.sin(t * star.speed * 3 + star.phase) * 0.5 + 0.5;
      const alpha = 0.3 + twinkle * 0.7 * (0.3 + treble * 0.7);

      ctx.fillStyle = `rgba(51, 255, 51, ${alpha})`;
      ctx.shadowColor = PHOSPHOR_GREEN;
      ctx.shadowBlur = star.size * 3;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Shooting stars on loud bass
    if (bass > 0.7) {
      const sx = Math.random() * w * 0.8;
      const sy = Math.random() * h * 0.3;
      const len = 30 + Math.random() * 40;

      ctx.strokeStyle = DESERT_AMBER;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = DESERT_AMBER;
      ctx.shadowBlur = 8;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + len, sy + len * 0.4);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
  },

  drawIdle(ctx, w, h) {
    initStars(w, h);

    // Trail
    ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
    ctx.fillRect(0, 0, w, h);

    const t = Date.now() * 0.001;

    for (const star of stars) {
      star.x += star.speed * 0.3;
      if (star.x > w) {
        star.x = 0;
        star.y = Math.random() * h;
      }

      const twinkle =
        Math.sin(t * star.speed * 2 + star.phase) * 0.5 + 0.5;
      const alpha = 0.2 + twinkle * 0.4;

      ctx.fillStyle = `rgba(51, 255, 51, ${alpha})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};
