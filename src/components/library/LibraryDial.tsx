"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Episode } from "@/db/schema";
import { useRadioDialStore } from "@/stores/radio-dial-store";
import { useRadioDial } from "@/hooks/useRadioDial";
import { useRadioStatic } from "@/hooks/useRadioStatic";
import { useRadioDialKeys } from "@/hooks/useRadioDialKeys";
import { useOnAirSlot } from "@/hooks/useLiveStation";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { TuningStrip } from "@/components/radio/TuningStrip";
import { FrequencyDisplay } from "@/components/radio/FrequencyDisplay";
import { SignalMeter } from "@/components/radio/SignalMeter";
import { DialControls } from "@/components/radio/DialControls";
import { YearTabs } from "@/components/radio/YearTabs";
import { LiveDialLamp, airDateDayIndex } from "@/components/radio/LiveDialLamp";
import { ShowTitle } from "@/components/library/ShowTitle";
import { episodeTitle } from "@/lib/library/display-title";
import { shownGuest } from "@/lib/library/guest";
import { formatAirDate } from "@/lib/utils/format";
import { emit } from "@/lib/events";

/**
 * The Library's Dial mode (preview looks only, src/lib/look/nav.ts): the
 * radio dial that used to be its own tab, spinning through the shows the
 * library has on screen, so the show tabs, search and filters narrow the
 * dial too.
 *
 * Nothing here is a second audio path. Tuning, scanning and locking are
 * `useRadioDial` and the radio store; a scan's preview is the layout's
 * `scan-preview` (src/audio/scan-preview.ts); Play is `emit("play-episode")`.
 * A locked show opens in the library's detail panel: as the dial passes it
 * on a wide screen (`autoOpen`), or from the station card's Details button.
 *
 * The markup is the same in every look. Looks style it through the `hd-dial*`
 * class hooks (html[data-look=…] in src/styles/look-*.css).
 */
