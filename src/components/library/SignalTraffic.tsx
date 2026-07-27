"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Window } from "@/components/win98";
import { cn } from "@/lib/utils/cn";
import { fetchTraffic, type Traffic, type TrafficPoint } from "@/services/stats/client";

type Range = "24h" | "7d" | "30d";

const RANGES: { key: Range; label: string; short: string }[] = [
  { key: "24h", label: "24 hours", short: "24h" },
  { key: "7d", label: "7 days", short: "7d" },
  { key: "30d", label: "30 days", short: "30d" },
];

const W = 600;
const H = 150;
const PAD_Y = 6;

/** Local hours treated as "night" — the shaded band, and Art Bell's shift. */
const NIGHT_FROM = 22;
const NIGHT_TO = 6;

function isNight(d: Date): boolean {
  const h = d.getHours();
  return h >= NIGHT_FROM || h < NIGHT_TO;
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Axis label for a tick.
 *
 * `spanHours` matters because the range is a *window*, not a guarantee of
 * content: a sampler that started forty minutes ago answers a 24h request with
 * forty minutes of data, and hour-granularity labels then read "7 PM, 7 PM,
 * 7 PM". The label resolution follows what is actually on screen.
 */
function formatTick(d: Date, range: Range, spanHours: number): string {
  if (spanHours < 3) return formatClock(d);
  if (range === "24h" || spanHours < 30) {
    return d.toLocaleTimeString([], { hour: "numeric" });
  }
  if (range === "7d" || spanHours < 24 * 10) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatStamp(d: Date, range: Range): string {
  if (range === "24h") return formatClock(d);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${formatClock(d)}`;
}

/** "12a", "6a", "12p" — compact enough for 24 columns on a phone. */
function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? "a" : "p"}`;
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

interface Geometry {
  x: (i: number) => number;
  yPresence: (v: number) => number;
  peakPresence: number;
  peakPlays: number;
  online: string;
  listening: string;
  area: string;
  nightBands: { x: number; w: number }[];
  ticks: { i: number; label: string }[];
  /** Slot width for the play columns. */
  barW: number;
}

function buildGeometry(points: TrafficPoint[], range: Range): Geometry | null {
  if (points.length < 2) return null;

  const dates = points.map((p) => new Date(p.t));

  // Two scales on purpose. Presence is a gauge that sits in the low single
  // digits; plays is a counter that can spike to dozens in one bucket. Sharing
  // one axis — as this chart used to — pinned the presence lines flat against
  // the floor on exactly the days worth looking at.
  const peakPresence = Math.max(1, ...points.map((p) => Math.max(p.online, p.listening)));
  const peakPlays = Math.max(1, ...points.map((p) => p.plays));

  const stepX = W / (points.length - 1);
  const x = (i: number) => i * stepX;
  const yPresence = (v: number) => H - PAD_Y - (v / peakPresence) * (H - PAD_Y * 2);

  const line = (key: "online" | "listening") =>
    points
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yPresence(p[key]).toFixed(1)}`)
      .join(" ");

  const online = line("online");
  const area = `${online} L${W},${H} L0,${H} Z`;

  // Contiguous runs of night buckets, merged into single rects so the shading
  // reads as one band rather than a picket fence of per-bucket stripes.
  const nightBands: { x: number; w: number }[] = [];
  let runStart = -1;
  dates.forEach((d, i) => {
    const night = isNight(d);
    if (night && runStart < 0) runStart = i;
    if ((!night || i === dates.length - 1) && runStart >= 0) {
      const end = night ? i : i - 1;
      nightBands.push({ x: x(runStart), w: Math.max(stepX, x(end) - x(runStart)) });
      runStart = -1;
    }
  });

  const spanHours =
    (dates[dates.length - 1].getTime() - dates[0].getTime()) / 3_600_000;

  const tickCount = Math.min(5, points.length);
  const seen = new Set<string>();
  const ticks = Array.from({ length: tickCount }, (_, k) => {
    const i = Math.round((k * (points.length - 1)) / (tickCount - 1 || 1));
    return { i, label: formatTick(dates[i], range, spanHours) };
  }).filter((t) => {
    // Two ticks with the same label are worse than one: they read as a broken
    // axis rather than as coarse resolution.
    if (seen.has(t.label)) return false;
    seen.add(t.label);
    return true;
  });

  return {
    x,
    yPresence,
    peakPresence,
    peakPlays,
    online,
    listening: line("listening"),
    area,
    nightBands,
    ticks,
    // Leave a gap between columns so they read as discrete buckets rather than
    // one continuous block, and cap the width when there are very few points.
    barW: Math.min(28, (W / points.length) * 0.6),
  };
}

function TrafficChart({
  points,
  range,
}: {
  points: TrafficPoint[];
  range: Range;
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

// ---------------------------------------------------------------------------
// Hour-of-day profile
// ---------------------------------------------------------------------------

/** Hours that must have been observed before the profile means anything. */
const MIN_HOURS_COVERED = 8;

function HourProfile({ hourly }: { hourly: Traffic["hourly"] }) {
  const { bars, peak, nowHour, covered } = useMemo(() => {
    // The API answers in UTC hours; the question a visitor is asking is about
    // their own night. Whole-hour offsets cover all but a handful of zones,
    // which land in the nearest hour rather than being dropped.
    const offset = -Math.round(new Date().getTimezoneOffset() / 60);
    const bars = Array.from({ length: 24 }, () => ({
      online: 0,
      plays: 0,
      samples: 0,
    }));
    for (const b of hourly) {
      const local = (((b.hour + offset) % 24) + 24) % 24;
      bars[local] = { online: b.online, plays: b.plays, samples: b.samples };
    }
    return {
      bars,
      peak: Math.max(0.01, ...bars.map((b) => b.online)),
      nowHour: new Date().getHours(),
      covered: bars.filter((b) => b.samples > 0).length,
    };
  }, [hourly]);

  // A sampler that has been running for an hour can draw 23 empty columns and
  // one tall one. That is not a daily rhythm, it is a startup artefact, and it
  // makes a working site look dead.
  if (covered < MIN_HOURS_COVERED) return null;

  const busiest = bars.reduce((best, b, i) => (b.online > bars[best].online ? i : best), 0);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="text-hd-micro uppercase tracking-wider text-bevel-dark/85">
          When the desert is awake
        </h3>
        <span className="text-hd-micro text-bevel-dark/85">
          last 30 days · your time · busiest around{" "}
          <strong className="text-desert-amber font-normal">{hourLabel(busiest)}</strong>
        </span>
      </div>

      <div className="w98-inset-dark bg-inset-well p-1.5">
        <div className="flex items-end gap-[2px] h-[52px]">
          {bars.map((b, hour) => {
            const night = hour >= NIGHT_FROM || hour < NIGHT_TO;
            // An hour never sampled gets a floor-level dash, visibly different
            // from an hour that was watched and found empty.
            const pct = b.samples === 0 ? 3 : Math.max(4, (b.online / peak) * 100);
            return (
              <div
                key={hour}
                className="flex-1 h-full flex items-end"
                title={
                  b.samples === 0
                    ? `${hourLabel(hour)} — not sampled yet`
                    : `${hourLabel(hour)} — ${b.online.toFixed(1)} people on average${b.plays > 0 ? `, ${b.plays} plays` : ""}`
                }
              >
                <div
                  className={cn(
                    "w-full",
                    b.samples === 0
                      ? "bg-bevel-dark/25"
                      : hour === nowHour
                        ? "bg-desert-amber"
                        : night
                          ? "bg-signal-blue/55"
                          : "bg-static-green/45",
                  )}
                  style={{ height: `${pct}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-1 text-hd-micro text-bevel-dark/85 tabular-nums">
          {[0, 6, 12, 18, 23].map((h) => (
            <span key={h}>{hourLabel(h)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * Public traffic history — the click-through target for the live count in the
 * status bar.
 *
 * Renders nothing at all when the stats service is unavailable or has yet to
 * collect a sample, rather than showing an empty chart frame: with
 * DATABASE_URL unset every /api/stats/* route 503s by design.
 */
export function SignalTraffic() {
  const [range, setRange] = useState<Range>("24h");
  const [traffic, setTraffic] = useState<Traffic | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- sync loading state before async fetch
    fetchTraffic(range)
      .then((t) => {
        if (!cancelled) setTraffic(t);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  if (loading && !traffic) {
    return (
      <Window title="Signal Traffic" variant="dark" headingLevel={2}>
        <div className="p-6 text-center">
          <span className="animate-dot-1 inline-block text-bevel-dark text-hd-caption">
            Reading the logs
          </span>
        </div>
      </Window>
    );
  }

  if (!traffic) return null;

  const hasHistory = traffic.points.length > 1;
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? range;

  return (
    <Window title="Signal Traffic" variant="dark" headingLevel={2}>
      <div className="p-3 flex flex-col gap-3" id="traffic">
        {/* Range switcher */}
        <div className="flex items-center gap-1" role="group" aria-label="Time range">
          {RANGES.map(({ key, label, short }) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              aria-pressed={range === key}
              className={cn(
                "px-2 py-1 md:py-0.5 text-hd-caption cursor-pointer transition-colors-fast min-h-[32px] md:min-h-0",
                range === key
                  ? "bg-desert-amber/15 text-desert-amber w98-inset-dark"
                  : "text-bevel-dark/85 hover:text-desktop-gray",
              )}
            >
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{short}</span>
            </button>
          ))}
        </div>

        {/* The headline in a sentence. A grid of integers makes a reader do the
            interpreting; this states the finding and lets the tiles below back
            it up. */}
        <Summary traffic={traffic} rangeLabel={rangeLabel} range={range} />

        {hasHistory ? (
          <>
            <TrafficChart points={traffic.points} range={range} />
            <div className="flex items-center gap-3 flex-wrap">
              <Legend color="var(--hd-green)" label="Online" />
              <Legend color="var(--hd-blue)" label="Listening" />
              <Legend color="var(--hd-amber)" label="Plays" block />
              {/* Only explain the shading when some of it is on screen —
                  a legend for an absent band reads as a rendering fault. */}
              {traffic.points.some((p) => isNight(new Date(p.t))) && (
                <span className="text-hd-micro text-bevel-dark/85">
                  shaded = {hourLabel(NIGHT_FROM)}–{hourLabel(NIGHT_TO)}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="w98-inset-dark bg-inset-well p-6 text-center">
            <div className="text-hd-caption text-desktop-gray mb-1">Not enough history yet.</div>
            <div className="text-hd-caption text-bevel-dark/85 max-w-[320px] mx-auto">
              Traffic is sampled every couple of minutes. Check back shortly —
              the chart appears once there are at least two samples in range.
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Peak online" value={traffic.peakOnline.toLocaleString()} color="text-static-green" />
          <Stat label="Peak listening" value={traffic.peakListening.toLocaleString()} color="text-signal-blue" />
          <Stat label="Plays in range" value={traffic.playsInRange.toLocaleString()} color="text-desert-amber" />
          <Stat label="Plays all time" value={traffic.totalPlays.toLocaleString()} color="text-desktop-gray" />
        </div>

        {traffic.hourly.length > 0 && <HourProfile hourly={traffic.hourly} />}
      </div>
    </Window>
  );
}

function Summary({
  traffic,
  rangeLabel,
  range,
}: {
  traffic: Traffic;
  rangeLabel: string;
  range: Range;
}) {
  const peakAt = traffic.peakAt ? new Date(traffic.peakAt) : null;

  if (traffic.peakOnline === 0) {
    return (
      <p className="text-hd-body text-bevel-dark/85">
        Quiet across the last {rangeLabel}. The sampler is still listening.
      </p>
    );
  }

  return (
    <p className="text-hd-body text-desktop-gray">
      Busiest{" "}
      {peakAt && (
        <>
          at{" "}
          <strong className="text-desert-amber font-normal tabular-nums">
            {formatStamp(peakAt, range)}
          </strong>
          ,{" "}
        </>
      )}
      when{" "}
      <strong className="text-static-green font-normal tabular-nums">
        {traffic.peakOnline}
      </strong>{" "}
      {traffic.peakOnline === 1 ? "person was" : "people were"} here at once.{" "}
      {traffic.playsInRange > 0 ? (
        <>
          <strong className="text-desert-amber font-normal tabular-nums">
            {traffic.playsInRange.toLocaleString()}
          </strong>{" "}
          {traffic.playsInRange === 1 ? "show" : "shows"} played in the last {rangeLabel}.
        </>
      ) : (
        <>No shows played in the last {rangeLabel}.</>
      )}
    </p>
  );
}

function Legend({ color, label, block }: { color: string; label: string; block?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-hd-micro text-bevel-dark/85">
      <span
        className={cn("flex-shrink-0", block ? "w-[8px] h-[8px]" : "w-[10px] h-[2px]")}
        style={{ background: color, opacity: block ? 0.5 : 1 }}
      />
      {label}
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center p-2 w98-inset-dark bg-inset-well gap-0.5">
      <div className={cn("text-hd-title font-bold tabular-nums", color)}>{value}</div>
      <div className="text-hd-micro text-bevel-dark uppercase tracking-wider text-center">
        {label}
      </div>
    </div>
  );
}
