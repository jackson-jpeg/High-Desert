"use client";

import { useCallback, useState, useEffect } from "react";
import { Button } from "@/components/win98";
import { useRadioDialStore } from "@/stores/radio-dial-store";
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
  const scanning = useRadioDialStore((s) => s.scanning);
  const startScan = useRadioDialStore((s) => s.startScan);
  const stopScan = useRadioDialStore((s) => s.stopScan);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

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
    if (!lockedEpisode || !isOnline) return;
    window.dispatchEvent(
      new CustomEvent("hd:play-episode", { detail: lockedEpisode }),
    );
  }, [lockedEpisode, isOnline]);

  return (
    <div className={`flex items-center gap-2 md:gap-2 flex-wrap justify-center ${className ?? ""}`}>
      {!isOnline && (
        <span className="text-xs text-red-400 font-mono select-none animate-pulse">
          OFFLINE
        </span>
      )}
      <Button
        variant="dark"
        size="sm"
        onClick={handleScanBack}
        disabled={!isOnline}
        aria-label="Scan backward"
        className={scanning === "backward" ? "!text-desert-amber" : ""}
      >
        {scanning === "backward" ? "\u25C0 Stop" : "\u25C0\u25C0"}
      </Button>

      <Button
        variant="dark"
        size="sm"
        onClick={onLockNearest}
        disabled={!isOnline}
        aria-label="Seek to nearest station"
      >
        Seek
      </Button>

      <Button
        variant="dark"
        size="sm"
        onClick={handleTuneIn}
        disabled={!isLocked || !lockedEpisode || !isOnline}
        aria-label="Tune in to locked station"
        className={
          isLocked && isOnline
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
        disabled={!isOnline}
        aria-label="Scan forward"
        className={scanning === "forward" ? "!text-desert-amber" : ""}
      >
        {scanning === "forward" ? "Stop \u25B6" : "\u25B6\u25B6"}
      </Button>
    </div>
  );
}
