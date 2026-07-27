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

  /*
   * opacity is read through a ref, and the effect below deliberately does NOT
   * depend on it.
   *
   * opacity is derived from signalStrength, which changes continuously while
   * the dial is being dragged. With `[opacity]` as the dependency, every
   * intermediate value tore down the whole effect and rebuilt it — resizing
   * the canvas, reallocating ImageData and starting a fresh rAF loop, dozens
   * of times per second, for the entire duration of a tune. The alpha was
   * captured in a closure, which is what forced the teardown in the first
   * place; reading it from a ref lets one long-lived loop pick up new values.
   */
  const opacityRef = useRef(opacity);
  // Synced in an effect, not during render: writing a ref while rendering is
  // unsafe under concurrent rendering, where a render may be discarded.
  useEffect(() => {
    opacityRef.current = opacity;
  }, [opacity]);

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

    // Low res for performance — will be stretched via CSS
    canvas.width = 80;
    canvas.height = 60;

    // Allocate ImageData ONCE and reuse every frame
    const imageData = ctx.createImageData(canvas.width, canvas.height);

    const render = (time: number) => {
      const elapsed = time - lastFrame;
      if (elapsed >= FPS_INTERVAL) {
        lastFrame = time - (elapsed % FPS_INTERVAL);

        // Read per frame, so a changing signal strength no longer requires
        // restarting the effect.
        const alphaVal = Math.floor(opacityRef.current * 80);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const v = Math.random() * 255;
          data[i] = v;
          data[i + 1] = v * 0.95; // Slight green tint
          data[i + 2] = v * 0.9;
          data[i + 3] = alphaVal;
        }

        ctx.putImageData(imageData, 0, 0);
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => cancelAnimationFrame(animId);
    // Intentionally empty: see the note on opacityRef above.
  }, []);

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
