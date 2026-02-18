"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";

const RADIO_SHORTCUTS = [
  { keys: "\u2190 / \u2192", action: "Tune \u00b11 day" },
  { keys: "Shift+\u2190 / \u2192", action: "Tune \u00b130 days" },
  { keys: "Cmd+\u2190 / \u2192", action: "Tune \u00b11 year" },
  { keys: "\u2191 / \u2193", action: "Cycle same-date episodes" },
  { keys: "Enter", action: "Seek to nearest station" },
  { keys: "Space", action: "Play locked episode" },
  { keys: "S", action: "Start/stop scan" },
  { keys: "Scroll", action: "Fine tune (Shift=fast)" },
  { keys: "Ctrl+Scroll", action: "Zoom in/out" },
  { keys: "Pinch", action: "Zoom (mobile)" },
  { keys: "Esc", action: "Stop scan / back to Library" },
];

interface RadioShortcutsProps {
  className?: string;
}

export function RadioShortcuts({ className }: RadioShortcutsProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("relative", className)}>
      <button
        onClick={() => setOpen(!open)}
        className="text-[9px] text-bevel-dark/60 hover:text-desert-amber/60 cursor-pointer transition-colors-fast px-1"
        aria-label="Radio keyboard shortcuts"
      >
        ?
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 w98-raised-dark bg-raised-surface p-3 z-50 w-[220px] shadow-lg">
          <div className="text-[9px] text-desert-amber/70 font-bold mb-2 uppercase tracking-wider">
            Radio Shortcuts
          </div>
          <div className="flex flex-col gap-0.5">
            {RADIO_SHORTCUTS.map(({ keys, action }) => (
              <div key={keys} className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-desktop-gray/70">{action}</span>
                <span className="text-[8px] text-desert-amber/50 tabular-nums flex-shrink-0">{keys}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
