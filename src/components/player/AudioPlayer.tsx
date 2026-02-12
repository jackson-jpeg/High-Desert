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
  const toggleMini = usePlayerStore((s) => s.toggleMini);

  if (!currentEpisode) return null;

  // Mini player: single row, compact
  if (mini) {
    return (
      <div
        className={cn(
          "w98-raised-dark bg-raised-surface px-3 py-2",
          "flex items-center gap-3",
          className,
        )}
      >
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
    );
  }

  // Expanded player
  return (
    <div
      className={cn(
        "w98-raised-dark bg-raised-surface p-3 flex flex-col gap-3",
        className,
      )}
    >
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
  );
}
