"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Window } from "@/components/win98";
import { useRadioDialStore } from "@/stores/radio-dial-store";
import { useRadioDial } from "@/hooks/useRadioDial";
import { useRadioStatic } from "@/hooks/useRadioStatic";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { TuningStrip } from "./TuningStrip";
import { FrequencyDisplay } from "./FrequencyDisplay";
import { SignalMeter } from "./SignalMeter";
import { DialControls } from "./DialControls";
import type { Episode } from "@/db/schema";

interface RadioDialProps {
  episodes: Episode[] | undefined;
}

export function RadioDial({ episodes }: RadioDialProps) {
  const router = useRouter();
  const isMobile = useIsMobile();

  const position = useRadioDialStore((s) => s.position);
  const lockedEpisode = useRadioDialStore((s) => s.lockedEpisode);
  const signalStrength = useRadioDialStore((s) => s.signalStrength);
  const staticEnabled = useRadioDialStore((s) => s.staticEnabled);
  const scanning = useRadioDialStore((s) => s.scanning);
  const subStationIndex = useRadioDialStore((s) => s.subStationIndex);
  const tune = useRadioDialStore((s) => s.tune);
  const setPosition = useRadioDialStore((s) => s.setPosition);
  const stopScan = useRadioDialStore((s) => s.stopScan);

  const {
    index,
    currentStation,
    isLocked,
    frequency,
    currentDate,
    sameDateStations,
    lockToNearest,
    jumpToYear,
    cycleSubStation,
  } = useRadioDial(episodes);

  const { ensureInitialized } = useRadioStatic({
    signalStrength,
    isLocked,
    enabled: staticEnabled,
  });

  // Initialize audio on first interaction
  const handleInteraction = useCallback(() => {
    ensureInitialized();
  }, [ensureInitialized]);

  // Keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.code) {
        case "ArrowLeft":
          e.preventDefault();
          ensureInitialized();
          if (e.ctrlKey || e.metaKey) tune(-365);
          else if (e.shiftKey) tune(-30);
          else tune(-1);
          break;

        case "ArrowRight":
          e.preventDefault();
          ensureInitialized();
          if (e.ctrlKey || e.metaKey) tune(365);
          else if (e.shiftKey) tune(30);
          else tune(1);
          break;

        case "ArrowUp":
          if (sameDateStations.length > 1) {
            e.preventDefault();
            cycleSubStation(-1);
          }
          break;

        case "ArrowDown":
          if (sameDateStations.length > 1) {
            e.preventDefault();
            cycleSubStation(1);
          }
          break;

        case "Enter":
          e.preventDefault();
          lockToNearest();
          break;

        case "Space":
          e.preventDefault();
          if (lockedEpisode) {
            window.dispatchEvent(
              new CustomEvent("hd:play-episode", { detail: lockedEpisode }),
            );
          }
          break;

        case "KeyS":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            const { scanning: sc } = useRadioDialStore.getState();
            if (sc) stopScan();
            else useRadioDialStore.getState().startScan("forward");
          }
          break;

        case "Escape":
          e.preventDefault();
          if (scanning) {
            stopScan();
          } else {
            router.push("/library");
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    tune,
    lockToNearest,
    lockedEpisode,
    scanning,
    stopScan,
    sameDateStations,
    cycleSubStation,
    router,
    ensureInitialized,
  ]);

  // Year quick-jump bar
  const yearBar = index ? (
    <div
      className="flex items-center gap-0.5 overflow-x-auto pb-0.5"
      role="tablist"
      aria-label="Jump to year"
    >
      {index.years.map((year) => (
        <button
          key={year}
          onClick={() => {
            ensureInitialized();
            jumpToYear(year);
          }}
          className="text-[9px] md:text-[8px] px-1.5 py-0.5 min-h-[28px] md:min-h-0 text-desert-amber/60 hover:text-desert-amber cursor-pointer transition-colors-fast whitespace-nowrap flex-shrink-0"
          role="tab"
          aria-label={`Jump to ${year}`}
        >
          {year}
        </button>
      ))}
    </div>
  ) : null;

  if (!index) {
    return (
      <div className="flex items-center justify-center h-full text-bevel-dark text-[11px]">
        Loading station index...
      </div>
    );
  }

  // Mobile layout: full-screen glass overlay
  if (isMobile) {
    return (
      <div
        className="flex flex-col h-full glass-heavy pt-[var(--safe-top)]"
        role="application"
        aria-label="AM Radio Dial"
        onClick={handleInteraction}
      >
        {/* CRT Display */}
        <div className="flex-shrink-0 mx-3 mt-2">
          <FrequencyDisplay
            frequency={frequency}
            currentDate={currentDate}
            currentStation={currentStation}
            isLocked={isLocked}
            signalStrength={signalStrength}
            sameDateCount={sameDateStations.length}
            subStationIndex={subStationIndex}
          />
        </div>

        {/* Year quick-jump */}
        <div className="flex-shrink-0 mx-3 mt-1">{yearBar}</div>

        {/* Tuning Strip */}
        <div className="flex-1 mx-3 my-2 min-h-[120px]">
          <TuningStrip index={index} className="rounded" />
        </div>

        {/* Controls + Signal */}
        <div className="flex-shrink-0 px-3 pb-2 flex flex-col gap-2">
          <SignalMeter signalStrength={signalStrength} />
          <DialControls
            lockedEpisode={lockedEpisode}
            isLocked={isLocked}
            onLockNearest={lockToNearest}
            className="justify-center flex-wrap"
          />
        </div>
      </div>
    );
  }

  // Desktop layout: Window component
  return (
    <Window
      title="AM Radio Dial"
      variant="dark"
      onClose={() => router.push("/library")}
      className="flex flex-col h-full"
    >
      <div
        className="flex flex-col gap-2 p-2 flex-1"
        role="application"
        aria-label="AM Radio Dial"
        onClick={handleInteraction}
      >
        {/* CRT Display */}
        <FrequencyDisplay
          frequency={frequency}
          currentDate={currentDate}
          currentStation={currentStation}
          isLocked={isLocked}
          signalStrength={signalStrength}
          sameDateCount={sameDateStations.length}
          subStationIndex={subStationIndex}
        />

        {/* Year quick-jump */}
        {yearBar}

        {/* Tuning Strip */}
        <div className="flex-1 min-h-[80px] w98-inset-dark rounded">
          <TuningStrip index={index} className="rounded" />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-3">
          <DialControls
            lockedEpisode={lockedEpisode}
            isLocked={isLocked}
            onLockNearest={lockToNearest}
            className="flex-1"
          />
          <SignalMeter
            signalStrength={signalStrength}
            className="w-[120px] flex-shrink-0"
          />
        </div>
      </div>
    </Window>
  );
}
