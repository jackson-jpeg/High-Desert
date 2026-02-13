"use client";

import { useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { Oscilloscope } from "./Oscilloscope";
import { PlaybackControls } from "./PlaybackControls";
import { NowPlaying } from "./NowPlaying";
import { QueuePanel } from "./QueuePanel";
import { cn } from "@/lib/utils/cn";

interface AudioPlayerProps {
  className?: string;
}

export function AudioPlayer({ className }: AudioPlayerProps) {
  const { togglePlay, seek, stopPlayback, playNext, playPrevious } = useAudioPlayer();
  const currentEpisode = usePlayerStore((s) => s.currentEpisode);
  const mini = usePlayerStore((s) => s.mini);
  const error = usePlayerStore((s) => s.error);
  const toggleMini = usePlayerStore((s) => s.toggleMini);
  const clearError = usePlayerStore((s) => s.setError);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const [showQueue, setShowQueue] = useState(false);

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
      <span className="text-[10px] text-red-400">{error}</span>
      <div className="flex items-center gap-2 ml-2">
        <button
          onClick={handleRetry}
          className="text-[10px] text-desert-amber/80 hover:text-desert-amber cursor-pointer"
        >
          Retry
        </button>
        <button
          onClick={() => clearError(null)}
          className="text-[10px] text-red-400/60 hover:text-red-400 cursor-pointer"
        >
          Dismiss
        </button>
      </div>
    </div>
  );

  // Mini player: single row, compact
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

  // Expanded player
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
