"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { useRadioDialStore } from "@/stores/radio-dial-store";
import { useTuningGesture } from "@/hooks/useTuningGesture";
import type { StationIndex } from "@/hooks/useRadioDial";

// Colors matching the theme
const COLOR_COAST = "#000080"; // title-bar-blue
const COLOR_DREAMLAND = "#4ADE80"; // static-green
const COLOR_SPECIAL = "#D4A843"; // desert-amber
const COLOR_UNKNOWN = "#808080"; // bevel-dark
const COLOR_YEAR_LABEL = "#D4A843";
const COLOR_MONTH_TICK = "#808080";
const COLOR_NEEDLE = "#FF2020";
const COLOR_STRIP_BG = "#0F1520";

// Throttle to ~30fps on mobile, 60fps on desktop
const MOBILE_FRAME_INTERVAL = 1000 / 30;

function getShowColor(showType: string): string {
  switch (showType) {
    case "coast":
      return COLOR_COAST;
    case "dreamland":
      return COLOR_DREAMLAND;
    case "special":
      return COLOR_SPECIAL;
    default:
      return COLOR_UNKNOWN;
  }
}

interface TuningStripProps {
  index: StationIndex;
  className?: string;
}

export function TuningStrip({ index, className }: TuningStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const position = useRadioDialStore((s) => s.position);
  const zoom = useRadioDialStore((s) => s.zoom);

  // Year label hit areas — use ref for per-frame updates, state for gesture hook
  const hitAreasRef = useRef<{ x: number; width: number; year: number }[]>([]);
  const [yearHitAreas, setYearHitAreas] = useState<
    { x: number; width: number; year: number }[]
  >([]);

  const handleYearClick = useCallback(
    (year: number) => {
      const jan1 = new Date(`${year}-01-01T00:00:00`);
      const dayIdx = Math.round(
        (jan1.getTime() - index.earliest.getTime()) / 86_400_000,
      );
      useRadioDialStore
        .getState()
        .setPosition(Math.max(0, Math.min(dayIdx, index.totalDays)));
    },
    [index],
  );

  useTuningGesture({
    canvasRef,
    totalDays: index.totalDays,
    onYearClick: handleYearClick,
    yearLabelHitAreas: yearHitAreas,
  });

  // Canvas rendering with requestAnimationFrame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const noMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const isMobileDevice = window.matchMedia("(max-width: 767px)").matches;
    let animId: number;
    let lastFrameTime = 0;
    // Sync hit areas to state at most every 200ms (not every frame)
    let lastHitAreaSync = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const render = (time: number) => {
      // Throttle frame rate on mobile
      if (isMobileDevice) {
        const elapsed = time - lastFrameTime;
        if (elapsed < MOBILE_FRAME_INTERVAL) {
          animId = requestAnimationFrame(render);
          return;
        }
        lastFrameTime = time - (elapsed % MOBILE_FRAME_INTERVAL);
      }

      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;
      if (w === 0 || h === 0) {
        animId = requestAnimationFrame(render);
        return;
      }

      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = COLOR_STRIP_BG;
      ctx.fillRect(0, 0, w, h);

      // Subtle gradient overlay
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgba(8, 12, 22, 0.5)");
      grad.addColorStop(0.5, "rgba(8, 12, 22, 0)");
      grad.addColorStop(1, "rgba(8, 12, 22, 0.5)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const centerX = w / 2;
      const pos = useRadioDialStore.getState().position;
      const pxPerDay = useRadioDialStore.getState().zoom || 2;
      const tickAreaTop = 8;
      const tickAreaBottom = h - 24;
      const tickHeight = tickAreaBottom - tickAreaTop;

      // Guard against non-finite values
      if (!Number.isFinite(pos) || !Number.isFinite(pxPerDay) || tickHeight <= 0) {
        animId = requestAnimationFrame(render);
        return;
      }

      // Viewport in days
      const viewDaysHalf = (w / 2) / pxPerDay;
      const viewStart = pos - viewDaysHalf;
      const viewEnd = pos + viewDaysHalf;

      // --- Year labels and month ticks ---
      const hitAreas: { x: number; width: number; year: number }[] = [];

      for (const year of index.years) {
        const jan1 = new Date(`${year}-01-01T00:00:00`);
        const yearDay =
          (jan1.getTime() - index.earliest.getTime()) / 86_400_000;

        // Month ticks
        for (let m = 0; m < 12; m++) {
          const monthDate = new Date(year, m, 1);
          const monthDay =
            (monthDate.getTime() - index.earliest.getTime()) / 86_400_000;
          if (monthDay < viewStart - 50 || monthDay > viewEnd + 50) continue;

          const x = centerX + (monthDay - pos) * pxPerDay;
          ctx.beginPath();
          ctx.moveTo(x, tickAreaBottom);
          ctx.lineTo(x, tickAreaBottom + 4);
          ctx.strokeStyle =
            m === 0 ? COLOR_YEAR_LABEL + "88" : COLOR_MONTH_TICK + "44";
          ctx.lineWidth = m === 0 ? 1.5 : 0.5;
          ctx.stroke();
        }

        // Year label
        if (yearDay < viewStart - 200 || yearDay > viewEnd + 200) continue;
        const x = centerX + (yearDay - pos) * pxPerDay;

        ctx.font = "9px W95FA, monospace";
        ctx.fillStyle = COLOR_YEAR_LABEL + "AA";
        ctx.textAlign = "center";
        ctx.fillText(String(year), x, h - 4);

        const textWidth = ctx.measureText(String(year)).width;
        hitAreas.push({ x: x - textWidth / 2, width: textWidth, year });
      }

      // Store hit areas in ref (no re-render) and throttle state sync
      hitAreasRef.current = hitAreas;
      if (time - lastHitAreaSync > 200) {
        lastHitAreaSync = time;
        setYearHitAreas(hitAreas);
      }

      // --- Episode tick marks ---
      // Only render stations within viewport
      const startIdx = binarySearchLower(index.stations, viewStart - 5);
      const endIdx = binarySearchUpper(index.stations, viewEnd + 5);

      for (let i = startIdx; i <= endIdx && i < index.stations.length; i++) {
        const station = index.stations[i];
        const x = centerX + (station.dayIndex - pos) * pxPerDay;

        if (x < -10 || x > w + 10) continue;

        const color = getShowColor(station.showType);
        const notable = station.isNotable;
        const baseHeight = notable ? tickHeight * 0.7 : tickHeight * 0.35;
        const tickTop = tickAreaTop + (tickHeight - baseHeight) / 2;

        ctx.beginPath();
        ctx.moveTo(x, tickTop);
        ctx.lineTo(x, tickTop + baseHeight);
        ctx.strokeStyle = color;
        ctx.lineWidth = notable ? 2 : 1.5;
        ctx.globalAlpha = 0.8;
        ctx.stroke();

        // Subtle glow for notable episodes
        if (notable && !noMotion) {
          ctx.beginPath();
          ctx.moveTo(x, tickTop);
          ctx.lineTo(x, tickTop + baseHeight);
          ctx.strokeStyle = color;
          ctx.lineWidth = 4;
          ctx.globalAlpha = 0.15 + Math.sin(time * 0.002) * 0.05;
          ctx.stroke();
        }

        ctx.globalAlpha = 1;
      }

      // --- Center needle ---
      // Subtle glow
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, h - 20);
      ctx.strokeStyle = "rgba(255, 32, 32, 0.15)";
      ctx.lineWidth = 6;
      ctx.stroke();

      // Main needle line
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, h - 20);
      ctx.strokeStyle = COLOR_NEEDLE;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = noMotion ? 0.9 : 0.8 + Math.sin(time * 0.003) * 0.1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Needle triangle indicator at top
      ctx.beginPath();
      ctx.moveTo(centerX - 5, 0);
      ctx.lineTo(centerX + 5, 0);
      ctx.lineTo(centerX, 6);
      ctx.closePath();
      ctx.fillStyle = COLOR_NEEDLE;
      ctx.fill();

      // --- Signal lock indicator (glow around needle when locked) ---
      const sig = useRadioDialStore.getState().signalStrength;
      if (sig > 0.5) {
        ctx.beginPath();
        ctx.moveTo(centerX, 0);
        ctx.lineTo(centerX, h - 20);
        ctx.strokeStyle = `rgba(51, 255, 51, ${(sig - 0.5) * 0.3})`;
        ctx.lineWidth = 8;
        ctx.stroke();
      }

      animId = requestAnimationFrame(render);
    };

    resize();
    animId = requestAnimationFrame(render);
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, [index, zoom]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", cursor: "grab", touchAction: "none" }}
      role="slider"
      aria-label="Radio tuning dial"
      aria-valuemin={0}
      aria-valuemax={index.totalDays}
      aria-valuenow={Math.round(position)}
      tabIndex={0}
    />
  );
}

// Binary search helpers for viewport culling
function binarySearchLower(
  stations: { dayIndex: number }[],
  targetDay: number,
): number {
  let lo = 0;
  let hi = stations.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (stations[mid].dayIndex < targetDay) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

function binarySearchUpper(
  stations: { dayIndex: number }[],
  targetDay: number,
): number {
  let lo = 0;
  let hi = stations.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (stations[mid].dayIndex <= targetDay) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(stations.length - 1, lo);
}
