"use client";

import { useEffect, useRef } from "react";
import { getAnalyserNode } from "@/lib/audio/engine";
import {
  drawOscilloscope,
  drawIdleLine,
} from "@/lib/audio/oscilloscope-renderer";
import { usePlayerStore } from "@/stores/player-store";

export function useOscilloscope() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Size canvas to match display (logical pixels — renderer uses these directly)
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    resize();

    const draw = () => {
      const analyser = getAnalyserNode();
      const playing = usePlayerStore.getState().playing;

      if (analyser && playing) {
        drawOscilloscope(canvas, analyser);
      } else {
        drawIdleLine(canvas);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return canvasRef;
}
