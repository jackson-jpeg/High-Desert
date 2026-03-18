# Visualization Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 switchable audio visualization modes with click-to-cycle and right-click menu interaction.

**Architecture:** Plugin registry — each visualization is an isolated file (~50-80 lines) conforming to a shared `Visualization` interface. A central registry collects them. The existing `useOscilloscope` hook selects the active viz and delegates rendering. Mode preference persists in Dexie UserPrefs.

**Tech Stack:** TypeScript, Canvas 2D, Web Audio API (AnalyserNode), Zustand (context menu store), Dexie (UserPrefs), Vitest

**Spec:** `docs/superpowers/specs/2026-03-18-visualization-modes-design.md`

---

## File Map

```
CREATE: src/audio/visualizations/types.ts          — Visualization interface + shared color constants
CREATE: src/audio/visualizations/static.ts          — drawStatic() extracted from oscilloscope-renderer.ts
CREATE: src/audio/visualizations/viz-oscilloscope.ts — Existing waveform, extracted
CREATE: src/audio/visualizations/viz-bars.ts         — Frequency bars with peak hold
CREATE: src/audio/visualizations/viz-waterfall.ts    — Spectrum waterfall scrolling
CREATE: src/audio/visualizations/viz-vu.ts           — VU meter needles
CREATE: src/audio/visualizations/viz-lissajous.ts    — X-Y scope patterns
CREATE: src/audio/visualizations/viz-radar.ts        — Area 51 radar sweep
CREATE: src/audio/visualizations/viz-starfield.ts    — Audio-reactive starfield
CREATE: src/audio/visualizations/viz-milkdrop.ts     — Warp ring patterns
CREATE: src/audio/visualizations/index.ts            — Registry array + helpers
CREATE: src/audio/visualizations/__tests__/registry.test.ts — Registry unit tests
MODIFY: src/hooks/useOscilloscope.ts                 — Use registry, expose cycleViz/setVizMode
MODIFY: src/components/player/Oscilloscope.tsx        — Click/right-click handlers, mode label
MODIFY: src/stores/context-menu-store.ts             — Add checked?: boolean to ContextMenuItem
MODIFY: src/components/win98/ContextMenu.tsx          — Render checkmark prefix when checked
DELETE: src/audio/oscilloscope-renderer.ts            — Replaced by visualizations/ directory
```

---

### Task 1: Types, Constants, and Static Utility

**Files:**
- Create: `src/audio/visualizations/types.ts`
- Create: `src/audio/visualizations/static.ts`

- [ ] **Step 1: Create the Visualization interface and shared constants**

```ts
// src/audio/visualizations/types.ts
export interface Visualization {
  id: string;
  name: string;
  draw: (ctx: CanvasRenderingContext2D, analyser: AnalyserNode, w: number, h: number) => void;
  drawIdle: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

// Shared color constants — used by all visualizations
export const PHOSPHOR_GREEN = "#33FF33";
export const GLOW_COLOR = "rgba(51, 255, 51, 0.4)";
export const DESERT_AMBER = "#D4A843";
export const LINE_WIDTH = 2;
export const GLOW_WIDTH = 6;
```

- [ ] **Step 2: Extract drawStatic into its own file**

Move the `drawStatic` function and its `getImageData` cache helper from `src/audio/oscilloscope-renderer.ts` into `src/audio/visualizations/static.ts`. Keep the same signature `(canvas: HTMLCanvasElement) => void` since the tuning transition operates on the raw canvas (not through the viz interface).

