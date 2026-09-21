"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import type { Traffic } from "@/services/stats/client";
import {
  buildHourProfile,
  hourBarPercent,
  hourLabel,
  isNightHour,
  MIN_HOURS_COVERED,
} from "@/lib/library/traffic";

/** "When the desert is awake" — the 30-day hour-of-day profile, in local time. */
export function TrafficHourProfile({ hourly }: { hourly: Traffic["hourly"] }) {
  const { bars, peak, covered, busiest, nowHour } = useMemo(
    () => ({
      ...buildHourProfile(hourly, new Date().getTimezoneOffset()),
      nowHour: new Date().getHours(),
    }),
    [hourly],
  );

  // A sampler that has been running for an hour can draw 23 empty columns and
  // one tall one. That is not a daily rhythm, it is a startup artefact, and it
  // makes a working site look dead.
  if (covered < MIN_HOURS_COVERED) return null;

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
            const night = isNightHour(hour);
            const pct = hourBarPercent(b, peak);
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
