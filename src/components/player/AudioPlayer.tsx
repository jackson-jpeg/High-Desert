"use client";

import { usePlayerStore } from "@/stores/player-store";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { Oscilloscope } from "./Oscilloscope";
import { PlaybackControls } from "./PlaybackControls";
import { NowPlaying } from "./NowPlaying";
import { cn } from "@/lib/utils/cn";

interface AudioPlayerProps {
  className?: string;
}

export function AudioPlayer({ className }: AudioPlayerProps) {
  const { togglePlay, seek, stopPlayback } = useAudioPlayer();
  const currentEpisode = usePlayerStore((s) => s.currentEpisode);
  const mini = usePlayerStore((s) => s.mini);
  const error = usePlayerStore((s) => s.error);
  const toggleMini = usePlayerStore((s) => s.toggleMini);
  const clearError = usePlayerStore((s) => s.setError);

  if (!currentEpisode) return null;

  const errorBanner = error && (
    <div className="flex items-center justify-between px-3 py-1.5 bg-red-900/30 border-b border-red-400/20">
      <span className="text-[10px] text-red-400">{error}</span>
      <button
        onClick={() => clearError(null)}
        className="text-[10px] text-red-400/60 hover:text-red-400 cursor-pointer ml-2"
      >
        Dismiss
      </button>
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
            className="flex-shrink-0 w-[280px]"
          />
          <button
            onClick={toggleMini}
            className="text-[10px] text-bevel-dark hover:text-desktop-gray cursor-pointer ml-1"
            title="Expand player"
          >
            {"\u25B2"}
          </button>
        </div>
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
        <button
          onClick={toggleMini}
          className="text-[10px] text-bevel-dark hover:text-desktop-gray cursor-pointer"
          title="Minimize player"
        >
          {"\u25BC"}
        </button>
      </div>
      <Oscilloscope className="w-full h-[80px] rounded-sm" />
      <PlaybackControls
        onTogglePlay={togglePlay}
        onSeek={seek}
        onStop={stopPlayback}
      />
      </div>
    </div>
  );
}
