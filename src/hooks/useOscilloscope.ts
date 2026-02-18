"use client";

import { useEffect, useRef } from "react";
import { getAnalyserNode } from "@/audio/engine";
import {
  drawOscilloscope,
  drawIdleLine,
  drawStatic,
} from "@/audio/oscilloscope-renderer";
import { usePlayerStore } from "@/stores/player-store";

export function useOscilloscope() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const tuningRef = useRef(false);
  const tuningTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // Detect reduced motion preference
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Watch for episode changes to trigger tuning effect
    const unsub = usePlayerStore.subscribe((state, prev) => {
      if (
        !reducedMotion &&
        state.currentEpisode &&
        prev.currentEpisode &&
        state.currentEpisode.id !== prev.currentEpisode.id
      ) {
        tuningRef.current = true;
        if (tuningTimerRef.current) clearTimeout(tuningTimerRef.current);
        tuningTimerRef.current = setTimeout(() => {
          tuningRef.current = false;
        }, 300);
      }
    });

    const canvas = canvasRef.current;
    if (!canvas) return unsub;

    // Size canvas to match display (logical pixels — renderer uses these directly)
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    resize();

    // ResizeObserver for proper canvas sizing on layout changes
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);

    const draw = () => {
      const analyser = getAnalyserNode();
      const playing = usePlayerStore.getState().playing;

      if (tuningRef.current) {
        drawStatic(canvas);
      } else if (analyser && playing) {
        drawOscilloscope(canvas, analyser);
      } else {
        drawIdleLine(canvas);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      unsub();
      if (tuningTimerRef.current) clearTimeout(tuningTimerRef.current);
    };
  }, []);

  return canvasRef;
}
