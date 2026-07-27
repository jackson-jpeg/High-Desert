"use client";

import { useEffect, useMemo, useState } from "react";
import { Window } from "@/components/win98";
import { cn } from "@/lib/utils/cn";
import { fetchTraffic, type Traffic } from "@/services/stats/client";

type Range = "24h" | "7d" | "30d";

const RANGES: { key: Range; label: string }[] = [
  { key: "24h", label: "24 hours" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

/** Inline SVG rather than a chart library — the app ships no charting dep. */
function Sparkline({
  points,
  className,
}: {
  points: { t: string; online: number; listening: number; plays: number }[];
  className?: string;
}) {
  const W = 600;
  const H = 120;
  const PAD = 4;

  const geometry = useMemo(() => {
    if (points.length === 0) return null;

    const peak = Math.max(
      1,
      ...points.map((p) => Math.max(p.online, p.listening, p.plays)),
    );
    const stepX = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
    const x = (i: number) => PAD + i * stepX;
    const y = (v: number) => H - PAD - (v / peak) * (H - PAD * 2);

    const line = (key: "online" | "listening" | "plays") =>
      points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");

    const area =
      points.length > 1
        ? `${line("online")} L${x(points.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`
        : "";

    return { peak, area, online: line("online"), listening: line("listening"), plays: line("plays") };
  }, [points]);

  if (!geometry) return null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("w-full h-[120px]", className)}
      role="img"
      aria-label={`Traffic over time. Peak ${geometry.peak} concurrent.`}
    >
      {/* Baseline grid */}
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={0}
          x2={W}
          y1={PAD + f * (H - PAD * 2)}
          y2={PAD + f * (H - PAD * 2)}
          stroke="#9AA0AE"
          strokeOpacity={0.12}
          strokeWidth={1}
        />
      ))}
      <path d={geometry.area} fill="#4ADE80" fillOpacity={0.1} />
      <path d={geometry.plays} fill="none" stroke="#D4A843" strokeOpacity={0.65} strokeWidth={1.5} />
      <path d={geometry.listening} fill="none" stroke="#6BA3F0" strokeWidth={1.5} />
      <path d={geometry.online} fill="none" stroke="#4ADE80" strokeWidth={2} />
    </svg>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-hd-10 text-bevel-dark/85">
      <span className="w-[10px] h-[2px] flex-shrink-0" style={{ background: color }} />
      {label}
    </span>
  );
}

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
          <span className="animate-dot-1 inline-block text-bevel-dark text-hd-10">
            Reading the logs
          </span>
        </div>
      </Window>
    );
  }

  if (!traffic) return null;

  const hasHistory = traffic.points.length > 1;

  return (
    <Window title="Signal Traffic" variant="dark" headingLevel={2}>
      <div className="p-3 flex flex-col gap-3" id="traffic">
        {/* Range switcher */}
        <div className="flex items-center gap-1">
          {RANGES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              aria-pressed={range === key}
              className={cn(
                "px-2 py-1 md:py-0.5 text-hd-10 cursor-pointer transition-colors-fast min-h-[32px] md:min-h-0",
                range === key
                  ? "bg-desert-amber/15 text-desert-amber w98-inset-dark"
                  : "text-bevel-dark/85 hover:text-desktop-gray",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {hasHistory ? (
          <>
            <div className="w98-inset-dark bg-inset-well p-1">
              <Sparkline points={traffic.points} />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Legend color="#4ADE80" label="Online" />
              <Legend color="#6BA3F0" label="Listening" />
              <Legend color="#D4A843" label="Plays" />
            </div>
          </>
        ) : (
          <div className="w98-inset-dark bg-inset-well p-6 text-center">
            <div className="text-hd-11 text-desktop-gray mb-1">Not enough history yet.</div>
            <div className="text-hd-10 text-bevel-dark/85 leading-relaxed max-w-[320px] mx-auto">
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
      </div>
    </Window>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center p-2 w98-inset-dark bg-inset-well gap-0.5">
      <div className={cn("text-hd-16 font-bold tabular-nums", color)}>{value}</div>
      <div className="text-hd-9 text-bevel-dark uppercase tracking-wider text-center">{label}</div>
    </div>
  );
}
