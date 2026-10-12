"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useLoadingHint } from "@/hooks/useLoadingHint";
import { lockScroll, unlockScroll } from "@/lib/utils/scroll-lock";
import { cn } from "@/lib/utils/cn";
import { emit, useHdEvent } from "@/lib/events";
import { toast } from "@/stores/toast-store";
import { LIVE_LOCKED_MESSAGE, liveLocked } from "@/stores/live-store";
import { formatAirDate, formatTime } from "@/lib/utils/format";
import { episodeTitle } from "@/lib/library/display-title";
import { shownGuest } from "@/lib/library/guest";
import { useOpenLibraryIntent } from "@/hooks/useOpenLibraryIntent";
import { Oscilloscope } from "@/components/player/Oscilloscope";
import { QueuePanel } from "@/components/player/QueuePanel";
import { MirrorBadge } from "@/components/player/MirrorBadge";
import { SleepTimer } from "@/components/player/SleepTimer";
import { BookmarkMarkers } from "@/components/player/BookmarkMarkers";
import { SeekRange, ProgressFill } from "@/components/player/PositionReadouts";
import { ledTime, marqueeText, nextRate, streamReadout } from "./winamp";

/**
 * The player in the Win98 look: a classic Winamp main window (docs/looks.md).
 *
 * It is a view, not a second player. Every control calls the functions
 * AudioPlayer passes down from useAudioPlayer() (`controls`) or the player
 * store's own actions, exactly as AudioPlayer's controls do; nothing here
 * touches the audio element. Like AudioPlayer it never selects `position`:
 * the LED clock, the seek bar and the progress line are leaves that do
 * (PositionReadouts.tsx and `LedClock` below), so a tick re-renders a clock.
 *
 * Desktop: the main window docked at the bottom, its details beside it; the
 * title bar's buttons shade it (one line), expand it (a big visualizer) or
 * stop. PL opens the queue as the playlist editor. Phone: a compact window
 * above the taskbar, and a full-screen Winamp when tapped.
 */

export interface WinampControls {
  togglePlay: () => void | Promise<void>;
  seek: (seconds: number) => void;
  stopPlayback: () => void;
  playNext: () => void;
  playPrevious: () => void;
}

const selectPosition = (s: { position: number }) => s.position;

/** The green LED clock. A leaf: the only part of the window that reads position. */
const LedClock = memo(function LedClock({
  duration,
  remaining,
  onToggle,
  big = false,
}: {
  duration: number;
  remaining: boolean;
  onToggle: () => void;
  big?: boolean;
}) {
  const position = usePlayerStore(selectPosition);
  const text = ledTime(position, duration, remaining);
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn("hd-w98-amp-led", big && "hd-w98-amp-led-big")}
      aria-label={`${remaining ? "Time remaining" : "Time elapsed"} ${text}. Switch`}
      title="Elapsed or remaining"
      data-testid="w98-amp-time"
    >
      <span className="hd-w98-amp-led-ghost" aria-hidden="true">
        {text.replace(/[0-9]/g, "8")}
      </span>
      <span className="hd-w98-amp-led-lit">{text}</span>
    </button>
  );
});

/** The scrolling title. Still (and truncated) with reduced motion, by CSS. */
function Marquee({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("hd-w98-amp-marquee", className)} title={text} data-testid="w98-amp-marquee">
      <div className="hd-w98-amp-marquee-track" aria-hidden="true">
        <span>{text}</span>
        <span>{text}</span>
      </div>
      <span className="sr-only">{text}</span>
    </div>
  );
}

function AmpButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
  className,
  testId,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-testid={testId}
      className={cn("hd-w98-amp-btn", className)}
    >
      {children}
    </button>
  );
}

