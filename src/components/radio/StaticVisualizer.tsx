"use client";

import { useRef, useEffect } from "react";

interface StaticVisualizerProps {
  opacity: number; // 0-1
}

/**
 * TV-static canvas overlay rendered at ~15fps.
 * Intensity controlled by opacity prop.
 */
export function StaticVisualizer({ opacity }: StaticVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const noMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (noMotion) {
      // Just show a static noise texture once
      canvas.width = 64;
      canvas.height = 64;
      const imageData = ctx.createImageData(64, 64);
      for (let i = 0; i < imageData.data.length; i += 4) {
        const v = Math.random() * 255;
        imageData.data[i] = v;
        imageData.data[i + 1] = v;
        imageData.data[i + 2] = v;
        imageData.data[i + 3] = 30;
      }
      ctx.putImageData(imageData, 0, 0);
      return;
    }

    let animId: number;
    let lastFrame = 0;
    const FPS_INTERVAL = 1000 / 15; // 15fps cap

    const resize = () => {
      // Low res for performance — will be stretched via CSS
      canvas.width = 80;
      canvas.height = 60;
    };

    const render = (time: number) => {
      const elapsed = time - lastFrame;
      if (elapsed >= FPS_INTERVAL) {
        lastFrame = time - (elapsed % FPS_INTERVAL);

        const w = canvas.width;
        const h = canvas.height;
        const imageData = ctx.createImageData(w, h);

        for (let i = 0; i < imageData.data.length; i += 4) {
          const v = Math.random() * 255;
          imageData.data[i] = v;
          imageData.data[i + 1] = v * 0.95; // Slight green tint
          imageData.data[i + 2] = v * 0.9;
          imageData.data[i + 3] = Math.floor(opacity * 80);
        }

        ctx.putImageData(imageData, 0, 0);
      }

      animId = requestAnimationFrame(render);
    };

    resize();
    animId = requestAnimationFrame(render);

    return () => cancelAnimationFrame(animId);
  }, [opacity]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-[2]"
      style={{
        imageRendering: "pixelated",
        opacity: Math.min(opacity, 0.8),
        mixBlendMode: "screen",
      }}
      aria-hidden="true"
    />
  );
}
