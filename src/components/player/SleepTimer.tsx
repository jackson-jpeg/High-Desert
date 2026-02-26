"use client";

import { useState, useRef } from "react";
import { useSleepTimerStore } from "@/stores/sleep-timer-store";
import { cn } from "@/lib/utils/cn";

const PRESETS: { label: string; minutes: number }[] = [
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "45m", minutes: 45 },
  { label: "60m", minutes: 60 },
  { label: "90m", minutes: 90 },
];

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface SleepTimerProps {
  variant?: "desktop" | "mobile";
}

export function SleepTimer({ variant = "desktop" }: SleepTimerProps) {
  const active = useSleepTimerStore((s) => s.active);
  const remaining = useSleepTimerStore((s) => s.remaining);
  const start = useSleepTimerStore((s) => s.start);
  const cancel = useSleepTimerStore((s) => s.cancel);

  // Handle sleep timer completion
  useEffect(() => {
    if (active && remaining <= 0) {
      const audio = document.querySelector("audio");
      if (audio && audio.pause) {
        audio.pause();
      }
      cancel();
    }
  }, [active, remaining, cancel]);
  const [open, setOpen] = useState(false);
  const [customMin, setCustomMin] = useState("");
  const customRef = useRef<HTMLInputElement>(null);

  const isMobile = variant === "mobile";

  // Active timer display
  if (active) {
    return (
      <button
        onClick={cancel}
        className={cn(
          "flex items-center gap-1 cursor-pointer transition-colors-fast",
          isMobile
            ? "min-w-[44px] min-h-[44px] justify-center text-[13px] text-desert-amber"
            : "text-[9px] text-desert-amber hover:text-desert-amber/70 px-1.5 py-0.5 tabular-nums",
        )}
        title="Cancel sleep timer"
        aria-label={`Sleep timer: ${formatRemaining(remaining)} remaining. Click to cancel.`}
      >
        <span className={isMobile ? "text-[10px]" : "text-[8px]"}>
          {"\u{1F319}"}
        </span>
        {formatRemaining(remaining)}
      </button>
    );
  }

  // Closed state — just a moon button
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "cursor-pointer transition-colors-fast",
          isMobile
            ? "min-w-[44px] min-h-[44px] flex items-center justify-center text-[16px] text-bevel-dark active:text-desktop-gray"
            : "text-[10px] text-bevel-dark hover:text-desktop-gray px-1",
        )}
        title="Sleep timer"
        aria-label="Set sleep timer"
        aria-expanded={false}
      >
        {"\u{1F319}"}
      </button>
    );
  }

  // Open — show presets
  return (
    <div className={cn(
      "flex items-center gap-1",
      isMobile ? "gap-2" : "",
    )}>
      {PRESETS.map(({ label, minutes }) => (
        <button
          key={minutes}
          onClick={() => {
            start(minutes);
            setOpen(false);
          }}
          className={cn(
            "cursor-pointer transition-colors-fast",
            isMobile
              ? "min-w-[44px] min-h-[44px] flex items-center justify-center text-[13px] text-desktop-gray active:text-desert-amber"
              : "text-[9px] text-bevel-dark hover:text-desktop-gray px-1 py-0.5",
          )}
        >
          {label}
        </button>
      ))}
      <input
        ref={customRef}
        type="number"
        min={1}
        max={480}
        value={customMin}
        onChange={(e) => setCustomMin(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const mins = parseInt(customMin, 10);
            if (mins >= 1 && mins <= 480) {
              start(mins);
              setOpen(false);
              setCustomMin("");
            }
          }
        }}
        placeholder="min"
        className={cn(
          "bg-inset-well w98-inset-dark text-desktop-gray text-center outline-none tabular-nums",
          isMobile
            ? "w-[52px] h-[44px] text-[13px] px-1"
            : "w-[36px] h-[18px] text-[9px] px-0.5",
        )}
        aria-label="Custom sleep timer minutes"
      />
      <button
        onClick={() => { setOpen(false); setCustomMin(""); }}
        className={cn(
          "cursor-pointer transition-colors-fast",
          isMobile
            ? "min-w-[44px] min-h-[44px] flex items-center justify-center text-[13px] text-bevel-dark/50"
            : "text-[9px] text-bevel-dark/50 hover:text-desktop-gray px-1",
        )}
      >
        {"\u2715"}
      </button>
    </div>
  );
}
