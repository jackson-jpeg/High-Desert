"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useSwipeDown } from "@/hooks/useSwipeDown";
import { lockScroll, unlockScroll } from "@/lib/utils/scroll-lock";
import { Oscilloscope } from "./Oscilloscope";
import { PlaybackControls } from "./PlaybackControls";
import { NowPlaying } from "./NowPlaying";
import { CassetteTape } from "./CassetteTape";
import { QueuePanel } from "./QueuePanel";
import { cn } from "@/lib/utils/cn";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { Button } from "@/components/win98";
import { formatTime } from "@/lib/utils/format";

interface AudioPlayerProps {
  className?: string;
}

export function AudioPlayer({ className }: AudioPlayerProps) {
  const { togglePlay, seek, stopPlayback, playNext, playPrevious } = useAudioPlayer();
  const currentEpisode = usePlayerStore((s) => s.currentEpisode);
  const playing = usePlayerStore((s) => s.playing);
  const mini = usePlayerStore((s) => s.mini);
  const error = usePlayerStore((s) => s.error);
  const buffering = usePlayerStore((s) => s.buffering);
  const toggleMini = usePlayerStore((s) => s.toggleMini);
  const clearError = usePlayerStore((s) => s.setError);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const hasPrev = usePlayerStore((s) => s.queueIndex > 0);
  const hasNext = usePlayerStore((s) => {
    if (s.repeat === "one" || s.repeat === "all" || s.shuffle) return s.queue.length > 0;
    return s.queueIndex + 1 < s.queue.length;
  });
  const [showQueue, setShowQueue] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [ultraMini, setUltraMini] = useState(false);
  const isMobile = useIsMobile();
  const mobileExpandedRef = useRef<HTMLDivElement>(null);
  const collapseMobilePlayer = useCallback(() => setMobileExpanded(false), []);
  const { swipeHandlers: mobilePlayerSwipe } = useSwipeDown({
    onDismiss: collapseMobilePlayer,
    targetRef: mobileExpandedRef,
    threshold: 80,
  });

  // Lock body scroll when mobile player is expanded
  useEffect(() => {
    if (!mobileExpanded) return;
    lockScroll();
    return () => unlockScroll();
  }, [mobileExpanded]);

  // Listen for double-click on status bar now-playing to toggle ultra-mini
  useEffect(() => {
    const handler = () => setUltraMini((prev) => !prev);
    window.addEventListener("hd:toggle-ultra-mini", handler);
    return () => window.removeEventListener("hd:toggle-ultra-mini", handler);
  }, []);

  if (!currentEpisode) return null;

  const handleRetry = () => {
    clearError(null);
    if (currentEpisode) {
      window.dispatchEvent(
        new CustomEvent("hd:play-episode", { detail: currentEpisode }),
      );
    }
  };

  const errorBanner = error && (
    <div className="flex items-center justify-between px-3 py-1.5 bg-red-900/30 border-b border-red-400/20">
      <span className="text-[12px] md:text-[10px] text-red-400 break-words min-w-0">{error}</span>
      <div className="flex items-center gap-2 ml-2">
        <button
          onClick={handleRetry}
          className="text-[12px] md:text-[10px] text-desert-amber/80 hover:text-desert-amber active:text-desert-amber cursor-pointer min-h-[44px] md:min-h-0 px-2"
        >
          Retry
        </button>
        <button
          onClick={() => clearError(null)}
          className="text-[12px] md:text-[10px] text-red-400/60 hover:text-red-400 active:text-red-400 cursor-pointer min-h-[44px] md:min-h-0 px-2"
        >
          Dismiss
        </button>
      </div>
    </div>
  );

  // ─── Mobile expanded overlay ───
  if (isMobile && mobileExpanded) {
    return (
      <div ref={mobileExpandedRef} className="fixed inset-0 z-50 bg-midnight/85 backdrop-blur-sm flex flex-col pt-[var(--safe-top)] pb-[var(--safe-bottom)]">
        {errorBanner}

        {/* Drag handle for swipe-down-to-dismiss */}
        <div
          className="flex justify-center pt-2 pb-0"
          {...mobilePlayerSwipe}
        >
          <div className="w-8 h-[3px] rounded-full bg-white/15" />
        </div>

        {/* Header: collapse + queue */}
        <div className="flex items-center justify-between px-3 py-1 glass-bevel border-b">
          <button
            onClick={() => setMobileExpanded(false)}
            className="text-[14px] text-bevel-dark active:text-desktop-gray cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Minimize player"
          >
            {"\u25BC"}
          </button>
          <span className="text-[11px] text-bevel-dark/50">Now Playing</span>
          <button
            onClick={() => setShowQueue(!showQueue)}
            className={cn(
              "text-[12px] cursor-pointer min-h-[44px] px-3 flex items-center gap-1 transition-colors-fast",
              showQueue ? "text-desert-amber" : "text-bevel-dark active:text-desktop-gray",
            )}
            aria-expanded={showQueue}
            aria-label={showQueue ? "Hide queue" : "Show queue"}
          >
            Queue
            {queueLength > 0 && (
              <span className="text-[11px] tabular-nums">({queueLength})</span>
            )}
          </button>
        </div>

        {showQueue ? (
          /* Queue panel takes full space */
          <div className="flex-1 overflow-auto overscroll-contain">
            <QueuePanel />
          </div>
        ) : (
          /* Player content */
          <div className="flex-1 flex flex-col justify-center px-4 gap-4">
            {/* Oscilloscope */}
            <Oscilloscope className="w-full h-[100px] rounded-sm" />

            {/* Now Playing */}
            <div className="text-center px-2">
              <div className="text-[16px] text-desktop-gray font-bold truncate" title={currentEpisode.title || currentEpisode.fileName}>
                {currentEpisode.title || currentEpisode.fileName}
              </div>
              {currentEpisode.guestName && (
                <div className="text-[13px] text-static-green/80 truncate mt-1">
                  {currentEpisode.guestName}
                </div>
              )}
              {currentEpisode.airDate && (
                <div className="text-[12px] text-bevel-dark/70 mt-1">
                  {currentEpisode.airDate}
                </div>
              )}
              {buffering && (
                <div className="text-[10px] text-desert-amber/70 mt-1 animate-pulse">
                  Buffering...
                </div>
              )}
            </div>

            {/* Seek bar */}
            <div className="flex items-center gap-2 text-[12px] text-bevel-dark">
              <span className="w-[45px] text-right tabular-nums">{formatTime(position)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                value={position}
                onChange={(e) => seek(Number(e.target.value))}
                className="flex-1 h-[8px] w98-range-dark cursor-pointer"
                aria-label="Seek position"
              />
              <span className="w-[45px] tabular-nums">{formatTime(duration)}</span>
            </div>

            {/* Transport buttons — using Win98 Button for consistency */}
            <div className="flex items-center justify-center gap-2">
              <Button variant="dark" size="sm" onClick={playPrevious} disabled={!hasPrev} aria-label="Previous track">
                |&laquo;
              </Button>
              <Button variant="dark" size="sm" onClick={() => seek(position - 15)} aria-label="Seek back 15 seconds">
                -15
              </Button>
              <Button variant="dark" onClick={togglePlay} aria-label={buffering ? "Buffering" : playing ? "Pause" : "Play"}>
                {buffering ? "\u29D7" : playing ? "\u275A\u275A" : "\u25B6"}
              </Button>
              <Button variant="dark" size="sm" onClick={() => seek(position + 30)} aria-label="Seek forward 30 seconds">
                +30
              </Button>
              <Button variant="dark" size="sm" onClick={playNext} disabled={!hasNext} aria-label="Next track">
                &raquo;|
              </Button>
            </div>

            {/* Volume + extras */}
            <PlaybackControls
              onTogglePlay={togglePlay}
              onSeek={seek}
              onStop={stopPlayback}
              onPrevious={playPrevious}
              onNext={playNext}
              mobileVolumeOnly
            />
          </div>
        )}
      </div>
    );
  }

  // ─── Mobile mini player ───
  if (isMobile && mini) {
    const progressPct = duration > 0 ? (position / duration) * 100 : 0;
    return (
      <div className={cn("w98-raised-dark bg-raised-surface glass-medium glass-promote relative", playing && "glass-glow-amber", className)}>
        {/* Mini progress bar at top */}
        {duration > 0 && (
          <div className="absolute top-0 left-0 right-0 h-[2px]">
            <div
              className="h-full bg-desert-amber/60 transition-[width] duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
        {errorBanner}
        <div className="flex items-center gap-1 px-2 py-1.5">
          {/* Tap to expand */}
          <button
            onClick={() => setMobileExpanded(true)}
            className="flex-1 min-w-0 text-left cursor-pointer active:bg-title-bar-blue/10 py-1 px-1"
            aria-label="Expand player"
          >
            <NowPlaying className="pointer-events-none" />
          </button>
          {/* Play/Pause */}
          <Button variant="dark" size="sm" onClick={togglePlay} aria-label={buffering ? "Buffering" : playing ? "Pause" : "Play"}>
            {buffering ? "\u29D7" : playing ? "\u275A\u275A" : "\u25B6"}
          </Button>
          {/* Next */}
          <Button variant="dark" size="sm" onClick={playNext} disabled={!hasNext} aria-label="Next track">
            {"\u00BB|"}
          </Button>
        </div>
      </div>
    );
  }

  // ─── Desktop ultra-mini taskbar player ───
  if (!isMobile && mini && ultraMini) {
    const progressPct = duration > 0 ? (position / duration) * 100 : 0;
    return (
      <div
        className={cn("w98-raised-dark bg-raised-surface h-[28px] flex items-center gap-2 px-2 relative", className)}
        onDoubleClick={() => setUltraMini(false)}
      >
        {/* Ultra-compact seek bar behind content */}
        {duration > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px]">
            <div className="h-full bg-desert-amber/50 transition-[width] duration-300" style={{ width: `${progressPct}%` }} />
          </div>
        )}
        {/* Cassette icon + title */}
        <CassetteTape className="flex-shrink-0" />
        <span className="text-[9px] text-desktop-gray/80 truncate flex-1 min-w-0">
          {currentEpisode.title || currentEpisode.fileName}
        </span>
        {/* Compact seek */}
        <input
          type="range"
          min={0}
          max={duration || 0}
          value={position}
          onChange={(e) => seek(Number(e.target.value))}
          className="w-[80px] h-[2px] w98-range-dark cursor-pointer flex-shrink-0"
          aria-label="Seek"
        />
        {/* Play/pause */}
        <Button variant="dark" size="sm" onClick={togglePlay} className="h-[22px] px-1.5 text-[9px]" aria-label={buffering ? "Buffering" : playing ? "Pause" : "Play"}>
          {buffering ? "\u29D7" : playing ? "\u275A\u275A" : "\u25B6"}
        </Button>
        {/* Next */}
        <Button variant="dark" size="sm" onClick={playNext} disabled={!hasNext} className="h-[22px] px-1.5 text-[9px]" aria-label="Next">
          {"\u00BB|"}
        </Button>
        {/* Expand */}
        <button onClick={() => setUltraMini(false)} className="text-[9px] text-bevel-dark hover:text-desktop-gray cursor-pointer flex-shrink-0" aria-label="Expand">{"\u25B2"}</button>
      </div>
    );
  }

  // ─── Desktop mini player ───
  if (mini) {
    const progressPctDesktop = duration > 0 ? (position / duration) * 100 : 0;
    return (
      <div className={cn("w98-raised-dark bg-raised-surface relative", className)}>
        {/* Mini progress bar at top */}
        {duration > 0 && (
          <div className="absolute top-0 left-0 right-0 h-[2px]">
            <div
              className="h-full bg-desert-amber/40 transition-[width] duration-300"
              style={{ width: `${progressPctDesktop}%` }}
            />
          </div>
        )}
        {errorBanner}
        <div className="flex items-center gap-3 px-3 py-2">
          <Oscilloscope className="w-[72px] h-[32px] rounded-sm flex-shrink-0" />
          <NowPlaying className="flex-1 min-w-0" />
          <PlaybackControls
            onTogglePlay={togglePlay}
            onSeek={seek}
            onStop={stopPlayback}
            onPrevious={playPrevious}
            onNext={playNext}
            className="flex-shrink-0 w-[340px]"
          />
          <button
            onClick={() => setShowQueue(!showQueue)}
            className={cn(
              "text-[10px] cursor-pointer ml-1 px-1.5 py-0.5 transition-colors-fast",
              showQueue
                ? "text-desert-amber bg-desert-amber/10 w98-inset-dark"
                : "text-bevel-dark hover:text-desktop-gray",
            )}
            title="Queue"
            aria-expanded={showQueue}
            aria-label={showQueue ? "Hide queue" : "Show queue"}
          >
            {"\u2630"}
            {queueLength > 0 && (
              <span className="text-[8px] ml-0.5 tabular-nums">{queueLength}</span>
            )}
          </button>
          <button
            onClick={toggleMini}
            className="text-[10px] text-bevel-dark hover:text-desktop-gray cursor-pointer ml-1"
            title="Expand player"
            aria-label="Expand player"
          >
            {"\u25B2"}
          </button>
        </div>
        {showQueue && <QueuePanel />}
      </div>
    );
  }

  // ─── Desktop expanded player ───
  return (
    <div
      className={cn(
        "w98-raised-dark bg-raised-surface flex flex-col",
        className,
      )}
    >
      {errorBanner}
      <div className="p-3 flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <NowPlaying expanded />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowQueue(!showQueue)}
              className={cn(
                "text-[10px] cursor-pointer px-1.5 py-0.5 transition-colors-fast",
                showQueue
                  ? "text-desert-amber bg-desert-amber/10 w98-inset-dark"
                  : "text-bevel-dark hover:text-desktop-gray",
              )}
              title="Queue"
              aria-expanded={showQueue}
              aria-label={showQueue ? "Hide queue" : "Show queue"}
            >
              {"\u2630"}
              {queueLength > 0 && (
                <span className="text-[8px] ml-0.5 tabular-nums">{queueLength}</span>
              )}
            </button>
            <button
              onClick={toggleMini}
              className="text-[10px] text-bevel-dark hover:text-desktop-gray cursor-pointer"
              title="Minimize player"
              aria-label="Minimize player"
            >
              {"\u25BC"}
            </button>
          </div>
        </div>
        <Oscilloscope className="w-full h-[80px] rounded-sm" />
        <PlaybackControls
          onTogglePlay={togglePlay}
          onSeek={seek}
          onStop={stopPlayback}
          onPrevious={playPrevious}
          onNext={playNext}
        />
      </div>
      {showQueue && <QueuePanel />}
    </div>
  );
}
