"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import type { TrafficPoint } from "@/services/stats/client";
import {
  buildGeometry,
  formatStamp,
  CHART_W as W,
  CHART_H as H,
  CHART_PAD_Y as PAD_Y,
  type TrafficRange,
} from "@/lib/library/traffic";

/**
 * The Signal Traffic history chart: presence lines, play columns and the
 * night band as SVG, with the readout and axis in HTML. Geometry comes from
 * `buildGeometry()`; this file only draws it and owns the cursor.
 */
export function TrafficChart({
  points,
  range,
}: {
  points: TrafficPoint[];
  range: TrafficRange;
}) {
  const geo = useMemo(() => buildGeometry(points, range), [points, range]);
  const [cursor, setCursor] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const indexFromClientX = useCallback(
    (clientX: number) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return null;
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(frac * (points.length - 1));
    },
    [points.length],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => setCursor(indexFromClientX(e.clientX)),
    [indexFromClientX],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      setCursor((c) => {
        const base = c ?? points.length - 1;
        const next = base + (e.key === "ArrowRight" ? 1 : -1);
        return Math.min(points.length - 1, Math.max(0, next));
      });
    },
    [points.length],
  );

  if (!geo) return null;

  const active = cursor != null ? points[cursor] : null;
  const activeDate = active ? new Date(active.t) : null;
  // Flip the tooltip to the left of the cursor past the midpoint, so it never
  // runs off the right edge of the panel.
  const cursorPct = cursor != null ? (cursor / (points.length - 1)) * 100 : 0;

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={wrapRef}
        tabIndex={0}
        role="img"
        aria-label={
          `Traffic over the last ${range}. Peak ${geo.peakPresence} concurrent visitors. ` +
          `Use the left and right arrow keys to read individual points.`
        }
        onPointerMove={onPointerMove}
        onPointerLeave={() => setCursor(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setCursor(null)}
        className="relative w98-inset-dark bg-inset-well touch-pan-y cursor-crosshair"
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-[130px] md:h-[150px] block"
          aria-hidden="true"
        >
          {/* Night band — the archive's natural habitat, and a free time
              orientation cue that costs no axis labels. */}
          {geo.nightBands.map((b, i) => (
            <rect
              key={i}
              x={b.x}
              y={0}
              width={b.w}
              height={H}
              fill="var(--hd-blue)"
              fillOpacity={0.09}
            />
          ))}

          {/* Horizontal guides at the quarter marks */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={0}
              x2={W}
              y1={PAD_Y + f * (H - PAD_Y * 2)}
              y2={PAD_Y + f * (H - PAD_Y * 2)}
              stroke="var(--hd-muted)"
              strokeOpacity={0.1}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Plays, on their own scale, as columns behind the presence lines */}
          {points.map((p, i) =>
            p.plays > 0 ? (
              <rect
                key={i}
                x={geo.x(i) - geo.barW / 2}
                y={H - (p.plays / geo.peakPlays) * (H - PAD_Y * 2) * 0.55}
                width={geo.barW}
                height={(p.plays / geo.peakPlays) * (H - PAD_Y * 2) * 0.55}
                fill="var(--hd-amber)"
                fillOpacity={0.35}
              />
            ) : null,
          )}

          <path d={geo.area} fill="var(--hd-green)" fillOpacity={0.12} />
          <path
            d={geo.listening}
            fill="none"
            stroke="var(--hd-blue)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={geo.online}
            fill="none"
            stroke="var(--hd-green)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />

          {cursor != null && active && (
            <>
              <line
                x1={geo.x(cursor)}
                x2={geo.x(cursor)}
                y1={0}
                y2={H}
                stroke="var(--hd-amber)"
                strokeOpacity={0.7}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              {/* Non-scaling stroke keeps these round despite the stretched
                  viewBox; r is in the stretched space, hence the ellipse. */}
              <ellipse
                cx={geo.x(cursor)}
                cy={geo.yPresence(active.online)}
                rx={W / 260}
                ry={3}
                fill="var(--hd-green)"
              />
              {active.listening > 0 && (
                <ellipse
                  cx={geo.x(cursor)}
                  cy={geo.yPresence(active.listening)}
                  rx={W / 260}
                  ry={3}
                  fill="var(--hd-blue)"
                />
              )}
            </>
          )}
        </svg>

        {/* Readout, as HTML so the type is crisp and inherits the text scale */}
        {active && activeDate && (
          <div
            className={cn(
              "absolute top-1 pointer-events-none w98-raised-dark bg-raised-surface",
              "px-2 py-1 flex flex-col gap-0.5 whitespace-nowrap z-10",
            )}
            style={
              cursorPct > 55
                ? { right: `${100 - cursorPct}%`, marginRight: 6 }
                : { left: `${cursorPct}%`, marginLeft: 6 }
            }
          >
            <span className="text-hd-micro text-bevel-dark/85 tabular-nums">
              {formatStamp(activeDate, range)}
            </span>
            <span className="text-hd-micro text-static-green tabular-nums">
              {active.online} online
            </span>
            <span className="text-hd-micro text-signal-blue tabular-nums">
              {active.listening} listening
            </span>
            <span className="text-hd-micro text-desert-amber tabular-nums">
              {active.plays} {active.plays === 1 ? "play" : "plays"}
            </span>
          </div>
        )}

        {/* Peak value, pinned to the top-left so the axis needs no gutter */}
        <span className="absolute top-1 left-1.5 text-hd-micro text-bevel-dark/85 tabular-nums pointer-events-none">
          {geo.peakPresence}
        </span>
      </div>

      {/* Time axis, in HTML for the same reason as the tooltip */}
      <div className="relative h-[14px] select-none" aria-hidden="true">
        {geo.ticks.map(({ i, label }, k) => {
          const pct = (i / (points.length - 1)) * 100;
          return (
            <span
              key={i}
              className="absolute top-0 text-hd-micro text-bevel-dark/85 tabular-nums whitespace-nowrap"
              style={{
                left: `${pct}%`,
                transform:
                  k === 0
                    ? "none"
                    : k === geo.ticks.length - 1
                      ? "translateX(-100%)"
                      : "translateX(-50%)",
              }}
            >
              {label}
            </span>
          );
        })}
      </div>

      {/* Live region: the chart is keyboard-navigable, so the cursor position
          has to be announced somewhere a screen reader will pick it up. */}
      <span className="sr-only" aria-live="polite">
        {active && activeDate
          ? `${formatStamp(activeDate, range)}: ${active.online} online, ${active.listening} listening, ${active.plays} plays`
          : ""}
      </span>
    </div>
  );
}
