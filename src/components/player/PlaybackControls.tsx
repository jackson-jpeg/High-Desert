"use client";

import { Button } from "@/components/win98";
import { usePlayerStore } from "@/stores/player-store";
import { cn } from "@/lib/utils/cn";

interface PlaybackControlsProps {
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onStop: () => void;
  className?: string;
}

export function PlaybackControls({
  onTogglePlay,
  onSeek,
  onStop,
  className,
}: PlaybackControlsProps) {
  const playing = usePlayerStore((s) => s.playing);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);

  const handleSeekBack = () => onSeek(position - 15);
  const handleSeekForward = () => onSeek(position + 30);

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSeek(Number(e.target.value));
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(Number(e.target.value));
  };

  const cycleRate = () => {
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const idx = rates.indexOf(playbackRate);
    setPlaybackRate(rates[(idx + 1) % rates.length]);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Seek bar */}
      <div className="flex items-center gap-2 text-[10px] text-bevel-dark">
        <span className="w-[45px] text-right tabular-nums">
          {formatTime(position)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          value={position}
          onChange={handleScrub}
          className="flex-1 h-[6px] accent-title-bar-blue cursor-pointer"
        />
        <span className="w-[45px] tabular-nums">{formatTime(duration)}</span>
      </div>

      {/* Transport buttons */}
      <div className="flex items-center gap-1 justify-center">
        <Button variant="dark" size="sm" onClick={handleSeekBack} title="Back 15s">
          -15
        </Button>
        <Button variant="dark" size="sm" onClick={onStop} title="Stop">
          {"\u25A0"}
        </Button>
        <Button
          variant="dark"
          onClick={onTogglePlay}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? "\u275A\u275A" : "\u25B6"}
        </Button>
        <Button variant="dark" size="sm" onClick={handleSeekForward} title="Forward 30s">
          +30
        </Button>
        <Button variant="dark" size="sm" onClick={cycleRate} title="Speed">
          {playbackRate}x
        </Button>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2 text-[10px] text-bevel-dark px-2">
        <span>Vol</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={handleVolumeChange}
          className="flex-1 h-[4px] accent-title-bar-blue cursor-pointer"
        />
        <span className="w-[28px] tabular-nums">
          {Math.round(volume * 100)}%
        </span>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
