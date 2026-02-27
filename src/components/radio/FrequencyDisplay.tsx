"use client";

import { useRadioDialStore } from "@/stores/radio-dial-store";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { StaticVisualizer } from "./StaticVisualizer";
import { cn } from "@/lib/utils/cn";
import type { DialStation } from "@/hooks/useRadioDial";

interface FrequencyDisplayProps {
  frequency: number;
  currentDate: Date | null;
  currentStation: DialStation | null;
  isLocked: boolean;
  signalStrength: number;
  sameDateCount: number;
  subStationIndex: number;
  className?: string;
}

export function FrequencyDisplay({
  frequency,
  currentDate,
  currentStation,
  isLocked,
  signalStrength,
  sameDateCount,
  subStationIndex,
  className,
}: FrequencyDisplayProps) {
  const staticEnabled = useRadioDialStore((s) => s.staticEnabled);
  const isMobile = useIsMobile();

  const freqNum = Math.round(frequency);
  const dateStr = currentDate
    ? currentDate.toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "---";
  const isoDate = currentDate
    ? currentDate.toISOString().slice(0, 10)
    : "---";

  // Mobile: dramatic phosphor-glow CRT display
  if (isMobile) {
    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-xl",
          "bg-[rgba(4,6,12,0.92)] border border-static-green/[0.06]",
          className,
        )}
        style={{
          boxShadow: "inset 0 0 60px rgba(74,222,128,0.04), inset 0 1px 0 rgba(255,255,255,0.03), 0 8px 40px rgba(0,0,0,0.6)",
        }}
      >
        {/* Scanlines */}
        <div className="crt-scanlines absolute inset-0 pointer-events-none opacity-[0.04]" />

        {/* TV static overlay */}
        {staticEnabled && signalStrength < 1 && (
          <StaticVisualizer opacity={1 - signalStrength} />
        )}

        {/* Content */}
        <div className="relative z-[3] p-5 flex flex-col gap-1">
          {/* Frequency row */}
          <div className="flex items-baseline gap-1.5">
            <span
              className="text-[48px] font-bold tracking-tight leading-none font-sans"
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                color: "#4ADE80",
                textShadow: "0 0 30px rgba(74,222,128,0.5), 0 0 60px rgba(74,222,128,0.2), 0 0 100px rgba(74,222,128,0.08)",
              }}
            >
              {freqNum}
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-mono text-static-green/40 tracking-[0.1em]">kHz</span>
              <span className="text-[9px] font-mono text-static-green/20 tracking-[0.05em]">AM</span>
            </div>
          </div>

          {/* Date + Lock indicator */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-[12px] font-mono text-desert-amber/70 tracking-wide tabular-nums">
              {isoDate}
            </span>
            {isLocked && (
              <div className="flex items-center gap-1.5">
                <div
                  className="w-[7px] h-[7px] rounded-full bg-static-green"
                  style={{ boxShadow: "0 0 8px rgba(74,222,128,0.7), 0 0 20px rgba(74,222,128,0.3)" }}
                />
                <span className="text-[9px] font-mono text-static-green/50 tracking-[0.12em] uppercase">
                  Locked
                </span>
              </div>
            )}
            {!isLocked && signalStrength > 0.1 && (
              <span className="text-[9px] font-mono text-desert-amber/50 animate-pulse tracking-wider uppercase">
                Tuning...
              </span>
            )}
          </div>

          {/* Episode info */}
          {isLocked && currentStation ? (
            <div className="flex flex-col gap-1 pt-2">
              <span
                className="text-[16px] font-semibold text-desktop-gray/90 truncate leading-tight"
                style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.01em" }}
              >
                {currentStation.episode.title || currentStation.episode.fileName}
              </span>
              {/* Sub-station dots */}
              {sameDateCount > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-bevel-dark/40">
                    Station {subStationIndex + 1} of {sameDateCount}
                  </span>
                  <div className="flex gap-1">
                    {Array.from({ length: sameDateCount }, (_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "w-[5px] h-[5px] rounded-full",
                          i === subStationIndex
                            ? "bg-desert-amber shadow-[0_0_4px_rgba(212,168,67,0.4)]"
                            : "bg-desert-amber/20",
                        )}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1 pt-2">
              <span className="crt-text text-[12px] opacity-50">SEARCHING...</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Desktop: original CRT display
  const freqStr = `AM ${freqNum} kHz`;
  return (
    <div
      className={cn("crt-screen crt-bg relative overflow-hidden", className)}
    >
      <div className="crt-scanlines absolute inset-0 pointer-events-none" />
      {staticEnabled && signalStrength < 1 && (
        <StaticVisualizer opacity={1 - signalStrength} />
      )}
      <div className="relative z-[3] p-3 flex flex-col gap-1.5 min-h-[100px]">
        <div className="flex items-center justify-between">
          <span className="crt-amber text-[12px] tracking-wider font-mono tabular-nums">
            {freqStr}
          </span>
          {isLocked && (
            <span className="text-[8px] text-static-green-bright animate-pulse-glow px-1.5 py-0.5 border border-static-green-bright/30">
              LOCKED
            </span>
          )}
          {!isLocked && signalStrength > 0.1 && (
            <span className="text-[8px] text-desert-amber/60 animate-pulse">
              TUNING...
            </span>
          )}
        </div>
        {isLocked && currentStation ? (
          <div className="flex flex-col gap-0.5">
            <div className="crt-text text-[11px] truncate leading-tight">
              {currentStation.episode.title || currentStation.episode.fileName}
            </div>
            {currentStation.episode.guestName && (
              <div className="crt-text text-[9px] opacity-70 truncate">
                {currentStation.episode.guestName}
              </div>
            )}
            <div className="text-[8px] text-bevel-dark/70 mt-0.5">
              {dateStr}
              {sameDateCount > 1 && (
                <span className="ml-2 text-desert-amber/60">
                  [{subStationIndex + 1}/{sameDateCount}]
                </span>
              )}
            </div>
            {currentStation.episode.showType &&
              currentStation.episode.showType !== "unknown" && (
                <div className="text-[7px] mt-0.5">
                  <span
                    className={
                      currentStation.showType === "coast"
                        ? "text-title-bar-blue"
                        : currentStation.showType === "dreamland"
                          ? "text-static-green"
                          : "text-desert-amber"
                    }
                  >
                    {currentStation.showType === "coast"
                      ? "Coast to Coast AM"
                      : currentStation.showType === "dreamland"
                        ? "Dreamland"
                        : "Special"}
                  </span>
                </div>
              )}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="crt-text text-[9px] opacity-50">SEARCHING...</div>
            <div className="text-[8px] text-bevel-dark/50">{dateStr}</div>
          </div>
        )}
      </div>
    </div>
  );
}
