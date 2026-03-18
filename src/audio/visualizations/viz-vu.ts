/**
 * VU Meters Visualization
 *
 * Two analog-style arc gauges (L/R) with spring-physics needles.
 * L/R simulated by splitting even/odd samples from mono data.
 */

import type { Visualization } from "./types";
import { PHOSPHOR_GREEN, DESERT_AMBER } from "./types";

let cachedDataArray: Uint8Array<ArrayBuffer> | null = null;
let cachedBufferLength = 0;

let needleL = 0;
let needleR = 0;
let velL = 0;
let velR = 0;

const SPRING = 0.3;
const DAMPING = 0.7;
const ARC_START = -Math.PI;
const ARC_END = -0.05;
const ARC_RANGE = ARC_END - ARC_START;

function getDataArray(length: number): Uint8Array<ArrayBuffer> {
  if (!cachedDataArray || cachedBufferLength !== length) {
    cachedDataArray = new Uint8Array(length);
    cachedBufferLength = length;
  }
  return cachedDataArray;
}

function computeRms(
  dataArray: Uint8Array,
  bufferLength: number,
  even: boolean,
): number {
  let sum = 0;
  let count = 0;
  for (let i = even ? 0 : 1; i < bufferLength; i += 2) {
    const v = (dataArray[i] - 128) / 128;
    sum += v * v;
    count++;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

function updateNeedle(
  current: number,
  vel: number,
  target: number,
): [number, number] {
  const force = (target - current) * SPRING;
  const newVel = (vel + force) * DAMPING;
  const newPos = Math.max(0, Math.min(1, current + newVel));
  return [newPos, newVel];
}

function drawGauge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  needleVal: number,
  label: string,
) {
  const tickCount = 15;

  // Draw arc background
  ctx.strokeStyle = "rgba(51, 255, 51, 0.15)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, ARC_START, ARC_END);
  ctx.stroke();

  // Tick marks
  for (let i = 0; i <= tickCount; i++) {
    const pct = i / tickCount;
    const angle = ARC_START + pct * ARC_RANGE;
    const isRed = pct > 0.8;
    const innerR = radius - (i % 3 === 0 ? 12 : 7);

    ctx.strokeStyle = isRed ? "#FF3333" : PHOSPHOR_GREEN;
    ctx.lineWidth = i % 3 === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(
      cx + Math.cos(angle) * innerR,
      cy + Math.sin(angle) * innerR,
    );
    ctx.lineTo(
      cx + Math.cos(angle) * radius,
      cy + Math.sin(angle) * radius,
    );
    ctx.stroke();
  }

  // Needle
  const needleAngle = ARC_START + needleVal * ARC_RANGE;
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2;
  ctx.shadowColor = DESERT_AMBER;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(
    cx + Math.cos(needleAngle) * (radius - 4),
    cy + Math.sin(needleAngle) * (radius - 4),
  );
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Pivot dot
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  // Label
  ctx.fillStyle = PHOSPHOR_GREEN;
  ctx.font = `${Math.max(12, radius * 0.2)}px monospace`;
  ctx.textAlign = "center";
  ctx.fillText(label, cx, cy + radius * 0.35);
}

export const vuMeters: Visualization = {
  id: "vu",
  name: "VU Meter",

  draw(ctx, analyser, w, h) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = getDataArray(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    ctx.clearRect(0, 0, w, h);

    const rmsL = computeRms(dataArray, bufferLength, true);
    const rmsR = computeRms(dataArray, bufferLength, false);

    // Amplify RMS for visual range (typically 0-0.3 for normal audio)
    const targetL = Math.min(1, rmsL * 3);
    const targetR = Math.min(1, rmsR * 3);

    [needleL, velL] = updateNeedle(needleL, velL, targetL);
    [needleR, velR] = updateNeedle(needleR, velR, targetR);

    const gaugeRadius = Math.min(w * 0.22, h * 0.4);
    const gaugeY = h * 0.6;

    drawGauge(ctx, w * 0.28, gaugeY, gaugeRadius, needleL, "L");
    drawGauge(ctx, w * 0.72, gaugeY, gaugeRadius, needleR, "R");
  },

  drawIdle(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);

    const t = Date.now() * 0.001;
    const drift = Math.sin(t * 0.5) * 0.02 + 0.01;

    [needleL, velL] = updateNeedle(needleL, velL, drift);
    [needleR, velR] = updateNeedle(needleR, velR, drift + Math.sin(t * 0.7) * 0.01);

    const gaugeRadius = Math.min(w * 0.22, h * 0.4);
    const gaugeY = h * 0.6;

    drawGauge(ctx, w * 0.28, gaugeY, gaugeRadius, needleL, "L");
    drawGauge(ctx, w * 0.72, gaugeY, gaugeRadius, needleR, "R");
  },
};
