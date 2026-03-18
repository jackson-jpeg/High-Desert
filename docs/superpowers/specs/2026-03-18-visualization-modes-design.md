# Visualization Modes — Design Spec

> Cycle-through visualization modes for the audio player, inspired by classic Windows media players (Winamp, WMP), themed through the High Desert aesthetic.

## Summary

Replace the single oscilloscope visualization with a system of 8 switchable modes. Users click the visualizer to cycle forward, or right-click for a full menu. Mode preference is persisted globally.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Direction | Mix of classic nods + originals, all High Desert themed | Recognition + originality, unified aesthetic |
| Interaction | Left-click cycles, right-click opens mode menu | Winamp-like discovery + power-user direct access |
| State scope | Global, persisted in UserPrefs | Personal preference, not content-dependent |
| Mode label | Name only, no index numbers | Clean; right-click menu provides direct selection |
| Architecture | Plugin registry (Approach B) | Isolated files, easy to add/remove modes, ~50-80 lines each |

## Visualization Plugin Interface

Each visualization is a standalone file exporting a single object:

```ts
interface Visualization {
  id: string;           // "oscilloscope", "bars", "radar", etc.
  name: string;         // "Frequency Bars" — shown in label + context menu
  draw: (ctx: CanvasRenderingContext2D, analyser: AnalyserNode, w: number, h: number) => void;
  drawIdle: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}
```

- `draw` — called every frame when audio is playing
- `drawIdle` — called when paused (breathing/ambient animation)
- Both receive pre-sized canvas context, no setup boilerplate
- Each function is responsible for clearing/filling its own background (matching the current pattern where `drawOscilloscope` and `drawIdleLine` each call `clearRect`)
- Calling both `getByteFrequencyData` and `getByteTimeDomainData` on the same analyser in the same frame is valid — they read independent snapshots
- `drawStatic` (tuning transition) stays as a shared utility — it's a transition effect, not a mode

### Per-Visualization State

Visualizations that need persistent frame-to-frame state (star positions, sweep angles, peak hold values, needle velocity, ring positions) use **module-level variables** within their own file — the same closure-based caching pattern used by the current `oscilloscope-renderer.ts` for its `cachedDataArray` and `cachedImageData`. This keeps state isolated per module with zero shared mutable state between modes.

## Registry

**File**: `src/audio/visualizations/index.ts`

```ts
export const VISUALIZATIONS: Visualization[] = [
  oscilloscope, bars, waterfall, vuMeters,
  lissajous, radar, starfield, milkdrop
];

export function getVisualization(id: string): Visualization;
export function nextVisualization(currentId: string): Visualization;
```

Array order defines the click-cycle order. Reordering = moving one line.

## State

No new store. A single Dexie `UserPrefs` entry:
- Key: `viz-mode`
- Value: visualization `id` string (e.g., `"bars"`)
- Default: `"oscilloscope"`
- Read on mount via `getPreference("viz-mode")`, write on change via `setPreference(...)`
- Same pattern as `volume`, `text-scale`, etc.

## Hook Changes (`useOscilloscope.ts`)

Current hook returns just `canvasRef`. Updated hook:
- Adds `vizMode` state (initialized from prefs, defaults to `"oscilloscope"`)
- Looks up active `Visualization` from registry
- Calls `viz.draw()` or `viz.drawIdle()` instead of hardcoded functions
- Exposes `cycleViz()` and `setVizMode(id)` for UI
- Returns `{ canvasRef, vizMode, vizName, cycleViz, setVizMode }`

Animation loop logic stays the same (30fps mobile throttle, tuning static transition, iOS idle-only fallback).

## UI Component (`Oscilloscope.tsx`)

```tsx
<div className="relative crt-screen" onClick={cycleViz} onContextMenu={handleContextMenu}>
  <canvas ref={canvasRef} ... />
  <div className="scanlines" />
  <span className={cn(
    "absolute bottom-1 left-2 text-hd-10 text-static-green/60",
    "transition-opacity duration-500 pointer-events-none",
    labelVisible ? "opacity-100" : "opacity-0"
  )}>
    {vizName}
  </span>
</div>
```

