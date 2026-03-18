/**
 * Area 51 Radar Visualization
 *
 * Rotating sweep beam with frequency-driven blips on a military radar display.
 * Range rings, crosshair, and blip persistence create an authentic look.
 */

import type { Visualization } from "./types";
import { PHOSPHOR_GREEN } from "./types";

let cachedDataArray: Uint8Array<ArrayBuffer> | null = null;
let cachedBufferLength = 0;

interface Blip {
  angle: number;
  dist: number;
  brightness: number;
}

let blips: Blip[] = [];

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
  for (const pct of [0.33, 0.66, 1]) {
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
}

function drawSweep(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  angle: number,
) {
  // Trail arc behind sweep
  const trailWidth = 0.6;
  ctx.fillStyle = "rgba(51, 255, 51, 0.04)";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, angle - trailWidth, angle);
  ctx.closePath();
  ctx.fill();

  // Sweep line
  ctx.strokeStyle = PHOSPHOR_GREEN;
  ctx.lineWidth = 2;
  ctx.shadowColor = PHOSPHOR_GREEN;
  ctx.shadowBlur = 10;
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

    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.42;
    const t = Date.now() * 0.001;
    const sweepAngle = (t * 0.8) % (Math.PI * 2);

    drawRadarBase(ctx, cx, cy, radius);

    // Find top 20 frequency peaks
    const peaks: { bin: number; amp: number }[] = [];
    for (let i = 2; i < bufferLength - 2; i++) {
      if (
        dataArray[i] > dataArray[i - 1] &&
        dataArray[i] > dataArray[i + 1] &&
        dataArray[i] > 80
      ) {
        peaks.push({ bin: i, amp: dataArray[i] });
      }
    }
    peaks.sort((a, b) => b.amp - a.amp);
    const topPeaks = peaks.slice(0, 20);

    // Refresh blips when sweep crosses their angle
    for (const peak of topPeaks) {
      const bAngle =
        (peak.bin / bufferLength) * Math.PI * 2;
      const bDist = (peak.amp / 255) * 0.85 + 0.1;

      // Check if sweep just crossed this angle
      const angleDiff = ((sweepAngle - bAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      if (angleDiff < 0.15) {
        // Find existing or add new
        const existing = blips.find(
          (b) => Math.abs(b.angle - bAngle) < 0.1,
        );
        if (existing) {
          existing.brightness = 1;
          existing.dist = bDist;
        } else {
          blips.push({ angle: bAngle, dist: bDist, brightness: 1 });
        }
      }
    }

    // Decay and draw blips
    blips = blips.filter((b) => {
      b.brightness -= 0.008;
      return b.brightness > 0;
    });

    for (const blip of blips) {
      const bx = cx + Math.cos(blip.angle) * blip.dist * radius;
      const by = cy + Math.sin(blip.angle) * blip.dist * radius;
      ctx.fillStyle = `rgba(51, 255, 51, ${blip.brightness})`;
      ctx.shadowColor = PHOSPHOR_GREEN;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(bx, by, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    drawSweep(ctx, cx, cy, radius, sweepAngle);
  },

  drawIdle(ctx, w, h) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.42;
    const t = Date.now() * 0.001;
    const sweepAngle = (t * 0.8) % (Math.PI * 2);

    drawRadarBase(ctx, cx, cy, radius);
    drawSweep(ctx, cx, cy, radius, sweepAngle);

    // Clear blips in idle
    blips = [];
  },
};
