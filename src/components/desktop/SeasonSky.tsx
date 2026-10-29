"use client";

import { useEffect, useRef } from "react";
import { useSeason } from "@/hooks/useSeason";
import type { Season } from "@/lib/season/season";

/**
 * The holiday sky (docs/seasons.md): bats for Halloween, falling leaves for
 * Thanksgiving, snow for Christmas and winter. A fixed, full-screen canvas
 * that never takes a tap. In Night it sits in the sky behind the glass, with
 * the starfield; in Win98 the windows cover the desktop, so it drifts over
 * them like the desktop snow of the day, a few at a time (look-win98.css).
 *
 * Nothing at all with reduced motion asked for, nothing while the tab is
 * hidden, and nothing outside a season.
 */

interface Flake {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  phase: number;
  spin: number;
  hue: number;
}

/** How many at once, by season: [desktop, phone]. Win98 draws a third of them over its windows. */
export const SKY_COUNT: Record<Season, readonly [number, number]> = {
  halloween: [12, 6],
  thanksgiving: [22, 10],
  winter: [90, 40],
};

// Canvas cannot read var(); these are tints of the palette's own colours.
const LEAF_COLORS = ["rgba(200, 98, 26, 0.55)", "rgba(168, 86, 26, 0.55)", "rgba(212, 168, 67, 0.5)", "rgba(150, 52, 30, 0.5)"];
const BAT_COLOR = "rgba(255, 140, 0, 0.62)";

function spawn(season: Season, w: number, h: number, anywhere: boolean): Flake {
  const r = Math.random;
  if (season === "halloween") {
    const right = r() < 0.5;
    return {
      x: anywhere ? r() * w : right ? -40 : w + 40,
      y: h * (0.06 + r() * 0.6),
      size: 10 + r() * 9,
      vx: (0.5 + r() * 0.7) * (right ? 1 : -1),
      vy: (r() - 0.5) * 0.15,
      phase: r() * Math.PI * 2,
      spin: 0.18 + r() * 0.1,
      hue: 0,
    };
  }
  if (season === "thanksgiving") {
    return {
      x: r() * w,
      y: anywhere ? r() * h : -20,
      size: 4 + r() * 4,
      vx: (r() - 0.5) * 0.4,
      vy: 0.35 + r() * 0.45,
      phase: r() * Math.PI * 2,
      spin: (r() - 0.5) * 0.04,
      hue: Math.floor(r() * LEAF_COLORS.length),
    };
  }
  return {
    x: r() * w,
    y: anywhere ? r() * h : -6,
    size: 0.7 + r() * 1.8,
    vx: (r() - 0.5) * 0.2,
    vy: 0.25 + r() * 0.55,
    phase: r() * Math.PI * 2,
    spin: 0.01 + r() * 0.015,
    hue: 0.3 + r() * 0.5,
  };
}

function drawBat(ctx: CanvasRenderingContext2D, f: Flake, t: number) {
  const flap = Math.sin(t * f.spin + f.phase);
  const s = f.size;
  const lift = flap * s * 0.55;
  ctx.save();
  ctx.translate(f.x, f.y);
  if (f.vx < 0) ctx.scale(-1, 1);
  ctx.fillStyle = BAT_COLOR;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  // Left wing, scalloped, then right: a silhouette, flapping.
  ctx.quadraticCurveTo(-s * 0.6, -lift - s * 0.3, -s * 1.4, -lift);
  ctx.quadraticCurveTo(-s, -lift * 0.3 + s * 0.1, -s * 0.9, s * 0.25);
  ctx.quadraticCurveTo(-s * 0.5, s * 0.05, -s * 0.2, s * 0.3);
  ctx.quadraticCurveTo(0, s * 0.15, s * 0.2, s * 0.3);
  ctx.quadraticCurveTo(s * 0.5, s * 0.05, s * 0.9, s * 0.25);
  ctx.quadraticCurveTo(s, -lift * 0.3 + s * 0.1, s * 1.4, -lift);
  ctx.quadraticCurveTo(s * 0.6, -lift - s * 0.3, 0, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, s * 0.05, s * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLeaf(ctx: CanvasRenderingContext2D, f: Flake, t: number) {
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.phase + t * f.spin * 0.05);
  ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(t * 0.002 + f.phase)));
  ctx.fillStyle = LEAF_COLORS[f.hue];
  ctx.beginPath();
  ctx.moveTo(0, -f.size * 1.6);
  ctx.quadraticCurveTo(f.size * 1.2, 0, 0, f.size * 1.6);
  ctx.quadraticCurveTo(-f.size * 1.2, 0, 0, -f.size * 1.6);
  ctx.fill();
  ctx.restore();
}

function drawFlake(ctx: CanvasRenderingContext2D, f: Flake) {
  ctx.beginPath();
  ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(235, 244, 255, ${f.hue})`;
  ctx.fill();
}

export function SeasonSky() {
  const season = useSeason();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!season || !canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const over = document.documentElement.dataset.look === "win98";
    let flakes: Flake[] = [];
    const fill = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const [desk, phone] = SKY_COUNT[season];
      const n = Math.max(1, Math.round((canvas.width < 768 ? phone : desk) / (over ? 3 : 1)));
      flakes = Array.from({ length: n }, () => spawn(season, canvas.width, canvas.height, true));
    };
    fill();

    let lastW = canvas.width;
    const onResize = () => {
      if (window.innerWidth !== lastW) {
        lastW = window.innerWidth;
        fill();
      } else {
        canvas.height = window.innerHeight;
      }
    };

    let raf = 0;
    const frame = (t: number) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i];
        if (season === "halloween") {
          f.x += f.vx;
          f.y += f.vy + Math.sin(t * 0.0012 + f.phase) * 0.25;
          if (f.x < -60 || f.x > w + 60) flakes[i] = spawn(season, w, h, false);
          drawBat(ctx, f, t);
        } else {
          f.x += f.vx + Math.sin(t * 0.001 + f.phase) * (season === "thanksgiving" ? 0.6 : 0.25);
          f.y += f.vy;
          if (f.y > h + 20) flakes[i] = spawn(season, w, h, false);
          if (season === "thanksgiving") drawLeaf(ctx, f, t);
          else drawFlake(ctx, f);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [season]);

  if (!season) return null;
  return (
    <canvas
      ref={canvasRef}
      className="hd-season-sky"
      data-season-sky={season}
      aria-hidden="true"
    />
  );
}
