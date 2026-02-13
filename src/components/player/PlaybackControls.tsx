"use client";

import { Button } from "@/components/win98";
import { usePlayerStore } from "@/stores/player-store";
import { cn } from "@/lib/utils/cn";
import { formatTime } from "@/lib/utils/format";

interface PlaybackControlsProps {
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onStop: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Mobile expanded view: only render volume + shuffle/repeat */
  mobileVolumeOnly?: boolean;
  className?: string;
}

export function PlaybackControls({
  onTogglePlay,
  onSeek,
  onStop,
  onPrevious,
  onNext,
  mobileVolumeOnly = false,
  className,
}: PlaybackControlsProps) {
  const playing = usePlayerStore((s) => s.playing);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);
  const hasPrev = usePlayerStore((s) => s.hasPrevious());
  const hasNext = usePlayerStore((s) => s.hasNext());
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);

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

  // Mobile expanded player only shows volume + shuffle/repeat row
  if (mobileVolumeOnly) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        {/* Volume */}
        <div className="flex items-center gap-3 text-[12px] text-bevel-dark/70">
          <span className="text-[14px]">{volume === 0 ? "\u{1F507}" : "\u{1F509}"}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={handleVolumeChange}
            role="slider"
            aria-label="Volume"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={volume}
            aria-valuetext={`${Math.round(volume * 100)}%`}
            className="flex-1 h-[6px] w98-range-dark cursor-pointer"
          />
          <span className="w-[36px] tabular-nums text-bevel-dark/50">
            {Math.round(volume * 100)}%
          </span>
        </div>

        {/* Shuffle / Repeat / Speed */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={toggleShuffle}
            className={cn(
              "min-w-[44px] min-h-[44px] flex items-center justify-center text-[16px] cursor-pointer",
              shuffle ? "text-desert-amber" : "text-bevel-dark active:text-desktop-gray",
            )}
            aria-label={shuffle ? "Disable shuffle" : "Enable shuffle"}
          >
            {"\u21C6"}
          </button>
          <button
            onClick={cycleRepeat}
            className={cn(
              "min-w-[44px] min-h-[44px] flex items-center justify-center text-[16px] cursor-pointer",
              repeat !== "off" ? "text-desert-amber" : "text-bevel-dark active:text-desktop-gray",
            )}
            aria-label={`Repeat mode: ${repeat}`}
          >
            {repeat === "one" ? "\u21BB1" : "\u21BB"}
          </button>
          <button
            onClick={cycleRate}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[14px] text-desktop-gray cursor-pointer"
            aria-label={`Playback speed ${playbackRate}x`}
          >
            {playbackRate}x
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Seek bar */}
      <div className="flex items-center gap-2 text-[12px] md:text-[10px] text-bevel-dark">
        <span className="w-[45px] text-right tabular-nums">
          {formatTime(position)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          value={position}
          onChange={handleScrub}
          role="slider"
          aria-label="Seek position"
          aria-valuemin={0}
          aria-valuemax={duration || 0}
          aria-valuenow={position}
          aria-valuetext={formatTime(position)}
          className="flex-1 h-[6px] w98-range-dark cursor-pointer"
        />
        <span className="w-[45px] tabular-nums">{formatTime(duration)}</span>
      </div>

      {/* Transport buttons */}
      <div className="flex items-center gap-2 justify-center">
        {onPrevious && (
          <Button variant="dark" size="sm" onClick={onPrevious} disabled={!hasPrev} title="Previous" aria-label="Previous track">
            |&laquo;
          </Button>
        )}
        <Button variant="dark" size="sm" onClick={handleSeekBack} title="Back 15s" aria-label="Seek back 15 seconds">
          -15
        </Button>
        <Button variant="dark" size="sm" onClick={onStop} title="Stop" aria-label="Stop playback">
          {"\u25A0"}
        </Button>
        <Button
          variant="dark"
          onClick={onTogglePlay}
          title={playing ? "Pause" : "Play"}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "\u275A\u275A" : "\u25B6"}
        </Button>
        <Button variant="dark" size="sm" onClick={handleSeekForward} title="Forward 30s" aria-label="Seek forward 30 seconds">
          +30
        </Button>
        {onNext && (
          <Button variant="dark" size="sm" onClick={onNext} disabled={!hasNext} title="Next" aria-label="Next track">
            &raquo;|
          </Button>
        )}
        <Button variant="dark" size="sm" onClick={cycleRate} title="Speed" aria-label={`Playback speed ${playbackRate}x`}>
          {playbackRate}x
        </Button>
        <button
          onClick={toggleShuffle}
          className={cn(
            "min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center text-[14px] md:text-[10px] cursor-pointer ml-1 px-1",
            shuffle ? "text-desert-amber" : "text-bevel-dark hover:text-desktop-gray",
          )}
          title={shuffle ? "Shuffle on" : "Shuffle off"}
          aria-label={shuffle ? "Disable shuffle" : "Enable shuffle"}
        >
          {"\u21C6"}
        </button>
        <button
          onClick={cycleRepeat}
          className={cn(
            "min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center text-[14px] md:text-[10px] cursor-pointer px-1",
            repeat !== "off" ? "text-desert-amber" : "text-bevel-dark hover:text-desktop-gray",
          )}
          title={`Repeat: ${repeat}`}
          aria-label={`Repeat mode: ${repeat}`}
        >
          {repeat === "one" ? "\u21BB1" : "\u21BB"}
        </button>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2 text-[12px] md:text-[10px] text-bevel-dark/70 px-2">
        <span className="text-[11px] md:text-[9px]">{volume === 0 ? "\u{1F507}" : "\u{1F509}"}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={handleVolumeChange}
          role="slider"
          aria-label="Volume"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={volume}
          aria-valuetext={`${Math.round(volume * 100)}%`}
          className="flex-1 h-[4px] w98-range-dark cursor-pointer"
        />
        <span className="w-[28px] tabular-nums text-bevel-dark/50">
          {Math.round(volume * 100)}%
        </span>
      </div>
    </div>
  );
}
