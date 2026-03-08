"use client";

import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils/cn";

interface SignalMeterProps {
  signalStrength: number; // 0-1
  className?: string;
}

// SVG arc path from startAngle to endAngle (degrees) on a circle
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startDeg));
  const y1 = cy + r * Math.sin(toRad(startDeg));
  const x2 = cx + r * Math.cos(toRad(endDeg));
  const y2 = cy + r * Math.sin(toRad(endDeg));
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

/**
 * Mobile: VU-style arc meter with green-to-amber gradient.
 * Desktop: Compact 10-segment LED bar (original design).
 */
export function SignalMeter({ signalStrength, className }: SignalMeterProps) {
  const isMobile = useIsMobile();
  const filled = Math.round(signalStrength * 10);
  const pct = Math.round(signalStrength * 100);

  if (isMobile) {
    // VU arc meter
    const w = 200, h = 56;
    const cx = w / 2, cy = 52, r = 44;
    const startDeg = -160, endDeg = -20;
    const totalArc = endDeg - startDeg; // 140 degrees
    const filledDeg = startDeg + totalArc * signalStrength;

    const trackPath = arcPath(cx, cy, r, startDeg, endDeg);
    const fillPath = signalStrength > 0.01 ? arcPath(cx, cy, r, startDeg, filledDeg) : "";

    // Position of the indicator dot
    const dotRad = (filledDeg * Math.PI) / 180;
    const dotX = cx + r * Math.cos(dotRad);
    const dotY = cy + r * Math.sin(dotRad);

    // Tick positions
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const deg = startDeg + totalArc * t;
      const rad = (deg * Math.PI) / 180;
      const inner = r - 4;
      const outer = r + 4;
      return {
        x1: cx + inner * Math.cos(rad),
        y1: cy + inner * Math.sin(rad),
        x2: cx + outer * Math.cos(rad),
        y2: cy + outer * Math.sin(rad),
        label: String(Math.round(t * 10)),
        lx: cx + (r + 10) * Math.cos(rad),
        ly: cy + (r + 10) * Math.sin(rad),
      };
    });

    return (
      <div
        className={cn("flex flex-col gap-1", className)}
        role="meter"
        aria-label="Signal strength"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="flex items-center justify-between">
          <span className="text-hd-8 text-bevel-dark/40 uppercase tracking-[0.12em] font-mono">
            Signal Strength
          </span>
          <span
            className="text-hd-10 font-mono tabular-nums"
            style={{
              color: `rgba(74,222,128,${0.4 + signalStrength * 0.5})`,
              textShadow: signalStrength > 0.5 ? `0 0 6px rgba(74,222,128,${signalStrength * 0.3})` : "none",
            }}
          >
            {pct}%
          </span>
        </div>
        <div className="flex justify-center">
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
            <defs>
              <linearGradient id="vuArcGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(74,222,128,0.3)" />
                <stop offset="60%" stopColor="#4ADE80" />
                <stop offset="85%" stopColor="#D4A843" />
                <stop offset="100%" stopColor="rgba(212,168,67,0.5)" />
              </linearGradient>
            </defs>
            {/* Background track */}
            <path d={trackPath} stroke="rgba(42,48,80,0.2)" strokeWidth={4} fill="none" strokeLinecap="round" />
            {/* Filled arc */}
            {fillPath && (
              <>
                <path d={fillPath} stroke="url(#vuArcGrad)" strokeWidth={4} fill="none" strokeLinecap="round" />
                {/* Glow layer */}
                <path d={fillPath} stroke="#4ADE80" strokeWidth={8} fill="none" strokeLinecap="round" opacity={0.08} />
              </>
            )}
            {/* Tick marks */}
            {ticks.map((t, i) => (
              <g key={i}>
                <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="rgba(128,128,128,0.15)" strokeWidth={0.5} />
                <text x={t.lx} y={t.ly} fontSize={6} fill="rgba(128,128,128,0.2)" textAnchor="middle" dominantBaseline="middle" fontFamily="JetBrains Mono, monospace">
                  {t.label}
                </text>
              </g>
            ))}
            {/* Indicator dot */}
            {signalStrength > 0.01 && (
              <>
                <circle cx={dotX} cy={dotY} r={8} fill="#4ADE80" opacity={0.15} />
                <circle cx={dotX} cy={dotY} r={4} fill="#4ADE80" opacity={0.9} />
              </>
            )}
          </svg>
        </div>
      </div>
    );
  }

  // Desktop: compact LED bar (unchanged)
  const isFull = filled === 10;
  return (
    <div
      className={cn("flex flex-col gap-1", className)}
      role="meter"
      aria-label="Signal strength"
      aria-valuemin={0}
      aria-valuemax={10}
      aria-valuenow={filled}
    >
      <div className="text-hd-7 text-bevel-dark/60 uppercase tracking-wider">
        Signal
      </div>
      <div className="flex items-center gap-[2px]">
        {Array.from({ length: 10 }, (_, i) => {
          const isActive = i < filled;
          return (
            <div
              key={i}
              className="h-[10px] flex-1 min-w-[6px]"
              style={{
                backgroundColor: isActive ? "#33FF33" : "rgba(51, 255, 51, 0.08)",
                boxShadow: isActive ? "0 0 4px rgba(51, 255, 51, 0.3)" : "none",
                opacity: isActive && isFull ? undefined : isActive ? 0.9 : 1,
                animation: isActive && isFull ? "signal-pulse 2s ease-in-out infinite" : "none",
                animationDelay: `${i * 80}ms`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
