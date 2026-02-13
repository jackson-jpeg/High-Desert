"use client";

import { useEffect, useRef, useCallback } from "react";

interface Star {
  x: number;
  y: number;
  r: number;
  alpha: number;
  speed: number;
  phase: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

/**
 * Subtle animated desert night sky.
 * Stars twinkle slowly; shooting stars streak across every ~20s.
 * Respects prefers-reduced-motion.
 */
export function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<Star[]>([]);
  const meteorsRef = useRef<Meteor[]>([]);

  const generateStars = useCallback((w: number, h: number) => {
    const density = Math.floor((w * h) / 7000);
    const count = Math.min(density, 280);
    starsRef.current = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.1 + 0.2,
      alpha: Math.random() * 0.25 + 0.04,
      speed: Math.random() * 0.002 + 0.0004,
      phase: Math.random() * Math.PI * 2,
    }));
    meteorsRef.current = [];
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const noMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animId: number;
    let lastMeteorAt = performance.now();
    let nextMeteorIn = 8000 + Math.random() * 12000;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      generateStars(canvas.width, canvas.height);
    };

    const spawnMeteor = () => {
      const goRight = Math.random() > 0.5;
      const x = goRight
        ? Math.random() * canvas.width * 0.6
        : canvas.width * 0.4 + Math.random() * canvas.width * 0.6;
      const y = Math.random() * canvas.height * 0.35;
      const angle = (Math.random() * 25 + 15) * (Math.PI / 180);
      const speed = Math.random() * 4 + 3;
      meteorsRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed * (goRight ? 1 : -1),
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: Math.random() * 35 + 25,
      });
    };

    const render = (time: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw stars
      for (const star of starsRef.current) {
        let a = star.alpha;
        if (!noMotion) {
          a += Math.sin(time * star.speed + star.phase) * star.alpha * 0.7;
        }
        a = Math.max(0.01, Math.min(a, 0.45));

        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(170, 195, 235, ${a})`;
        ctx.fill();
      }

      // Draw shooting stars
      if (!noMotion) {
        if (time - lastMeteorAt > nextMeteorIn) {
          spawnMeteor();
          lastMeteorAt = time;
          nextMeteorIn = 14000 + Math.random() * 22000;
        }

        meteorsRef.current = meteorsRef.current.filter((m) => {
          m.life++;
          m.x += m.vx;
          m.y += m.vy;

          const p = m.life / m.maxLife;
          // Fade in then fade out
          const fade = p < 0.15 ? p / 0.15 : p > 0.6 ? (1 - p) / 0.4 : 1;

          // Trail: several fading segments
          const tailLen = 12;
          for (let s = 0; s < tailLen; s++) {
            const t = s / tailLen;
            const sa = fade * (1 - t) * 0.5;
            if (sa < 0.01) continue;
            const x1 = m.x - m.vx * t * 3;
            const y1 = m.y - m.vy * t * 3;
            const x2 = m.x - m.vx * (t + 1 / tailLen) * 3;
            const y2 = m.y - m.vy * (t + 1 / tailLen) * 3;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = `rgba(210, 225, 255, ${sa})`;
            ctx.lineWidth = 1.5 - t;
            ctx.stroke();
          }

          // Bright head
          ctx.beginPath();
          ctx.arc(m.x, m.y, 1, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${fade * 0.7})`;
          ctx.fill();

          return m.life < m.maxLife;
        });
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
  }, [generateStars]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
}