export function LibraryDial({
  episodes,
  selectedEpisode,
  autoOpen,
  onOpen,
  onEscape,
  onClearFilters,
}: {
  /** The library's visible shows, in any order (the dial sorts by air date). */
  episodes: Episode[];
  /** The show open in the detail panel; the dial starts on it. */
  selectedEpisode: Episode | null;
  /** Open each show the dial locks onto in the detail panel. */
  autoOpen: boolean;
  onOpen: (episode: Episode) => void;
  /** Escape with no scan running. */
  onEscape: () => void;
  /** Offered when the filters leave the dial empty. */
  onClearFilters?: () => void;
}) {
  const isMobile = useIsMobile();
  const zoom = useRadioDialStore((s) => s.zoom);
  const setZoom = useRadioDialStore((s) => s.setZoom);
  const lockedEpisode = useRadioDialStore((s) => s.lockedEpisode);
  const signalStrength = useRadioDialStore((s) => s.signalStrength);
  const staticEnabled = useRadioDialStore((s) => s.staticEnabled);
  const scanning = useRadioDialStore((s) => s.scanning);
  const subStationIndex = useRadioDialStore((s) => s.subStationIndex);
  const tune = useRadioDialStore((s) => s.tune);
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

  const onAirSlot = useOnAirSlot();
  const onAirDay = index ? airDateDayIndex(onAirSlot?.airDate, index.earliest) : null;

  const { ensureInitialized } = useRadioStatic({ signalStrength, isLocked, enabled: staticEnabled });

  useRadioDialKeys({
    tune,
    lockToNearest,
    lockedEpisode,
    scanning,
    stopScan,
    sameDateStations,
    cycleSubStation,
    ensureInitialized,
    onEscape,
  });

  // Start on the show the listener had open, once the index exists. Runs
  // after useRadioDial's own "start in the middle", so this one wins.
  const startOn = useRef(selectedEpisode?.airDate ?? null);
  useEffect(() => {
    if (!index || startOn.current === null) return;
    const day = airDateDayIndex(startOn.current, index.earliest);
    startOn.current = null;
    if (day !== null) useRadioDialStore.getState().setPosition(Math.max(0, Math.min(day, index.totalDays)));
  }, [index]);

  // A locked show opens in the detail panel as the dial passes it, after a
  // beat so dragging past a run of shows does not open each one. Once per
  // show: closing the panel on a show does not reopen it.
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
  const autoOpened = useRef<number | undefined>(selectedEpisode?.id);
  useEffect(() => {
    if (!autoOpen || !lockedEpisode || lockedEpisode.id === autoOpened.current) return;
    const ep = lockedEpisode;
    const t = setTimeout(() => {
      autoOpened.current = ep.id;
      onOpenRef.current(ep);
    }, AUTO_OPEN_DELAY_MS);
    return () => clearTimeout(t);
  }, [autoOpen, lockedEpisode]);

  // Leaving Dial mode stops a scan and its preview; a scan left running in
  // the store would restart the moment the dial came back.
  useEffect(() => {
    return () => {
      useRadioDialStore.getState().stopScan();
      emit("scan-preview-stop");
    };
  }, []);

  const selectYear = useCallback(
    (year: number) => {
      ensureInitialized();
      jumpToYear(year);
    },
    [ensureInitialized, jumpToYear],
  );

  if (!index) {
    const undated = episodes.length > 0;
    return (
      <section className="hd-dial hd-dial-empty flex flex-col items-center justify-center h-full gap-3 p-6 text-center" data-testid="library-dial" aria-label="Radio dial">
        <p className="hd-dial-empty-title text-hd-title text-desktop-gray">
          {undated ? "No dated shows here" : "Nothing on the dial"}
        </p>
        <p className="hd-dial-empty-body text-hd-body text-bevel-dark max-w-[320px]">
          {undated
            ? "The dial places shows by air date, and none of these has one."
            : "No shows match the current filters, so there is nothing to tune to."}
        </p>
        {onClearFilters && (
          <button type="button" className="hd-dial-button w98-raised-dark bg-raised-surface text-desktop-gray min-h-touch md:min-h-0 px-3 py-1 text-hd-caption" onClick={onClearFilters}>
            Clear filters
          </button>
        )}
      </section>
    );
  }

  const station = isLocked ? currentStation?.episode ?? null : null;
  const guest = station ? shownGuest(station) : undefined;

  return (
    <section
      className="hd-dial flex flex-col gap-2 md:gap-3 p-2 md:p-3 h-full overflow-auto"
      data-testid="library-dial"
      data-scanning={scanning ?? undefined}
      data-locked={isLocked || undefined}
      role="application"
      aria-label="Radio dial"
      onClick={ensureInitialized}
    >
      <div className="hd-dial-readout flex-shrink-0">
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

      <div className="hd-dial-years flex-shrink-0">
        <YearTabs
          years={index.years.filter((y) => Number.isFinite(y))}
          currentYear={currentDate ? currentDate.getFullYear() : null}
          isMobile={isMobile}
          onSelect={selectYear}
        />
      </div>

      <div className="hd-dial-strip flex-shrink-0 flex gap-1 h-[150px] md:h-[200px]">
        <div className="hd-dial-strip-well relative flex-1 min-w-0 w98-inset-dark rounded">
          <TuningStrip index={index} onAirDay={onAirDay} className="rounded" />
          {/* A hook for a look that draws its own needle; the canvas draws one. */}
          <span className="hd-dial-needle" aria-hidden="true" />
        </div>
        {!isMobile && (
          <div className="hd-dial-zoom flex flex-col items-center justify-center gap-1 w-[24px]">
            <button
              type="button"
              onClick={() => setZoom(zoom + 0.5)}
              className="hd-dial-zoom-button text-hd-caption text-bevel-dark hover:text-desktop-gray cursor-pointer w-full text-center"
              aria-label="Zoom in"
              title="Zoom in (Ctrl+Scroll)"
            >+</button>
            <span className="text-hd-micro text-bevel-dark tabular-nums">{zoom.toFixed(1)}x</span>
            <button
              type="button"
              onClick={() => setZoom(zoom - 0.5)}
              className="hd-dial-zoom-button text-hd-caption text-bevel-dark hover:text-desktop-gray cursor-pointer w-full text-center"
              aria-label="Zoom out"
              title="Zoom out (Ctrl+Scroll)"
            >-</button>
          </div>
        )}
      </div>

      <div className="hd-dial-controls flex-shrink-0 flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
        <DialControls
          lockedEpisode={lockedEpisode}
          isLocked={isLocked}
          onLockNearest={lockToNearest}
          className="hd-dial-buttons md:flex-1 md:justify-start"
        />
        <SignalMeter signalStrength={signalStrength} className="hd-dial-signal md:w-[120px] flex-shrink-0" />
      </div>

      <div
        className="hd-dial-station flex-shrink-0 flex items-center gap-3 min-h-[56px] px-3 py-2 w98-inset-dark"
        data-testid="dial-station"
        aria-live="polite"
      >
        {station ? (
          <>
            <div className="flex-1 min-w-0">
              <ShowTitle title={episodeTitle(station)} className="hd-dial-station-title text-hd-body text-desktop-gray" />
              <p className="hd-dial-station-meta text-hd-caption text-bevel-dark truncate">
                {[formatAirDate(station.airDate), guest].filter(Boolean).join(" · ")}
              </p>
            </div>
            <button
              type="button"
              data-testid="dial-open-details"
              className="hd-dial-button w98-raised-dark bg-raised-surface text-desktop-gray min-h-touch md:min-h-0 px-3 py-1 text-hd-caption flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(station);
              }}
            >
              Details
            </button>
          </>
        ) : (
          <p className="hd-dial-station-idle text-hd-caption text-bevel-dark">
            {scanning
              ? "Scanning the band. It pauses on each show."
              : isMobile
                ? "Drag the dial to tune. Lock finds the nearest show."
                : "Drag the dial or use the arrow keys. Enter locks, Space plays, S scans."}
          </p>
        )}
      </div>

      <div className="hd-dial-onair flex-shrink-0">
        <LiveDialLamp slot={onAirSlot} earliest={index.earliest} />
      </div>
    </section>
  );
}

/** How long the dial rests on a show before it opens in the detail panel. */
export const AUTO_OPEN_DELAY_MS = 300;
