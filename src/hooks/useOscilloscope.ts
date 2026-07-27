"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getAnalyserNode } from "@/audio/engine";
import { drawStatic } from "@/audio/visualizations/static";
import { getVisualization, nextVisualization, ensureVisualization, getVizName } from "@/audio/visualizations";
import { getPreference, setPreference } from "@/db";
import { isIOSDevice } from "@/lib/utils/platform";
import { usePlayerStore } from "@/stores/player-store";

export function useOscilloscope() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const tuningRef = useRef(false);
  const tuningTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const defaultViz = isIOSDevice() ? "milkdrop" : "oscilloscope";

  const [vizId, setVizId] = useState(defaultViz);
  const vizIdRef = useRef(vizId);
  /**
   * Repaints once and restarts the draw loop. The loop parks itself when there
   * is nothing to animate, so anything that changes what should be on screen —
   * a visualisation swap, the tuning burst — has to wake it explicitly.
   * Assigned by the render effect below.
   */
  const wakeRef = useRef<() => void>(() => {});

  // Keep ref in sync with state, and make sure the renderer is actually
  // loaded. getVisualization falls back to the default until it is, so
  // repaint again once the real one lands.
  useEffect(() => {
    vizIdRef.current = vizId;
    wakeRef.current();
    let cancelled = false;
    ensureVisualization(vizId).then(() => {
      if (!cancelled) wakeRef.current();
    });
    return () => {
      cancelled = true;
    };
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
    wakeRef.current();
  }, []);

  const setVizMode = useCallback((id: string) => {
    vizIdRef.current = id;
    setVizId(id);
    setPreference("viz-mode", id);
    wakeRef.current();
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
        wakeRef.current();
        if (tuningTimerRef.current) clearTimeout(tuningTimerRef.current);
        tuningTimerRef.current = setTimeout(() => {
          tuningRef.current = false;
          wakeRef.current();
        }, 300);
      }
    });

    const canvas = canvasRef.current;
    if (!canvas) return unsub;

    // Backing store matches device pixels; the CSS box stays in logical ones.
    // Without this the canvas was rendered at 1x and upscaled by the browser on
    // any retina display. `imageRendering: pixelated` on the element made that
    // read as deliberate chunkiness, but it also meant the idle waveform was
    // genuinely half-resolution on most laptops and phones.
    let cssWidth = 0;
    let cssHeight = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // 2x is plenty
      cssWidth = rect.width;
      cssHeight = rect.height;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      // Renderers draw in CSS pixels; the transform maps them to device pixels.
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // ResizeObserver for proper canvas sizing on layout changes
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);

    // Throttle to 30fps on mobile to reduce GC pressure
    const MOBILE_FRAME_INTERVAL = 1000 / 30;
    let lastFrameTime = 0;

    // The idle waveform is a static shape, so once it has been painted there is
    // nothing to animate until playback resumes. This loop previously ran at
    // 60fps forever — on every desktop route, whether or not anything was
    // playing, whether or not the player was minimised, and whether or not the
    // tab was even visible — because a paused player still fell through to
    // drawIdle() every frame.
    let idlePainted = false;

    const draw = (time: number) => {
      const isMobileWidth = cssWidth < 768;
      if (isMobileWidth && time - lastFrameTime < MOBILE_FRAME_INTERVAL) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      lastFrameTime = time;

      const analyser = getAnalyserNode();
      const playing = usePlayerStore.getState().playing;
      const animating = tuningRef.current || (!!analyser && playing);

      if (animating || !idlePainted) {
        if (tuningRef.current) {
          drawStatic(canvas);
        } else {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const currentViz = getVisualization(vizIdRef.current);
            if (analyser && playing) {
              currentViz.draw(ctx, analyser, cssWidth, cssHeight);
            } else {
              currentViz.drawIdle(ctx, cssWidth, cssHeight);
            }
          }
        }
        idlePainted = !animating;
      }

      // Park the loop while idle. play/pause and visibility both restart it.
      if (!animating && idlePainted) {
        rafRef.current = 0;
        return;
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    const start = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(draw);
    };
    const stop = () => {
      if (!rafRef.current) return;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };

    // Repaint whenever the picture can change: playback state, a viz swap, a
    // resize, or the tab coming back to the foreground.
    const unsubPlaying = usePlayerStore.subscribe((s, p) => {
      if (s.playing !== p.playing) {
        idlePainted = false;
        if (document.visibilityState === "visible") start();
      }
    });

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        idlePainted = false;
        start();
      } else {
        stop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const roRepaint = new ResizeObserver(() => {
      idlePainted = false;
      start();
    });
    roRepaint.observe(canvas);

    wakeRef.current = () => {
      idlePainted = false;
      start();
    };

    start();

    return () => {
      stop();
      wakeRef.current = () => {};
      ro.disconnect();
      roRepaint.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      unsub();
      unsubPlaying();
      if (tuningTimerRef.current) clearTimeout(tuningTimerRef.current);
    };
  }, []);

  // Name comes from the eager metadata, so displaying it never forces the
  // renderer's chunk to load.
  return { canvasRef, vizId, vizName: getVizName(vizId), cycleViz, setVizMode };
}