- **Left-click**: cycles to next mode, briefly shows mode name (fades after 1.5s)
- **Right-click**: opens context menu (via existing `useContextMenuStore`) with all 8 modes, active mode gets a checkmark. **Requires adding `checked?: boolean` to `ContextMenuItem` interface** in `src/stores/context-menu-store.ts` and rendering a `"✓ "` prefix in `src/components/win98/ContextMenu.tsx` when `checked` is true.
- **Mobile**: tap to cycle. No right-click menu (long-press is awkward on mobile). The tap target is the oscilloscope canvas itself — this does not conflict with the mobile player's tap-to-expand, which is on the `NowPlaying` text area, not the oscilloscope (the oscilloscope is only visible in the expanded mobile player).
- **Cursor**: `cursor-pointer` to hint interactivity
- **Accessibility**: Update `aria-label` dynamically to include the current mode name (e.g., `"Audio visualization: Frequency Bars"`)

## Visualization Modes

| # | Mode | ID | Data Source | Technique |
|---|---|---|---|---|
| 1 | Oscilloscope | `oscilloscope` | Time-domain | Existing phosphor waveform + glow. Extracted from current renderer. |
| 2 | Frequency Bars | `bars` | Frequency | Chunky pixel-art rects, segmented green-amber-red coloring, peak hold dots with decay. |
| 3 | Spectrum Waterfall | `waterfall` | Frequency | Rolling ImageData buffer, shifts down 1px/frame, new frequency line at top. Green-to-amber heat map. |
| 4 | VU Meters | `vu` | Time-domain (RMS) | Dual analog needle gauges (L/R), arc with tick marks, spring physics for smooth needle movement. Broadcast studio feel. **Stereo simulation**: since the audio graph is mono (single AnalyserNode), L/R are simulated by splitting even/odd samples from the time-domain buffer. No engine changes needed. |
| 5 | Lissajous / X-Y Scope | `lissajous` | Time-domain | Plots `data[i]` vs `data[i+offset]` as X/Y coordinates. Spirograph-like patterns with fade trails. |
| 6 | Area 51 Radar | `radar` | Frequency | Rotating sweep line (time-based), range rings, frequency peaks become "blips" at stable positions that fade after sweep passes. |
| 7 | Desert Starfield | `starfield` | Frequency (bands) | Persistent star array. Bass controls speed + shooting stars. Treble controls twinkle intensity. Ambient and dreamy. |
| 8 | Milkdrop Lite | `milkdrop` | Frequency (bands) | Expanding warp rings from center, wobble driven by mid frequencies, slow fade trail. Monochrome green nod to Winamp's iconic viz. |

## File Structure

```
src/audio/
  visualizations/
    types.ts              # Visualization interface
    index.ts              # Registry: VISUALIZATIONS array, getVisualization, nextVisualization
    viz-oscilloscope.ts   # Extracted from current oscilloscope-renderer.ts
    viz-bars.ts
    viz-waterfall.ts
    viz-vu.ts
    viz-lissajous.ts
    viz-radar.ts
    viz-starfield.ts
    viz-milkdrop.ts
    static.ts             # drawStatic (tuning transition) — extracted shared utility
  oscilloscope-renderer.ts  # DELETED after extraction
```

## Color Palette

All modes use existing constants:
- `PHOSPHOR_GREEN` (`#33FF33`) — primary color
- `GLOW_COLOR` (`rgba(51, 255, 51, 0.4)`) — bloom/glow
- `DESERT_AMBER` (`#D4A843`) — accents (bar peaks, shooting stars, heat map warm end)
- CRT scanline overlay stays on the component, not in renderers

## Performance

- Each viz owns its own cached typed arrays/buffers (same pattern as current renderer — avoids GC pressure)
- 30fps mobile throttle stays in the hook, not in individual vizzes
- iOS: still gets `drawIdle` only (no AnalyserNode due to AudioContext suspension on lock screen)
- Estimated ~50-80 lines per visualization file

## Out of Scope

- WebGL/shader-based rendering (canvas 2D is sufficient at these frame rates)
- Web Workers / OffscreenCanvas (overengineering for this use case)
- Per-episode mode memory (global preference is simpler and matches user mental model)
- Custom color themes per viz (all use the shared palette)