export function WinampPlayer({ controls, className }: { controls: WinampControls; className?: string }) {
  const { togglePlay, seek, stopPlayback, playNext, playPrevious } = controls;
  const currentEpisode = usePlayerStore((s) => s.currentEpisode);
  const playing = usePlayerStore((s) => s.playing);
  const mini = usePlayerStore((s) => s.mini);
  const toggleMini = usePlayerStore((s) => s.toggleMini);
  const error = usePlayerStore((s) => s.error);
  const clearError = usePlayerStore((s) => s.setError);
  const rawBuffering = usePlayerStore((s) => s.buffering);
  const loadState = usePlayerStore((s) => s.loadState);
  const buffering = rawBuffering || loadState === "loading";
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const hasPrev = usePlayerStore((s) => s.queueIndex > 0);
  const hasNext = usePlayerStore((s) => {
    if (s.repeat === "one" || s.repeat === "all" || s.shuffle) return s.queue.length > 0;
    return s.queueIndex + 1 < s.queue.length;
  });
  const nextEpisode = usePlayerStore((s) => {
    const i = s.queueIndex + 1;
    return i < s.queue.length ? s.queue[i] : null;
  });
  const loadingHint = useLoadingHint();
  const isMobile = useIsMobile();
  const openLibrary = useOpenLibraryIntent();

  const [remaining, setRemaining] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [shade, setShade] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const toggleRemaining = useCallback(() => setRemaining((r) => !r), []);
  const collapse = useCallback(() => setExpanded(false), []);
  const { ref: expandedRef, onKeyDown: trapKeyDown } = useFocusTrap({ active: isMobile && expanded, onEscape: collapse });

  useEffect(() => {
    if (!(isMobile && expanded)) return;
    lockScroll();
    return () => unlockScroll();
  }, [isMobile, expanded]);

  // The status bar's double-click shades the window, as it collapses today's player.
  useHdEvent("toggle-ultra-mini", () => setShade((s) => !s));

  if (!currentEpisode) return null;

  const title = episodeTitle(currentEpisode);
  const marquee = marqueeText({ index: Math.max(0, queueIndex), title, duration });
  const stream = streamReadout(currentEpisode);
  const guest = shownGuest(currentEpisode);
  const playLabel = buffering ? "Buffering" : playing ? "Pause" : "Play";
  const state = buffering ? "buffering" : playing ? "playing" : "paused";

  const cycleRate = () => {
    if (liveLocked()) {
      toast.info(LIVE_LOCKED_MESSAGE);
      return;
    }
    const next = nextRate(playbackRate);
    setPlaybackRate(next);
    toast.info(`Speed: ${next}x`);
  };
  const back15 = () => seek(usePlayerStore.getState().position - 15);
  const fwd30 = () => seek(usePlayerStore.getState().position + 30);
  const eject = () => openLibrary({ scroll: "current" });
  const retry = () => {
    clearError(null);
    emit("play-episode", currentEpisode);
  };

  const errorStrip = error && loadState !== "failed" && (
    <div className="hd-w98-amp-error flex items-center gap-2 px-2 py-1" data-testid="player-error-banner" role="alert">
      <span className="flex-1 min-w-0 break-words text-hd-12">{error}</span>
      <button type="button" className="w98-raised-dark bg-raised-surface px-2 text-hd-12 min-h-touch md:min-h-0" onClick={retry}>
        Retry
      </button>
      <button type="button" className="w98-raised-dark bg-raised-surface px-2 text-hd-12 min-h-touch md:min-h-0" onClick={() => clearError(null)}>
        Dismiss
      </button>
    </div>
  );

  const titleBar = (opts: { onShade?: () => void; onExpand?: () => void; onClose: () => void; closeLabel: string; expandLabel?: string }) => (
    <div className="hd-w98-amp-titlebar" data-testid="w98-amp-titlebar">
      <span className="hd-w98-amp-title-icon" aria-hidden="true" />
      <span className="hd-w98-amp-stripes" aria-hidden="true" />
      <span className="hd-w98-amp-title-text">WINAMP</span>
      <span className="hd-w98-amp-stripes" aria-hidden="true" />
      {opts.onShade && (
        <button type="button" className="hd-w98-amp-tbtn" onClick={opts.onShade} aria-label={shade ? "Restore the window" : "Shade the window"} title="Windowshade">
          {shade ? "▿" : "–"}
        </button>
      )}
      {opts.onExpand && (
        <button type="button" className="hd-w98-amp-tbtn" onClick={opts.onExpand} aria-label={opts.expandLabel ?? "Expand player"} title={opts.expandLabel}>
          {"□"}
        </button>
      )}
      <button type="button" className="hd-w98-amp-tbtn" onClick={opts.onClose} aria-label={opts.closeLabel} title={opts.closeLabel} data-testid="w98-amp-close">
        {"×"}
      </button>
    </div>
  );

  const transport = (big: boolean) => (
    <div className={cn("hd-w98-amp-transport", big && "hd-w98-amp-transport-big")} role="group" aria-label="Transport">
      <AmpButton label="Previous track" onClick={playPrevious} disabled={!hasPrev} testId="w98-amp-prev">
        <span className="hd-w98-glyph-prev" aria-hidden="true" />
      </AmpButton>
      <AmpButton label={playLabel} onClick={() => void togglePlay()} testId="w98-amp-play" pressed={playing}>
        {buffering ? (
          <span aria-hidden="true">{"⧗"}</span>
        ) : playing ? (
          <span className="hd-w98-glyph-pause" aria-hidden="true" />
        ) : (
          <span className="hd-w98-glyph-play" aria-hidden="true" />
        )}
      </AmpButton>
      <AmpButton label="Stop playback" onClick={stopPlayback} testId="w98-amp-stop">
        <span className="hd-w98-glyph-stop" aria-hidden="true" />
      </AmpButton>
      <AmpButton label="Next track" onClick={playNext} disabled={!hasNext} testId="w98-amp-next">
        <span className="hd-w98-glyph-next" aria-hidden="true" />
      </AmpButton>
      <AmpButton label="Open the library at this show" onClick={eject} className="hd-w98-amp-eject" testId="w98-amp-eject">
        <span className="hd-w98-glyph-eject" aria-hidden="true" />
      </AmpButton>
      <span className="hd-w98-amp-spacer flex-1" />
      <AmpButton label={shuffle ? "Disable shuffle" : "Enable shuffle"} onClick={toggleShuffle} pressed={shuffle} className="hd-w98-amp-toggle" testId="w98-amp-shuffle">
        SHUFFLE
      </AmpButton>
      <AmpButton label={`Repeat mode: ${repeat}`} onClick={cycleRepeat} pressed={repeat !== "off"} className="hd-w98-amp-toggle" testId="w98-amp-repeat">
        {repeat === "one" ? "REP 1" : "REPEAT"}
      </AmpButton>
    </div>
  );

  const seekBar = (
    <div className="hd-w98-amp-seek relative" data-testid="w98-amp-seek">
      <SeekRange duration={duration} onSeek={seek} fullAria className="hd-w98-amp-range w-full relative z-[1]" />
      <BookmarkMarkers mode="markers" />
    </div>
  );

  const lcd = (big: boolean) => (
    <div className={cn("hd-w98-amp-lcd", big && "hd-w98-amp-lcd-big")}>
      <div className="flex items-start gap-2">
        <span className={cn("hd-w98-amp-state", `hd-w98-amp-state-${state}`)} aria-hidden="true" />
        <LedClock duration={duration} remaining={remaining} onToggle={toggleRemaining} big={big} />
      </div>
      <div className="hd-w98-amp-viz">
        <Oscilloscope className="w-full h-full" />
      </div>
    </div>
  );

  const info = (
    <div className="hd-w98-amp-info flex flex-col gap-[3px] min-w-0 flex-1">
      <Marquee text={marquee} />
      <div className="flex items-center gap-[6px] text-hd-micro">
        <span className="hd-w98-amp-readout tabular-nums">{stream.kbps}</span>
        <span className="hd-w98-amp-label">kbps</span>
        <span className="hd-w98-amp-readout tabular-nums">{stream.khz}</span>
        <span className="hd-w98-amp-label">kHz</span>
        <span className={cn("hd-w98-amp-light", stream.mono && "hd-w98-amp-light-on")}>mono</span>
        <span className={cn("hd-w98-amp-light", !stream.mono && "hd-w98-amp-light-on")}>stereo</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="hd-w98-amp-label text-hd-micro" aria-hidden="true">VOL</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Volume"
          aria-valuetext={`${Math.round(volume * 100)}%`}
          className="hd-w98-amp-range hd-w98-amp-vol flex-1 min-w-0"
          data-testid="w98-amp-volume"
        />
        <button type="button" className="hd-w98-amp-small" onClick={cycleRate} aria-label={`Playback speed ${playbackRate}x`} data-testid="w98-amp-speed">
          {playbackRate}x
        </button>
        <button
          type="button"
          className="hd-w98-amp-small"
          onClick={() => setShowQueue((q) => !q)}
          aria-expanded={showQueue}
          aria-pressed={showQueue}
          aria-label={showQueue ? "Hide queue" : "Show queue"}
          title="Playlist"
          data-testid="w98-amp-pl"
        >
          PL{queueLength > 0 ? ` ${queueLength}` : ""}
        </button>
      </div>
    </div>
  );

  const playlist = showQueue && (
    <div className="hd-w98-amp-playlist" data-testid="w98-amp-playlist">
      <div className="hd-w98-amp-titlebar">
        <span className="hd-w98-amp-stripes" aria-hidden="true" />
        <span className="hd-w98-amp-title-text">WINAMP PLAYLIST</span>
        <span className="hd-w98-amp-stripes" aria-hidden="true" />
        <button type="button" className="hd-w98-amp-tbtn" onClick={() => setShowQueue(false)} aria-label="Hide queue">
          {"×"}
        </button>
      </div>
      <div className="hd-w98-amp-playlist-body">
        <QueuePanel />
      </div>
    </div>
  );

  // ─── Phone: full-screen Winamp ───
  if (isMobile && expanded) {
    return (
      <div
        ref={expandedRef}
        role="dialog"
        aria-modal="true"
        aria-label="Now playing"
        tabIndex={-1}
        onKeyDown={trapKeyDown}
        data-testid="w98-amp-expanded"
        className="hd-w98-amp hd-w98-amp-full fixed inset-0 z-50 flex flex-col outline-none pt-[var(--safe-top)] pb-[var(--safe-bottom)]"
      >
        {titleBar({ onClose: collapse, closeLabel: "Minimize player" })}
        {errorStrip}
        <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-3 p-3">
          {showQueue ? (
            playlist
          ) : (
            <>
              {lcd(true)}
              {info}
              <div className="hd-w98-amp-nowplaying">
                <div className="font-bold">{title}</div>
                {guest && <div>{guest}</div>}
                {currentEpisode.airDate && <div className="tabular-nums">{formatAirDate(currentEpisode.airDate)}</div>}
                {(loadingHint || rawBuffering) && <div>{loadingHint ?? "Buffering..."}</div>}
                <MirrorBadge />
              </div>
              {seekBar}
              {transport(true)}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="hd-w98-amp-small" onClick={back15} aria-label="Seek back 15 seconds">-15</button>
                <button type="button" className="hd-w98-amp-small" onClick={fwd30} aria-label="Seek forward 30 seconds">+30</button>
                <SleepTimer variant="mobile" />
                <BookmarkMarkers mode="button" variant="mobile" />
              </div>
            </>
          )}
          {showQueue && (
            <button type="button" className="hd-w98-amp-small self-start" onClick={() => setShowQueue(false)}>
              Back to the player
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Phone: the compact window above the taskbar ───
  if (isMobile) {
    return (
      <div className={cn("hd-w98-amp hd-w98-amp-phone relative", className)} data-testid="w98-amp" data-state={state}>
        {errorStrip}
        {duration > 0 && (
          <div className="hd-w98-amp-progress" aria-hidden="true">
            <ProgressFill duration={duration} className="h-full" />
          </div>
        )}
        <div className="flex items-center gap-[6px] p-[4px]">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex items-center gap-[6px] flex-1 min-w-0 min-h-touch text-left"
            aria-label="Expand player"
            data-testid="w98-amp-expand"
          >
            <span className="hd-w98-amp-lcd hd-w98-amp-lcd-mini" aria-hidden="true">
              <span className={cn("hd-w98-amp-state", `hd-w98-amp-state-${state}`)} />
            </span>
            <Marquee text={marquee} className="flex-1 min-w-0" />
          </button>
          <MirrorBadge />
          <AmpButton label={playLabel} onClick={() => void togglePlay()} className="hd-w98-amp-btn-touch" testId="w98-amp-play">
            {buffering ? (
              <span aria-hidden="true">{"⧗"}</span>
            ) : playing ? (
              <span className="hd-w98-glyph-pause" aria-hidden="true" />
            ) : (
              <span className="hd-w98-glyph-play" aria-hidden="true" />
            )}
          </AmpButton>
          <AmpButton label="Next track" onClick={playNext} disabled={!hasNext} className="hd-w98-amp-btn-touch" testId="w98-amp-next">
            <span className="hd-w98-glyph-next" aria-hidden="true" />
          </AmpButton>
        </div>
      </div>
    );
  }

  // ─── Desktop: windowshade (one line) ───
  if (shade) {
    return (
      <div className={cn("hd-w98-amp-dock", className)} data-testid="w98-amp" data-state={state}>
        {errorStrip}
        <div className="hd-w98-amp hd-w98-amp-shade flex items-center gap-2" onDoubleClick={() => setShade(false)}>
          {titleBar({ onShade: () => setShade(false), onClose: stopPlayback, closeLabel: "Stop and close" })}
          <Marquee text={marquee} className="flex-1 min-w-0" />
          <LedClock duration={duration} remaining={remaining} onToggle={toggleRemaining} />
          {transport(false)}
        </div>
      </div>
    );
  }

  // ─── Desktop: the main window, and the big visualizer when expanded ───
  return (
    <div className={cn("hd-w98-amp-dock", className)} data-testid="w98-amp" data-state={state}>
      {errorStrip}
      <div className="flex items-stretch gap-[6px]">
        <div className="hd-w98-amp hd-w98-amp-main flex flex-col">
          {titleBar({
            onShade: () => setShade(true),
            onExpand: toggleMini,
            expandLabel: mini ? "Expand player" : "Minimize player",
            onClose: stopPlayback,
            closeLabel: "Stop and close",
          })}
          <div className="flex gap-[6px] p-[6px] pb-[3px]">
            {lcd(false)}
            {info}
          </div>
          <div className="px-[6px]">{seekBar}</div>
          <div className="p-[6px] pt-[4px]">{transport(false)}</div>
        </div>
        <div className="hd-w98-amp-details w98-raised-dark bg-raised-surface flex-1 min-w-0 flex flex-col gap-1 p-2" data-testid="w98-amp-details">
          <div className="flex items-start gap-2 min-w-0">
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-hd-12 font-bold truncate" title={title}>{title}</span>
              <span className="text-hd-11 text-bevel-dark truncate">
                {[guest, currentEpisode.airDate ? formatAirDate(currentEpisode.airDate) : null].filter(Boolean).join(" · ")}
              </span>
              {(loadingHint || rawBuffering) && <span className="text-hd-11 text-desert-amber">{loadingHint ?? "Buffering..."}</span>}
            </div>
            <MirrorBadge />
          </div>
          {nextEpisode && (
            <span className="text-hd-11 text-bevel-dark truncate" title={`Up next: ${episodeTitle(nextEpisode)}`}>
              Up next: {episodeTitle(nextEpisode)}
            </span>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-auto">
            <button type="button" className="w98-raised-dark bg-raised-surface px-2 text-hd-11" onClick={back15} aria-label="Seek back 15 seconds">-15</button>
            <button type="button" className="w98-raised-dark bg-raised-surface px-2 text-hd-11" onClick={fwd30} aria-label="Seek forward 30 seconds">+30</button>
            <span className="text-hd-11 tabular-nums text-bevel-dark">{formatTime(duration)}</span>
            <SleepTimer variant="desktop" />
            <BookmarkMarkers mode="button" variant="desktop" />
          </div>
        </div>
      </div>
      {!mini && (
        <div className="hd-w98-amp hd-w98-amp-avs mt-[6px]" data-testid="w98-amp-avs">
          <div className="hd-w98-amp-titlebar">
            <span className="hd-w98-amp-stripes" aria-hidden="true" />
            <span className="hd-w98-amp-title-text">VISUALIZATION</span>
            <span className="hd-w98-amp-stripes" aria-hidden="true" />
          </div>
          <div className="p-[4px] h-[180px]">
            <Oscilloscope className="w-full h-full" />
          </div>
        </div>
      )}
      {playlist}
    </div>
  );
}

