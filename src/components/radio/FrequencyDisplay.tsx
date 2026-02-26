"use client";

import { useRadioDialStore } from "@/stores/radio-dial-store";
import { StaticVisualizer } from "./StaticVisualizer";
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

  const freqStr = typeof frequency === 'number' && !isNaN(frequency) && frequency >= 530 && frequency <= 1700 ? `AM ${Math.round(frequency)} kHz` : "AM --- kHz";
  const dateStr = currentDate
    ? currentDate.toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "---";

  return (
    <div
      className={`crt-screen crt-bg relative overflow-hidden ${className ?? ""}`}
    >
      {/* Scanlines */}
      <div className="crt-scanlines absolute inset-0 pointer-events-none" />

      {/* TV static overlay — fades with signal */}
      {staticEnabled && signalStrength < 1 && (
        <StaticVisualizer opacity={1 - signalStrength} />
      )}

      {/* Content */}
      <div className="relative z-[3] p-3 flex flex-col gap-1.5 min-h-[100px]">
        {/* Frequency readout */}
        <div className="flex items-center justify-between">
          <span className="crt-amber text-[14px] md:text-[12px] tracking-wider font-mono tabular-nums">
            {freqStr}
          </span>
          {isLocked && (
            <span className="text-[9px] md:text-[8px] text-static-green-bright animate-pulse-glow px-1.5 py-0.5 border border-static-green-bright/30">
              LOCKED
            </span>
          )}
          {!isLocked && signalStrength > 0.1 && (
            <span className="text-[9px] md:text-[8px] text-desert-amber/60 animate-pulse">
              TUNING...
            </span>
          )}
        </div>

        {/* Episode info or searching */}
        {isLocked && currentStation ? (
          <div className="flex flex-col gap-0.5">
            <div className="crt-text text-[13px] md:text-[11px] truncate leading-tight">
              {currentStation.episode.title || currentStation.episode.fileName}
            </div>
            {currentStation.episode.guestName && (
              <div className="crt-text text-[11px] md:text-[9px] opacity-70 truncate">
                {currentStation.episode.guestName}
              </div>
            )}
            <div className="text-[10px] md:text-[8px] text-bevel-dark/70 mt-0.5">
              {dateStr}
              {sameDateCount > 1 && (
                <span className="ml-2 text-desert-amber/60">
                  [{subStationIndex + 1}/{sameDateCount}]
                </span>
              )}
            </div>
            {currentStation.episode.showType &&
              currentStation.episode.showType !== "unknown" && (
                <div className="text-[9px] md:text-[7px] mt-0.5">
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
            <div className="crt-text text-[11px] md:text-[9px] opacity-50">
              SEARCHING...
            </div>
            <div className="text-[10px] md:text-[8px] text-bevel-dark/50">
              {dateStr}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
