/**
 * Area 51 Radar Visualization
 *
 * Rotating sweep beam with frequency-driven blips on a military radar display.
 * Range rings, crosshair, and blip persistence create an authentic look.
 * Sweep speed responds to audio energy — louder = faster sweep.
 */

import type { Visualization } from "./types";
import { PHOSPHOR_GREEN } from "./types";

let cachedDataArray: Uint8Array<ArrayBuffer> | null = null;
let cachedBufferLength = 0;

interface Blip {
  angle: number;
  dist: number;
  brightness: number;
  size: number; // amplitude-scaled blip radius
}

let blips: Blip[] = [];
let sweepAngle = 0;
let lastTime = 0;

function getDataArray(length: number): Uint8Array<ArrayBuffer> {
  if (!cachedDataArray || cachedBufferLength !== length) {
    cachedDataArray = new Uint8Array(length);
    cachedBufferLength = length;
  }
  return cachedDataArray;
}

function drawRadarBase(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
) {
  const dimGreen = "rgba(51, 255, 51, 0.15)";

  // Range rings
  for (const pct of [0.25, 0.5, 0.75, 1]) {
    ctx.strokeStyle = dimGreen;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * pct, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Crosshair
  ctx.strokeStyle = dimGreen;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  // Diagonal crosshairs for extra detail
  const diag = radius * 0.707; // cos(45°)
  ctx.strokeStyle = "rgba(51, 255, 51, 0.07)";
  ctx.beginPath();
  ctx.moveTo(cx - diag, cy - diag);
  ctx.lineTo(cx + diag, cy + diag);
  ctx.moveTo(cx + diag, cy - diag);
  ctx.lineTo(cx - diag, cy + diag);
  ctx.stroke();
}

function drawSweep(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  angle: number,
  energy: number,
) {
  // Gradient trail arc behind sweep — wider and brighter with more energy
  const trailWidth = 0.5 + energy * 0.4;
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const frac = i / steps;
    const alpha = (1 - frac) * (0.06 + energy * 0.04);
    ctx.fillStyle = `rgba(51, 255, 51, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const startAngle = angle - trailWidth * frac;
    const endAngle = angle - trailWidth * (frac + 1 / steps);
    ctx.arc(cx, cy, radius, endAngle, startAngle);
    ctx.closePath();
    ctx.fill();
  }

  // Sweep line — glow scales with energy
  ctx.strokeStyle = PHOSPHOR_GREEN;
  ctx.lineWidth = 2;
  ctx.shadowColor = PHOSPHOR_GREEN;
  ctx.shadowBlur = 8 + energy * 12;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(
    cx + Math.cos(angle) * radius,
    cy + Math.sin(angle) * radius,
  );
  ctx.stroke();
  ctx.shadowBlur = 0;
}

export const radar: Visualization = {
  id: "radar",
  name: "Radar",

  draw(ctx, analyser, w, h) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = getDataArray(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Compute overall energy (0-1)
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
    const energy = Math.min(1, (sum / bufferLength / 255) * 2.5);

    ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.42;
    const blipRadius = Math.max(2, Math.min(w, h) * 0.015);

    // Audio-reactive sweep speed: 0.5-2.0 radians/sec
    const now = Date.now() * 0.001;
    const dt = lastTime ? now - lastTime : 0.016;
    lastTime = now;
    const sweepSpeed = 0.6 + energy * 1.4;
    sweepAngle = (sweepAngle + sweepSpeed * dt) % (Math.PI * 2);

    drawRadarBase(ctx, cx, cy, radius);

    // Find top 30 frequency peaks — use more of the spectrum
    const peaks: { bin: number; amp: number }[] = [];
    for (let i = 2; i < bufferLength - 2; i++) {
      if (
        dataArray[i] > dataArray[i - 1] &&
        dataArray[i] > dataArray[i + 1] &&
        dataArray[i] > 50 // lower threshold to catch more detail
      ) {
        peaks.push({ bin: i, amp: dataArray[i] });
      }
    }
    peaks.sort((a, b) => b.amp - a.amp);
    const topPeaks = peaks.slice(0, 30);

    // Refresh blips when sweep crosses their angle
    for (const peak of topPeaks) {
      const bAngle = (peak.bin / bufferLength) * Math.PI * 2;
      const bDist = (peak.amp / 255) * 0.8 + 0.15;
      const bSize = (peak.amp / 255) * blipRadius * 1.5 + blipRadius * 0.5;

      const angleDiff = ((sweepAngle - bAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      if (angleDiff < 0.2) {
        const existing = blips.find(
          (b) => Math.abs(b.angle - bAngle) < 0.1,
        );
        if (existing) {
          existing.brightness = 1;
          existing.dist = bDist;
          existing.size = bSize;
        } else {
          blips.push({ angle: bAngle, dist: bDist, brightness: 1, size: bSize });
        }
      }
    }

    // Decay and draw blips
    blips = blips.filter((b) => {
      b.brightness -= 0.006;
      return b.brightness > 0;
    });

    for (const blip of blips) {
      const bx = cx + Math.cos(blip.angle) * blip.dist * radius;
      const by = cy + Math.sin(blip.angle) * blip.dist * radius;

      // Outer glow ring
      if (blip.brightness > 0.5) {
        ctx.strokeStyle = `rgba(51, 255, 51, ${(blip.brightness - 0.5) * 0.4})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(bx, by, blip.size * 2, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Main blip
      ctx.fillStyle = `rgba(51, 255, 51, ${blip.brightness})`;
      ctx.shadowColor = PHOSPHOR_GREEN;
      ctx.shadowBlur = blip.size * 2;
      ctx.beginPath();
      ctx.arc(bx, by, blip.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    drawSweep(ctx, cx, cy, radius, sweepAngle, energy);

    // Center dot
    ctx.fillStyle = PHOSPHOR_GREEN;
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();
  },

  drawIdle(ctx, w, h) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.42;
    const now = Date.now() * 0.001;
    const dt = lastTime ? now - lastTime : 0.016;
    lastTime = now;
    sweepAngle = (sweepAngle + 0.5 * dt) % (Math.PI * 2);

    drawRadarBase(ctx, cx, cy, radius);
    drawSweep(ctx, cx, cy, radius, sweepAngle, 0);

    // Center dot
    ctx.fillStyle = PHOSPHOR_GREEN;
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();

    blips = [];
  },
};
