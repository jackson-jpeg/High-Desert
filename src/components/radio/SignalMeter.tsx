"use client";

interface SignalMeterProps {
  signalStrength: number; // 0-1
  className?: string;
}

/**
 * 10 rectangular LED blocks, filled left-to-right in phosphor green.
 * Subtle pulse at full signal.
 */
export function SignalMeter({ signalStrength, className }: SignalMeterProps) {
  const safeSignal = typeof signalStrength === 'number' && !isNaN(signalStrength) ? signalStrength : 0;
  const filled = Math.round(safeSignal * 10);
  const isFull = filled === 10;

  return (
    <div
      className={`flex flex-col gap-1 ${className ?? ""}`}
      role="meter"
      aria-label="Signal strength"
      aria-valuemin={0}
      aria-valuemax={10}
      aria-valuenow={filled}
    >
      <div className="text-[8px] md:text-[7px] text-bevel-dark/60 uppercase tracking-wider">
        Signal
      </div>
      <div className="flex items-center gap-[2px]">
        {Array.from({ length: 10 }, (_, i) => {
          const isActive = i < filled;
          return (
            <div
              key={i}
              className="h-[12px] md:h-[10px] flex-1 min-w-[6px]"
              style={{
                backgroundColor: isActive
                  ? "#33FF33"
                  : "rgba(51, 255, 51, 0.08)",
                boxShadow: isActive
                  ? "0 0 4px rgba(51, 255, 51, 0.3)"
                  : "none",
                opacity: isActive && isFull ? undefined : isActive ? 0.9 : 1,
                animation:
                  isActive && isFull
                    ? "signal-pulse 2s ease-in-out infinite"
                    : "none",
                animationDelay: `${i * 80}ms`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
