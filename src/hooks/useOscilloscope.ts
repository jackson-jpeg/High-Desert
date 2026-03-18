"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getAnalyserNode } from "@/audio/engine";
import { drawStatic } from "@/audio/visualizations/static";
import { getVisualization, nextVisualization } from "@/audio/visualizations";
import { getPreference, setPreference } from "@/db";
import { usePlayerStore } from "@/stores/player-store";

export function useOscilloscope() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const tuningRef = useRef(false);
  const tuningTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // iOS can't use AnalyserNode (kills background playback), so default to
  // milkdrop which has the best idle animation for non-reactive mode
  const isIOS = typeof navigator !== "undefined" &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  const defaultViz = isIOS ? "milkdrop" : "oscilloscope";

  const [vizId, setVizId] = useState(defaultViz);
  const vizIdRef = useRef(vizId);

  // Keep ref in sync with state
  useEffect(() => {
    vizIdRef.current = vizId;
  }, [vizId]);

  // Load saved preference on mount (overrides iOS default if user chose something)
  useEffect(() => {
    getPreference("viz-mode").then((saved) => {
      if (saved) {
        setVizId(saved);
      }
    });
  }, []);

  const cycleViz = useCallback(() => {
    const next = nextVisualization(vizIdRef.current);
    vizIdRef.current = next.id;
    setVizId(next.id);
    setPreference("viz-mode", next.id);
  }, []);

  const setVizMode = useCallback((id: string) => {
    vizIdRef.current = id;
    setVizId(id);
    setPreference("viz-mode", id);
  }, []);

  useEffect(() => {
    // Detect reduced motion preference
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

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

    // Size canvas to match display (logical pixels)
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    resize();

    // ResizeObserver for proper canvas sizing on layout changes
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);

    // Throttle to 30fps on mobile to reduce GC pressure
    const MOBILE_FRAME_INTERVAL = 1000 / 30;
    let lastFrameTime = 0;

    const draw = (time: number) => {
      const isMobileWidth = canvas.width < 768;
      if (isMobileWidth && time - lastFrameTime < MOBILE_FRAME_INTERVAL) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      lastFrameTime = time;

      const analyser = getAnalyserNode();
      const playing = usePlayerStore.getState().playing;
      const { width, height } = canvas;

      if (tuningRef.current) {
        drawStatic(canvas);
      } else {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const currentViz = getVisualization(vizIdRef.current);
          if (analyser && playing) {
            currentViz.draw(ctx, analyser, width, height);
          } else {
            currentViz.drawIdle(ctx, width, height);
          }
        }
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

  const viz = getVisualization(vizId);

  return { canvasRef, vizId, vizName: viz.name, cycleViz, setVizMode };
}