```ts
// src/audio/visualizations/static.ts
let cachedImageData: ImageData | null = null;
let cachedImageWidth = 0;
let cachedImageHeight = 0;

function getImageData(ctx: CanvasRenderingContext2D, w: number, h: number): ImageData {
  if (!cachedImageData || cachedImageWidth !== w || cachedImageHeight !== h) {
    cachedImageData = ctx.createImageData(w, h);
    cachedImageWidth = w;
    cachedImageHeight = h;
  }
  return cachedImageData;
}

export function drawStatic(canvas: HTMLCanvasElement): void {
  // ... exact existing code from oscilloscope-renderer.ts lines 100-125
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -5`
Expected: Clean build (these files aren't imported yet)

- [ ] **Step 4: Commit**

```bash
git add src/audio/visualizations/types.ts src/audio/visualizations/static.ts
git commit -m "feat(viz): add Visualization interface, constants, and static utility"
```

---

### Task 2: Extract Oscilloscope Visualization

**Files:**
- Create: `src/audio/visualizations/viz-oscilloscope.ts`

- [ ] **Step 1: Create viz-oscilloscope.ts**

Extract `drawOscilloscope`, `drawIdleLine`, `drawWaveform`, and the `getDataArray` cache helper from `src/audio/oscilloscope-renderer.ts`. Adapt signatures to match the `Visualization` interface (receive `ctx, analyser, w, h` instead of `canvas, analyser`).

```ts
// src/audio/visualizations/viz-oscilloscope.ts
import type { Visualization } from "./types";
import { PHOSPHOR_GREEN, GLOW_COLOR, LINE_WIDTH, GLOW_WIDTH } from "./types";

let cachedDataArray: Uint8Array | null = null;
let cachedBufferLength = 0;

function getDataArray(length: number): Uint8Array {
  if (!cachedDataArray || cachedBufferLength !== length) {
    cachedDataArray = new Uint8Array(length);
    cachedBufferLength = length;
  }
  return cachedDataArray;
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  dataArray: Uint8Array,
  bufferLength: number,
  width: number,
  height: number,
): void {
  const sliceWidth = width / bufferLength;
  let x = 0;
  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * height) / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += sliceWidth;
  }
}

export const oscilloscope: Visualization = {
  id: "oscilloscope",
  name: "Oscilloscope",
  draw(ctx, analyser, w, h) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = getDataArray(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    ctx.clearRect(0, 0, w, h);

    // Glow layer
    ctx.lineWidth = GLOW_WIDTH;
    ctx.strokeStyle = GLOW_COLOR;
    ctx.beginPath();
    drawWaveform(ctx, dataArray, bufferLength, w, h);
    ctx.stroke();

    // Main line
    ctx.lineWidth = LINE_WIDTH;
    ctx.strokeStyle = PHOSPHOR_GREEN;
    ctx.shadowColor = PHOSPHOR_GREEN;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    drawWaveform(ctx, dataArray, bufferLength, w, h);
    ctx.stroke();
    ctx.shadowBlur = 0;
  },
  drawIdle(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const y = h / 2;
    const t = Date.now() * 0.001;
    const breathe = Math.sin(t * 0.8) * 2;

    const drawLine = (lineWidth: number, style: string, shadow: boolean) => {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = style;
      if (shadow) { ctx.shadowColor = PHOSPHOR_GREEN; ctx.shadowBlur = 8; }
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const noise = (Math.sin(x * 0.05 + t * 3) + Math.sin(x * 0.08 + t * 1.7)) * 0.5;
        const py = y + noise * breathe;
        if (x === 0) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
      if (shadow) ctx.shadowBlur = 0;
    };
    drawLine(GLOW_WIDTH, GLOW_COLOR, false);
    drawLine(LINE_WIDTH, PHOSPHOR_GREEN, true);
  },
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -5`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add src/audio/visualizations/viz-oscilloscope.ts
git commit -m "feat(viz): extract oscilloscope visualization into plugin"
```

---

### Task 3: Registry and Unit Tests

**Files:**
- Create: `src/audio/visualizations/index.ts`
- Create: `src/audio/visualizations/__tests__/registry.test.ts`

- [ ] **Step 1: Write failing tests for the registry**

```ts
// src/audio/visualizations/__tests__/registry.test.ts
import { describe, it, expect } from "vitest";
import { VISUALIZATIONS, getVisualization, nextVisualization } from "../index";

describe("visualization registry", () => {
  it("exports all 8 visualizations", () => {
    expect(VISUALIZATIONS).toHaveLength(8);
  });

  it("each visualization has required properties", () => {
    for (const viz of VISUALIZATIONS) {
      expect(viz.id).toBeTruthy();
      expect(viz.name).toBeTruthy();
      expect(typeof viz.draw).toBe("function");
      expect(typeof viz.drawIdle).toBe("function");
    }
  });

  it("has unique ids", () => {
    const ids = VISUALIZATIONS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getVisualization returns correct viz by id", () => {
    const viz = getVisualization("oscilloscope");
    expect(viz.id).toBe("oscilloscope");
    expect(viz.name).toBe("Oscilloscope");
  });

  it("getVisualization returns first viz for unknown id", () => {
    const viz = getVisualization("nonexistent");
    expect(viz.id).toBe(VISUALIZATIONS[0].id);
  });

  it("nextVisualization cycles forward", () => {
    const first = VISUALIZATIONS[0];
    const second = VISUALIZATIONS[1];
    expect(nextVisualization(first.id).id).toBe(second.id);
  });

  it("nextVisualization wraps around from last to first", () => {
    const last = VISUALIZATIONS[VISUALIZATIONS.length - 1];
    const first = VISUALIZATIONS[0];
    expect(nextVisualization(last.id).id).toBe(first.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/audio/visualizations/__tests__/registry.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Create the registry**

The registry initially imports only the oscilloscope. Other vizzes will be added as placeholder stubs first (just id, name, and no-op draw/drawIdle), then replaced with real implementations in Tasks 5-11.

```ts
// src/audio/visualizations/index.ts
import type { Visualization } from "./types";
import { oscilloscope } from "./viz-oscilloscope";

// Placeholder: minimal viz that just clears the canvas
function placeholder(id: string, name: string): Visualization {
  return {
    id,
    name,
    draw(ctx, _analyser, w, h) { ctx.clearRect(0, 0, w, h); },
    drawIdle(ctx, w, h) { ctx.clearRect(0, 0, w, h); },
  };
}

export const VISUALIZATIONS: Visualization[] = [
  oscilloscope,
  placeholder("bars", "Frequency Bars"),
  placeholder("waterfall", "Spectrum Waterfall"),
  placeholder("vu", "VU Meters"),
  placeholder("lissajous", "Lissajous"),
  placeholder("radar", "Area 51 Radar"),
  placeholder("starfield", "Desert Starfield"),
  placeholder("milkdrop", "Milkdrop Lite"),
];

export function getVisualization(id: string): Visualization {
  return VISUALIZATIONS.find((v) => v.id === id) ?? VISUALIZATIONS[0];
}

export function nextVisualization(currentId: string): Visualization {
  const idx = VISUALIZATIONS.findIndex((v) => v.id === currentId);
  return VISUALIZATIONS[(idx + 1) % VISUALIZATIONS.length];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/audio/visualizations/__tests__/registry.test.ts 2>&1 | tail -10`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/audio/visualizations/index.ts src/audio/visualizations/__tests__/registry.test.ts
git commit -m "feat(viz): add visualization registry with tests"
```

---

### Task 4: Wire Up Hook, Component, and Context Menu

This is the integration task — connects the registry to the UI. After this, click-cycling and the right-click menu work (with real oscilloscope + 7 placeholder vizzes).

**Files:**
- Modify: `src/hooks/useOscilloscope.ts`
- Modify: `src/components/player/Oscilloscope.tsx`
- Modify: `src/stores/context-menu-store.ts`
- Modify: `src/components/win98/ContextMenu.tsx`
- Delete: `src/audio/oscilloscope-renderer.ts`

- [ ] **Step 1: Add `checked` to ContextMenuItem**

In `src/stores/context-menu-store.ts`, add `checked?: boolean` to the `ContextMenuItem` interface:

```ts
export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  separator?: boolean;
  danger?: boolean;
  checked?: boolean;  // ← ADD
}
```

- [ ] **Step 2: Render checkmark in ContextMenu**

In `src/components/win98/ContextMenu.tsx`:

First, update the **inline type annotations** on both `MobileActionSheet` (~line 35) and `ContextMenuInner` (~line 108) to include `checked?: boolean`. These components use inline types that duplicate the store interface — they must include `checked` or TypeScript will error when accessing `item.checked`. Alternatively, replace the inline types with `import type { ContextMenuItem } from "@/stores/context-menu-store"`.

Then update the label rendering in both components to prefix with `"✓ "` when `checked` is true:

Desktop (ContextMenuInner button content, ~line 245):
```tsx
{item.checked ? `✓ ${item.label}` : item.label}
```

Mobile (MobileActionSheet button content, ~line 82):
```tsx
{item.checked ? `✓ ${item.label}` : item.label}
```

- [ ] **Step 3: Update useOscilloscope hook**

Rewrite `src/hooks/useOscilloscope.ts` to use the registry:

```ts
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getAnalyserNode } from "@/audio/engine";
import { drawStatic } from "@/audio/visualizations/static";
import { getVisualization, nextVisualization } from "@/audio/visualizations";
import { usePlayerStore } from "@/stores/player-store";
import { getPreference, setPreference } from "@/db";

export function useOscilloscope() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const tuningRef = useRef(false);
  const tuningTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [vizId, setVizId] = useState("oscilloscope");
  const vizIdRef = useRef(vizId);
  useEffect(() => { vizIdRef.current = vizId; }, [vizId]);

  // Load saved preference on mount
  useEffect(() => {
    getPreference("viz-mode").then((saved) => {
      if (saved) setVizId(saved);
    });
  }, []);

  const cycleViz = useCallback(() => {
    setVizId((current) => {
      const next = nextVisualization(current);
      setPreference("viz-mode", next.id);
      return next.id;
    });
  }, []);

  const setVizMode = useCallback((id: string) => {
    setVizId(id);
    setPreference("viz-mode", id);
  }, []);

  const viz = getVisualization(vizId);

  // Animation loop — uses vizIdRef to avoid teardown/remount on mode change
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    resize();

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);

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

      if (tuningRef.current) {
        drawStatic(canvas);
      } else {
        const currentViz = getVisualization(vizIdRef.current);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          if (analyser && playing) {
            currentViz.draw(ctx, analyser, canvas.width, canvas.height);
          } else {
            currentViz.drawIdle(ctx, canvas.width, canvas.height);
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
  }, []); // stable — uses vizIdRef, no teardown on mode change

  return { canvasRef, vizId, vizName: viz.name, cycleViz, setVizMode };
}
```

- [ ] **Step 4: Update Oscilloscope component**

Rewrite `src/components/player/Oscilloscope.tsx`:

```tsx
"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useOscilloscope } from "@/hooks/useOscilloscope";
import { useContextMenuStore } from "@/stores/context-menu-store";
import { VISUALIZATIONS } from "@/audio/visualizations";
import { cn } from "@/lib/utils/cn";

interface OscilloscopeProps {
  className?: string;
}

export function Oscilloscope({ className }: OscilloscopeProps) {
  const { canvasRef, vizId, vizName, cycleViz, setVizMode } = useOscilloscope();
  const [labelVisible, setLabelVisible] = useState(false);
  const labelTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Cleanup label timer on unmount
  useEffect(() => {
    return () => clearTimeout(labelTimerRef.current);
  }, []);

  const showLabel = useCallback(() => {
    setLabelVisible(true);
    clearTimeout(labelTimerRef.current);
    labelTimerRef.current = setTimeout(() => setLabelVisible(false), 1500);
  }, []);

  const handleClick = useCallback(() => {
    cycleViz();
    showLabel();
  }, [cycleViz, showLabel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      cycleViz();
      showLabel();
    }
  }, [cycleViz, showLabel]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const items = VISUALIZATIONS.map((v) => ({
      label: v.name,
      onClick: () => {
        setVizMode(v.id);
        showLabel();
      },
      checked: v.id === vizId,
    }));
    useContextMenuStore.getState().show(e.clientX, e.clientY, items);
  }, [vizId, setVizMode, showLabel]);

  return (
    <div
      className={cn(
        "relative w98-inset-dark bg-black overflow-hidden crt-screen cursor-pointer",
        className,
      )}
      role="button"
      tabIndex={0}
      aria-label={`Audio visualization: ${vizName}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
    >
      {/* Scanline overlay */}
      <div className="absolute inset-0 crt-scanlines pointer-events-none" />

      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ imageRendering: "pixelated" }}
      />

      {/* Mode label — fades in/out on mode change */}
      <span
        className={cn(
          "absolute bottom-1 left-2 text-hd-10 text-static-green/60",
          "transition-opacity duration-500 pointer-events-none select-none",
          labelVisible ? "opacity-100" : "opacity-0",
        )}
      >
        {vizName}
      </span>
    </div>
  );
}
```

- [ ] **Step 5: Delete old oscilloscope-renderer.ts**

Run: `rm src/audio/oscilloscope-renderer.ts`

- [ ] **Step 6: Verify build and lint**

Run: `npm run build 2>&1 | tail -5 && npm run lint 2>&1 | tail -5`
Expected: Clean build, clean lint

- [ ] **Step 7: Run all tests**

Run: `npx vitest run 2>&1 | tail -10`
Expected: All tests pass (registry tests + existing tests)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(viz): wire up visualization registry with click-cycle and context menu"
```

---

### Task 5: Implement Frequency Bars

**Files:**
- Create: `src/audio/visualizations/viz-bars.ts`
- Modify: `src/audio/visualizations/index.ts` (replace placeholder)

- [ ] **Step 1: Implement the frequency bars visualization**

Chunky pixel-art equalizer bars with segmented coloring (green→amber→red) and peak hold dots that decay slowly.

Key details:
- Use `analyser.getByteFrequencyData()` for spectrum data
- ~24 bars, each `Math.floor(w / bars) - 2` pixels wide
- Segment height of 4px, 1px gap between segments
- Color: green below 65%, amber 65-85%, red above 85%
- Peak hold: white 2px dot at max, decays at ~1px/frame
- Module-level `peakHolds: number[]` array for peak persistence
- Idle mode: bars at zero height with an occasional single-bar ghost pulse (random bar flickers to ~10% height and fades)

- [ ] **Step 2: Replace placeholder in registry**

In `src/audio/visualizations/index.ts`, replace `placeholder("bars", "Frequency Bars")` with `import { bars } from "./viz-bars"` and use `bars` in the array.

- [ ] **Step 3: Build and verify**

Run: `npm run build 2>&1 | tail -5`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add src/audio/visualizations/viz-bars.ts src/audio/visualizations/index.ts
git commit -m "feat(viz): implement frequency bars visualization"
```

---

### Task 6: Implement Spectrum Waterfall

**Files:**
- Create: `src/audio/visualizations/viz-waterfall.ts`
- Modify: `src/audio/visualizations/index.ts`

- [ ] **Step 1: Implement the waterfall visualization**

Rolling spectrogram: frequency data drawn as a colored line at the top, previous frames scroll downward.

Key details:
- Use `analyser.getByteFrequencyData()`
- Keep a module-level `ImageData` buffer for the full canvas
- Each frame: shift buffer down by 1 pixel row, draw new frequency line at row 0
- Color mapping: low intensity = dark green, high intensity = bright amber
- Idle mode: slowly fade existing content toward black, no new frequency lines drawn — the waterfall "drains" away

- [ ] **Step 2: Replace placeholder in registry**

- [ ] **Step 3: Build and verify**

- [ ] **Step 4: Commit**

```bash
git add src/audio/visualizations/viz-waterfall.ts src/audio/visualizations/index.ts
git commit -m "feat(viz): implement spectrum waterfall visualization"
```

---

### Task 7: Implement VU Meters

**Files:**
- Create: `src/audio/visualizations/viz-vu.ts`
- Modify: `src/audio/visualizations/index.ts`

- [ ] **Step 1: Implement the VU meters visualization**

Dual analog needle gauges simulating L/R channels from mono data.

Key details:
- Use `analyser.getByteTimeDomainData()`, compute RMS for amplitude
- Simulate L/R by splitting even/odd samples
- Draw arc from -π to ~-0.05 radians with tick marks
- Tick marks: green for normal range, red for top 20%
- Needle: smooth spring physics — module-level `needleL`, `needleR`, `velocityL`, `velocityR`
- Spring constant ~0.3, damping ~0.7 for natural bounce
- Labels "L" and "R" below each meter
- Idle: needles rest at far left with subtle drift

- [ ] **Step 2: Replace placeholder in registry**

- [ ] **Step 3: Build and verify**

- [ ] **Step 4: Commit**

```bash
git add src/audio/visualizations/viz-vu.ts src/audio/visualizations/index.ts
git commit -m "feat(viz): implement VU meters visualization"
```

---

### Task 8: Implement Lissajous / X-Y Scope

**Files:**
- Create: `src/audio/visualizations/viz-lissajous.ts`
- Modify: `src/audio/visualizations/index.ts`

- [ ] **Step 1: Implement the Lissajous visualization**

Plots time-domain data as X-Y coordinates creating spirograph-like patterns.

Key details:
- Use `analyser.getByteTimeDomainData()`
- Plot `data[i]` as X, `data[i + offset]` as Y (offset = bufferLength/4 for 90° phase)
- Center on canvas, scale to fit with ~10% margin
- Draw with semi-transparent green for trail effect (don't fully clear — use `fillRect` with low-alpha black)
- Line width 1.5, with 6px glow
- Idle: draw slowly rotating Lissajous figure using sine waves with time-varying frequency ratios

- [ ] **Step 2: Replace placeholder in registry**

- [ ] **Step 3: Build and verify**

- [ ] **Step 4: Commit**

```bash
git add src/audio/visualizations/viz-lissajous.ts src/audio/visualizations/index.ts
git commit -m "feat(viz): implement Lissajous X-Y scope visualization"
```

---

### Task 9: Implement Area 51 Radar

**Files:**
- Create: `src/audio/visualizations/viz-radar.ts`
- Modify: `src/audio/visualizations/index.ts`

- [ ] **Step 1: Implement the radar visualization**

Rotating sweep line with frequency-driven "contact" blips.

Key details:
- Use `analyser.getByteFrequencyData()`
- Sweep line rotates at ~0.8 rad/s using `Date.now()`
- Draw 3 range rings at 33%, 66%, 100% radius + crosshair
- Map frequency peaks to "blip" positions: stable positions (seeded from frequency bin index), brightness fades after sweep passes
- Module-level `blips: {angle, distance, brightness}[]` — brightness decays, refreshed when sweep crosses
- Sweep trail: filled arc sector with low-alpha green
- Idle: slow sweep with no blips, just the rotating line

- [ ] **Step 2: Replace placeholder in registry**

- [ ] **Step 3: Build and verify**

- [ ] **Step 4: Commit**

```bash
git add src/audio/visualizations/viz-radar.ts src/audio/visualizations/index.ts
git commit -m "feat(viz): implement Area 51 radar visualization"
```

---

### Task 10: Implement Desert Starfield

**Files:**
- Create: `src/audio/visualizations/viz-starfield.ts`
- Modify: `src/audio/visualizations/index.ts`

- [ ] **Step 1: Implement the starfield visualization**

Audio-reactive star field where bass controls movement and treble controls twinkle.

Key details:
- Use `analyser.getByteFrequencyData()`, split into bass (0-10%), mid (10-40%), treble (40-100%) bands
- Module-level `stars: {x, y, size, speed, phase}[]` — ~60 stars, initialized on first call
- Stars drift slowly, speed multiplied by bass energy
- Twinkle intensity (alpha oscillation) driven by treble
- Shooting stars triggered when bass energy > threshold — amber colored, diagonal streak
- Don't fully clear canvas — use `fillRect(0,0,w,h)` with `rgba(0,0,0,0.15)` for trails
- Idle: slow gentle drift, subtle twinkle, no shooting stars

- [ ] **Step 2: Replace placeholder in registry**

- [ ] **Step 3: Build and verify**

- [ ] **Step 4: Commit**

```bash
git add src/audio/visualizations/viz-starfield.ts src/audio/visualizations/index.ts
git commit -m "feat(viz): implement desert starfield visualization"
```

---

### Task 11: Implement Milkdrop Lite

**Files:**
- Create: `src/audio/visualizations/viz-milkdrop.ts`
- Modify: `src/audio/visualizations/index.ts`

- [ ] **Step 1: Implement the Milkdrop Lite visualization**

Expanding warp rings from center with audio-driven wobble.

Key details:
- Use `analyser.getByteFrequencyData()`, focus on mid frequencies for wobble
- Rings expand outward from center at constant rate (~30px/s)
- Each ring's radius increases each frame; when it exceeds canvas diagonal, remove it
- New ring spawned every ~40 frames
- Ring shape: closed path with sinusoidal wobble `r + sin(angle * N + t) * amplitude`
- Wobble amplitude driven by mid-frequency energy
- Alpha decreases as ring expands (fade out at edges)
- Module-level `rings: {radius, spawnTime}[]`
- Don't fully clear — use `fillRect` with `rgba(0,0,0,0.05)` for persistence/trails
- Idle: rings still expand but with fixed gentle wobble, no audio reactivity

- [ ] **Step 2: Replace placeholder in registry**

- [ ] **Step 3: Build and verify**

- [ ] **Step 4: Commit**

```bash
git add src/audio/visualizations/viz-milkdrop.ts src/audio/visualizations/index.ts
git commit -m "feat(viz): implement Milkdrop Lite visualization"
```

---

### Task 12: Final Cleanup and Push

**Files:**
- Delete: `src/audio/oscilloscope-renderer.ts` (if not already deleted in Task 4)
- Verify no remaining references

- [ ] **Step 1: Verify no stale imports**

Run: `grep -r "oscilloscope-renderer" src/ --include="*.ts" --include="*.tsx" 2>/dev/null`
Expected: No output (all references should have been updated)

- [ ] **Step 2: Run full build**

Run: `npm run build 2>&1 | tail -10`
Expected: Clean build

- [ ] **Step 3: Run lint**

Run: `npm run lint 2>&1 | tail -5`
Expected: Clean lint

- [ ] **Step 4: Run all tests**

Run: `npx vitest run 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 5: Push to main**

```bash
git push origin main
```

- [ ] **Step 6: Verify on live site**

After Vercel deployment completes:
- Navigate to https://highdesert.space/library
- Play an episode
- Click the oscilloscope to cycle through all 8 modes
- Right-click the oscilloscope to verify the context menu shows all modes with a checkmark on the active one
- Refresh the page to verify the selected mode persists
