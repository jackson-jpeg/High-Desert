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
  const tune = useRadioDialStore((s) => s.tune);
  const [isOnline, setIsOnline] = useState(true);
  const [manualFreq, setManualFreq] = useState("");

  const handleFrequencyInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9.]/g, "");
    if (!raw) {
      setManualFreq("");
      return;
    }
    
    // Handle both AM (kHz) and FM (MHz) ranges
    const num = parseFloat(raw);
    let clamped: number;
    let band: 'AM' | 'FM';
    
    // Determine band based on input value
    if (num >= 530 && num <= 1700) {
      // AM band (530-1700 kHz)
      clamped = Math.max(530, Math.min(1700, num));
      band = 'AM';
    } else if (num >= 87.5 && num <= 108.0) {
      // FM band (87.5-108.0 MHz)
      clamped = Math.max(87.5, Math.min(108.0, num));
      band = 'FM';
    } else if (num < 530) {
      // Values below AM range default to AM minimum
      clamped = 530;
      band = 'AM';
    } else {
      // Default to FM max for high values
      clamped = 108.0;
      band = 'FM';
    }
    
    setManualFreq(clamped.toString());
    
    // Convert to internal frequency index
    // For AM: 530-1700 kHz maps to 0-1170
    // For FM: 87.5-108.0 MHz maps to 1171-1396 (offset by 1171)
    const internalFreq = band === 'AM' ? clamped - 530 : Math.round((clamped - 87.5) * 10) + 1171;
    tune(Math.max(0, internalFreq));
  }, [tune]);

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
      <input
        type="text"
        value={manualFreq}
        onChange={handleFrequencyInput}
        placeholder="530-1700 kHz / 87.5-108.0 MHz"
        maxLength={5}
        className="w-16 px-1.5 py-0.5 text-[10px] text-center bg-black/30 border border-bevel-dark/50 rounded font-mono text-desert-amber/80 focus:outline-none focus:border-desert-amber/60"
        aria-label="Manual frequency input (kHz or MHz)"
      />
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
