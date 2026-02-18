"use client";

import { cn } from "@/lib/utils/cn";

interface MiniWaveformProps {
  progress: number; // 0-100
  completed: boolean;
  className?: string;
}

const BAR_HEIGHTS = [4, 6, 8, 6, 4];
const THRESHOLDS = [20, 40, 60, 80, 100];

export function MiniWaveform({ progress, completed, className }: MiniWaveformProps) {
  return (
    <div className={cn("flex items-end gap-[1px] h-[8px]", className)}>
      {BAR_HEIGHTS.map((h, i) => {
        const filled = completed || progress >= THRESHOLDS[i] - 20;
        return (
          <div
            key={i}
            className={cn(
              "w-[2px] rounded-[0.5px] transition-colors duration-300",
              filled
                ? completed
                  ? "bg-static-green/70"
                  : "bg-phosphor-amber/80"
                : "bg-bevel-dark/20",
            )}
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
  );
}
