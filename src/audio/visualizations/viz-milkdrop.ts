/**
 * Milkdrop Lite Visualization
 *
 * Expanding, wobbling rings emanate from center, driven by mid-frequency energy.
 * Inspired by the classic Winamp Milkdrop preset aesthetic.
 */

import type { Visualization } from "./types";
import { PHOSPHOR_GREEN } from "./types";

let cachedDataArray: Uint8Array<ArrayBuffer> | null = null;
let cachedBufferLength = 0;

interface Ring {
  radius: number;
  spawnTime: number;
}

let rings: Ring[] = [];
let frameCount = 0;
let lastTime = 0;

function getDataArray(length: number): Uint8Array<ArrayBuffer> {
  if (!cachedDataArray || cachedBufferLength !== length) {
    cachedDataArray = new Uint8Array(length);
    cachedBufferLength = length;
  }
  return cachedDataArray;
}

function midEnergy(dataArray: Uint8Array, bufferLength: number): number {
  const start = Math.min(100, bufferLength);
  const end = Math.min(400, bufferLength);
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += dataArray[i];
  }
  return (end - start) > 0 ? sum / (end - start) / 255 : 0;
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  wobbleAmp: number,
  alpha: number,
  t: number,
) {
  const points = 80;
  ctx.strokeStyle = `rgba(51, 255, 51, ${alpha})`;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = PHOSPHOR_GREEN;
  ctx.shadowBlur = 4 * alpha;
  ctx.beginPath();

  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const r = radius + Math.sin(angle * 3 + t) * wobbleAmp;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.stroke();
  ctx.shadowBlur = 0;
}

export const milkdrop: Visualization = {
  id: "milkdrop",
  name: "Milkdrop",

  draw(ctx, analyser, w, h) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = getDataArray(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Trail
    ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
    ctx.fillRect(0, 0, w, h);

    const now = Date.now();
    const dt = lastTime ? (now - lastTime) / 1000 : 0.016;
    lastTime = now;

    const cx = w / 2;
    const cy = h / 2;
    const maxRadius = Math.sqrt(cx * cx + cy * cy);
    const mid = midEnergy(dataArray, bufferLength);
    const wobbleAmp = mid * 15;
    const t = now * 0.002;

    // Spawn new ring every ~40 frames
    frameCount++;
    if (frameCount % 40 === 0) {
      rings.push({ radius: 0, spawnTime: now });
    }

    // Update and draw rings
    rings = rings.filter((ring) => {
      ring.radius += 30 * dt;
      if (ring.radius > maxRadius) return false;

      const alpha = 1 - ring.radius / maxRadius;
      drawRing(ctx, cx, cy, ring.radius, wobbleAmp, alpha, t);
      return true;
    });
  },

  drawIdle(ctx, w, h) {
    // Trail
    ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
    ctx.fillRect(0, 0, w, h);

    const now = Date.now();
    const dt = lastTime ? (now - lastTime) / 1000 : 0.016;
    lastTime = now;

    const cx = w / 2;
    const cy = h / 2;
    const maxRadius = Math.sqrt(cx * cx + cy * cy);
    const t = now * 0.002;

    // Spawn rings at same rate
    frameCount++;
    if (frameCount % 40 === 0) {
      rings.push({ radius: 0, spawnTime: now });
    }

    rings = rings.filter((ring) => {
      ring.radius += 30 * dt;
      if (ring.radius > maxRadius) return false;

      const alpha = 1 - ring.radius / maxRadius;
      drawRing(ctx, cx, cy, ring.radius, 3, alpha, t);
      return true;
    });
  },
};
