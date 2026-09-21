"use client";

import { cn } from "@/lib/utils/cn";
import type { Traffic } from "@/services/stats/client";
import { formatStamp, type TrafficRange } from "@/lib/library/traffic";

/**
 * The headline in a sentence. A grid of integers makes a reader do the
 * interpreting; this states the finding and lets the tiles below back it up.
 */
export function TrafficSummary({
  traffic,
  rangeLabel,
  range,
}: {
  traffic: Traffic;
  rangeLabel: string;
  range: TrafficRange;
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

export function TrafficLegend({ color, label, block }: { color: string; label: string; block?: boolean }) {
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

export function TrafficStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center p-2 w98-inset-dark bg-inset-well gap-0.5">
      <div className={cn("text-hd-title font-bold tabular-nums", color)}>{value}</div>
      <div className="text-hd-micro text-bevel-dark uppercase tracking-wider text-center">
        {label}
      </div>
    </div>
  );
}
