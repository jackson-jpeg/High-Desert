"use client";

import { useCallback } from "react";
import { Button } from "@/components/win98";
import { useRadioDialStore } from "@/stores/radio-dial-store";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils/cn";
import type { Episode } from "@/db/schema";

interface DialControlsProps {
  lockedEpisode: Episode | null;
  isLocked: boolean;
  onLockNearest: () => void;
  className?: string;
}

export function DialControls({
  lockedEpisode,
  isLocked,
  onLockNearest,
  className,
}: DialControlsProps) {
  const isMobile = useIsMobile();
  const scanning = useRadioDialStore((s) => s.scanning);
  const startScan = useRadioDialStore((s) => s.startScan);
  const stopScan = useRadioDialStore((s) => s.stopScan);

  const handleScanBack = useCallback(() => {
    if (scanning === "backward") {
      stopScan();
    } else {
      startScan("backward");
    }
  }, [scanning, startScan, stopScan]);

  const handleScanForward = useCallback(() => {
    if (scanning === "forward") {
      stopScan();
    } else {
      startScan("forward");
    }
  }, [scanning, startScan, stopScan]);

  const handleTuneIn = useCallback(() => {
    if (!lockedEpisode) return;
    window.dispatchEvent(
      new CustomEvent("hd:play-episode", { detail: lockedEpisode }),
    );
  }, [lockedEpisode]);

  // Mobile: glass-style buttons with SVG icons
  if (isMobile) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        {/* Primary action row */}
        <div className="flex items-center gap-2.5">
          {/* Lock / Seek */}
          <button
            onClick={onLockNearest}
            aria-label="Lock to nearest station"
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl",
              "border transition-colors-fast cursor-pointer active:scale-[0.97]",
              "bg-desert-amber/10 border-desert-amber/20",
            )}
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.2)" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="#D4A843" strokeWidth="1.3" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="#D4A843" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span className="text-[13px] font-medium text-desert-amber">Lock</span>
          </button>

          {/* Play / Tune In */}
          <button
            onClick={handleTuneIn}
            disabled={!isLocked || !lockedEpisode}
            aria-label="Tune in to locked station"
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl",
              "border transition-colors-fast cursor-pointer active:scale-[0.97]",
              isLocked
                ? "bg-static-green/[0.08] border-static-green/15"
                : "bg-bevel-dark/[0.06] border-bevel-dark/10 opacity-50",
            )}
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.2)" }}
          >
            <svg width="14" height="16" viewBox="0 0 14 16" fill="none">
              <polygon points="2,1 12,8 2,15" fill={isLocked ? "#4ADE80" : "#808080"} />
            </svg>
            <span className={cn("text-[13px] font-medium", isLocked ? "text-static-green" : "text-bevel-dark")}>
              Play
            </span>
          </button>

          {/* Scan */}
          <button
            onClick={scanning ? () => stopScan() : handleScanForward}
            aria-label={scanning ? "Stop scanning" : "Scan forward"}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl",
              "border transition-colors-fast cursor-pointer active:scale-[0.97]",
              scanning
                ? "bg-desert-amber/10 border-desert-amber/20"
                : "bg-bevel-dark/[0.06] border-bevel-dark/10",
            )}
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 2px 8px rgba(0,0,0,0.15)" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 8h10M10 5l3 3-3 3"
                stroke={scanning ? "#D4A843" : "rgba(192,192,192,0.5)"}
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className={cn("text-[13px] font-medium", scanning ? "text-desert-amber" : "text-desktop-gray/50")}>
              {scanning ? "Stop" : "Scan"}
            </span>
          </button>
        </div>

        {/* Keyboard hints */}
        <div className="flex items-center justify-center gap-5">
          <div className="flex items-center gap-1">
            <KbdArrow direction="left" />
            <KbdArrow direction="right" />
            <span className="text-[8px] text-bevel-dark/20 ml-0.5">Tune</span>
          </div>
          <div className="flex items-center gap-1">
            <KbdArrow direction="up" />
            <KbdArrow direction="down" />
            <span className="text-[8px] text-bevel-dark/20 ml-0.5">Sub-station</span>
          </div>
        </div>
      </div>
    );
  }

  // Desktop: Win98-style buttons (unchanged)
  return (
    <div className={cn("flex items-center gap-2 flex-wrap justify-center", className)}>
      <Button
        variant="dark"
        size="sm"
        onClick={handleScanBack}
        aria-label="Scan backward"
        className={scanning === "backward" ? "!text-desert-amber" : ""}
      >
        {scanning === "backward" ? "\u25C0 Stop" : "\u25C0\u25C0"}
      </Button>

      <Button
        variant="dark"
        size="sm"
        onClick={onLockNearest}
        aria-label="Seek to nearest station"
      >
        Seek
      </Button>

      <Button
        variant="dark"
        size="sm"
        onClick={handleTuneIn}
        disabled={!isLocked || !lockedEpisode}
        aria-label="Tune in to locked station"
        className={
          isLocked
            ? "!text-static-green-bright !border-static-green-bright/30"
            : ""
        }
      >
        {"\u25B6"} Tune In
      </Button>

      <Button
        variant="dark"
        size="sm"
        onClick={handleScanForward}
        aria-label="Scan forward"
        className={scanning === "forward" ? "!text-desert-amber" : ""}
      >
        {scanning === "forward" ? "Stop \u25B6" : "\u25B6\u25B6"}
      </Button>
    </div>
  );
}

/** Tiny keyboard arrow hint */
function KbdArrow({ direction }: { direction: "left" | "right" | "up" | "down" }) {
  const paths: Record<string, string> = {
    left: "M5 1L2 4l3 3",
    right: "M3 1l3 3-3 3",
    up: "M1 5l3-3 3 3",
    down: "M1 3l3 3 3-3",
  };
  return (
    <div className="flex items-center justify-center w-[18px] h-[18px] rounded border border-bevel-dark/10 bg-bevel-dark/[0.04]">
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d={paths[direction]} stroke="rgba(128,128,128,0.3)" strokeWidth="1" strokeLinecap="round" />
      </svg>
    </div>
  );
}
