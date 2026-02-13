"use client";

import { useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { Oscilloscope } from "./Oscilloscope";
import { PlaybackControls } from "./PlaybackControls";
import { NowPlaying } from "./NowPlaying";
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
  const toggleMini = usePlayerStore((s) => s.toggleMini);
  const clearError = usePlayerStore((s) => s.setError);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const hasPrev = usePlayerStore((s) => s.hasPrevious());
  const hasNext = usePlayerStore((s) => s.hasNext());
  const [showQueue, setShowQueue] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const isMobile = useIsMobile();

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
      <span className="text-[12px] md:text-[10px] text-red-400">{error}</span>
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
      <div className="fixed inset-0 z-50 bg-midnight/[.98] flex flex-col pt-[var(--safe-top)] pb-[var(--safe-bottom)]">
        {errorBanner}

        {/* Collapse chevron */}
        <div className="flex items-center justify-center py-2">
          <button
            onClick={() => setMobileExpanded(false)}
            className="text-[20px] text-bevel-dark active:text-desktop-gray cursor-pointer p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Minimize player"
          >
            {"\u2304"}
          </button>
        </div>

        {/* Oscilloscope */}
        <div className="px-4">
          <Oscilloscope className="w-full h-[120px] rounded-sm" />
        </div>

        {/* Now Playing — centered, larger */}
        <div className="px-6 py-4 text-center">
          <div className="text-[16px] text-desktop-gray font-bold truncate">
            {currentEpisode.title || currentEpisode.fileName}
          </div>
          {currentEpisode.guestName && (
            <div className="text-[14px] text-static-green/80 truncate mt-1">
              {currentEpisode.guestName}
            </div>
          )}
          {currentEpisode.airDate && (
            <div className="text-[12px] text-bevel-dark/70 mt-1">
              {currentEpisode.airDate}
            </div>
          )}
        </div>

        {/* Seek bar full-width */}
        <div className="px-4 flex items-center gap-2 text-[12px] text-bevel-dark">
          <span className="w-[50px] text-right tabular-nums">{formatTime(position)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={position}
            onChange={(e) => seek(Number(e.target.value))}
            className="flex-1 h-[6px] w98-range-dark cursor-pointer"
            aria-label="Seek position"
          />
          <span className="w-[50px] tabular-nums">{formatTime(duration)}</span>
        </div>

        {/* Transport: prev, -15, play/pause, +30, next */}
        <div className="flex items-center justify-center gap-4 py-4">
          <button
            onClick={playPrevious}
            disabled={!hasPrev}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[16px] text-desktop-gray disabled:opacity-30 cursor-pointer"
            aria-label="Previous track"
          >
            |&laquo;
          </button>
          <button
            onClick={() => seek(position - 15)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[14px] text-desktop-gray cursor-pointer"
            aria-label="Seek back 15 seconds"
          >
            -15
          </button>
          <button
            onClick={togglePlay}
            className="w-[64px] h-[64px] flex items-center justify-center text-[24px] text-desktop-gray w98-raised-dark bg-raised-surface rounded-full cursor-pointer"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? "\u275A\u275A" : "\u25B6"}
          </button>
          <button
            onClick={() => seek(position + 30)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[14px] text-desktop-gray cursor-pointer"
            aria-label="Seek forward 30 seconds"
          >
            +30
          </button>
          <button
            onClick={playNext}
            disabled={!hasNext}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[16px] text-desktop-gray disabled:opacity-30 cursor-pointer"
            aria-label="Next track"
          >
            &raquo;|
          </button>
        </div>

        {/* Volume + shuffle/repeat */}
        <div className="px-6">
          <PlaybackControls
            onTogglePlay={togglePlay}
            onSeek={seek}
            onStop={stopPlayback}
            onPrevious={playPrevious}
            onNext={playNext}
            mobileVolumeOnly
          />
        </div>

        {/* Queue toggle */}
        <div className="flex justify-center py-2">
          <button
            onClick={() => setShowQueue(!showQueue)}
            className={cn(
              "text-[14px] cursor-pointer px-4 py-2 min-h-[44px] transition-colors-fast",
              showQueue
                ? "text-desert-amber bg-desert-amber/10 w98-inset-dark"
                : "text-bevel-dark active:text-desktop-gray",
            )}
            aria-expanded={showQueue}
            aria-label={showQueue ? "Hide queue" : "Show queue"}
          >
            {"\u2630"} Queue
            {queueLength > 0 && (
              <span className="text-[12px] ml-1 tabular-nums">{queueLength}</span>
            )}
          </button>
        </div>

        {/* Queue panel */}
        {showQueue && (
          <div className="flex-1 overflow-auto">
            <QueuePanel />
          </div>
        )}
      </div>
    );
  }

  // ─── Mobile mini player ───
  if (isMobile && mini) {
    return (
      <div className={cn("w98-raised-dark bg-raised-surface", className)}>
        {errorBanner}
        <div className="flex items-center gap-2 px-3 py-2">
          {/* Tap to expand */}
          <button
            onClick={() => setMobileExpanded(true)}
            className="flex-1 min-w-0 text-left cursor-pointer active:bg-title-bar-blue/10"
            aria-label="Expand player"
          >
            <NowPlaying className="pointer-events-none" />
          </button>
          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[18px] text-desktop-gray cursor-pointer active:text-desert-amber"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? "\u275A\u275A" : "\u25B6"}
          </button>
          {/* Next */}
          <button
            onClick={playNext}
            disabled={!hasNext}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[16px] text-desktop-gray disabled:opacity-30 cursor-pointer"
            aria-label="Next track"
          >
            &raquo;|
          </button>
        </div>
      </div>
    );
  }

  // ─── Desktop mini player ───
  if (mini) {
    return (
      <div className={cn("w98-raised-dark bg-raised-surface", className)}>
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
