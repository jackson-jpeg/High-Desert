"use client";

import { cn } from "@/lib/utils/cn";

export interface ProgressBarProps {
  value: number; // 0 to 100
  variant?: "classic" | "dark";
  className?: string;
}

export function ProgressBar({
  value,
  variant = "dark",
  className,
}: ProgressBarProps) {
  const clampedValue = Math.min(100, Math.max(0, value));
  const segmentCount = Math.floor(clampedValue / 5);

  return (
    <div
      className={cn(
        "w98-progress-well",
        variant === "dark" && "!bg-inset-well !border-[#0A0E1A] !shadow-[inset_1px_1px_0_#060810]",
        className,
      )}
      role="progressbar"
      aria-valuenow={clampedValue}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="w98-progress-chunk" style={{ width: `${clampedValue}%` }}>
        {Array.from({ length: segmentCount }, (_, i) => (
          <div
            key={i}
            className={cn(
              "w98-progress-segment",
              variant === "dark" && "!bg-title-bar-blue",
            )}
          />
        ))}
      </div>
    </div>
  );
}
