"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/win98";
import { usePlayerStore } from "@/stores/player-store";
import { SleepTimer } from "./SleepTimer";
import { BookmarkMarkers } from "./BookmarkMarkers";
import { cn } from "@/lib/utils/cn";
import { formatTime } from "@/lib/utils/format";
import { toast } from "@/stores/toast-store";

/** Tooltip showing the next episode info on hover */
function NextEpisodeTooltip() {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const nextEp = usePlayerStore((s) => {
    const idx = s.queueIndex + 1;
    if (idx < s.queue.length) return s.queue[idx];
    if (s.repeat === "all" && s.queue.length > 0) return s.queue[0];
    return null;
  });

  const handleEnter = () => {
    setShow(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShow(false), 2000);
  };
  const handleLeave = () => {
    setShow(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  return { nextEp, show, handleEnter, handleLeave };
}

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
  const buffering = usePlayerStore((s) => s.buffering);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);
  const hasPrev = usePlayerStore((s) => s.queueIndex > 0);
  const hasNext = usePlayerStore((s) => {
    if (s.repeat === "one" || s.repeat === "all" || s.shuffle) return s.queue.length > 0;
    return s.queueIndex + 1 < s.queue.length;
  });
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);

  // Seek preview tooltip
  const [seekPreview, setSeekPreview] = useState<{ time: number; x: number } | null>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);

  const handleSeekHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration || !seekBarRef.current) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setSeekPreview({ time: pct * duration, x: e.clientX - rect.left });
  }, [duration]);

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
    const newRate = rates[(idx + 1) % rates.length];
    setPlaybackRate(newRate);
    toast.info(`Speed: ${newRate}x`);
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
            className="flex-1 h-[16px] md:h-[6px] w98-range-dark cursor-pointer"
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
              "min-w-[44px] min-h-[44px] flex items-center justify-center text-[18px] cursor-pointer active:scale-95 transition-transform",
              shuffle ? "text-desert-amber" : "text-bevel-dark active:text-desktop-gray",
            )}
            aria-label={shuffle ? "Disable shuffle" : "Enable shuffle"}
            aria-pressed={shuffle}
          >
            {"\u21C6"}
          </button>
          <button
            onClick={cycleRepeat}
            className={cn(
              "min-w-[44px] min-h-[44px] flex items-center justify-center text-[18px] cursor-pointer active:scale-95 transition-transform",
              repeat !== "off" ? "text-desert-amber" : "text-bevel-dark active:text-desktop-gray",
            )}
            aria-label={`Repeat mode: ${repeat}`}
            aria-pressed={repeat !== "off"}
          >
            {repeat === "one" ? "\u21BB1" : "\u21BB"}
          </button>
          <button
            onClick={cycleRate}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[16px] text-desktop-gray cursor-pointer active:scale-95 transition-transform"
            aria-label={`Playback speed ${playbackRate}x`}
          >
            {playbackRate}x
          </button>
          <SleepTimer variant="mobile" />
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
        <div
          ref={seekBarRef}
          className="flex-1 relative"
          onMouseMove={handleSeekHover}
          onMouseLeave={() => setSeekPreview(null)}
        >
          {/* Visual progress fill behind the range input */}
          {duration > 0 && (
            <div className="absolute top-1/2 left-0 right-0 h-[4px] -mt-[2px] pointer-events-none z-0 overflow-hidden rounded-sm">
              <div
                className="h-full bg-desert-amber/25 transition-[width] duration-100"
                style={{ width: `${(position / duration) * 100}%` }}
              />
            </div>
          )}
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={position || 0}
            onChange={handleScrub}
            role="slider"
            aria-label="Seek position"
            aria-valuemin={0}
            aria-valuemax={duration || 0}
            aria-valuenow={position || 0}
            aria-valuetext={formatTime(position)}
            className="w-full h-[20px] md:h-[6px] w98-range-dark cursor-pointer relative z-[1]"
          />
          <BookmarkMarkers mode="markers" />
          {/* Seek preview tooltip */}
          {seekPreview && (
            <div
              className="absolute bottom-full mb-1 -translate-x-1/2 pointer-events-none z-20"
              style={{ left: seekPreview.x }}
            >
              <div className="bg-midnight/95 text-desert-amber text-[9px] px-1.5 py-0.5 tabular-nums border border-bevel-dark/30 whitespace-nowrap">
                {formatTime(seekPreview.time)}
              </div>
            </div>
          )}
        </div>
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
          title={buffering ? "Buffering" : playing ? "Pause" : "Play"}
          aria-label={buffering ? "Buffering" : playing ? "Pause" : "Play"}
        >
          {buffering ? "\u29D7" : playing ? "\u275A\u275A" : "\u25B6"}
        </Button>
        <Button variant="dark" size="sm" onClick={handleSeekForward} title="Forward 30s" aria-label="Seek forward 30 seconds">
          +30
        </Button>
        {onNext && (
          <NextButtonWithTooltip onNext={onNext} hasNext={hasNext} />
        )}
        <Button variant="dark" size="sm" onClick={cycleRate} title="Speed" aria-label={`Playback speed ${playbackRate}x`}>
          {playbackRate}x
        </Button>
        <button
          onClick={toggleShuffle}
          className={cn(
            "min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center text-[16px] md:text-[10px] cursor-pointer ml-1 px-1 active:scale-95 transition-transform",
            shuffle ? "text-desert-amber" : "text-bevel-dark hover:text-desktop-gray active:text-desktop-gray",
          )}
          title={shuffle ? "Shuffle on" : "Shuffle off"}
          aria-label={shuffle ? "Disable shuffle" : "Enable shuffle"}
          aria-pressed={shuffle}
        >
          {"\u21C6"}
        </button>
        <button
          onClick={cycleRepeat}
          className={cn(
            "min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center text-[16px] md:text-[10px] cursor-pointer px-1 active:scale-95 transition-transform",
            repeat !== "off" ? "text-desert-amber" : "text-bevel-dark hover:text-desktop-gray active:text-desktop-gray",
          )}
          title={`Repeat: ${repeat}`}
          aria-label={`Repeat mode: ${repeat}`}
          aria-pressed={repeat !== "off"}
        >
          {repeat === "one" ? "\u21BB1" : "\u21BB"}
        </button>
      </div>

      {/* Volume + Sleep timer */}
      <div className="flex items-center gap-2 text-[12px] md:text-[10px] text-bevel-dark/70 px-2">
        <button
          onClick={toggleMute}
          className="text-[11px] md:text-[9px] cursor-pointer hover:text-desert-amber transition-colors"
          title={volume === 0 ? "Unmute" : "Mute"}
          aria-label={volume === 0 ? "Unmute" : "Mute"}
        >
          {volume === 0 ? "\u{1F507}" : "\u{1F509}"}
        </button>
        <VolumeKnob volume={volume} />
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
        <SleepTimer variant="desktop" />
        <BookmarkMarkers mode="button" variant="desktop" />
      </div>
    </div>
  );
}

/** Next button with "Up Next" tooltip on hover (desktop only) */
function NextButtonWithTooltip({ onNext, hasNext }: { onNext: () => void; hasNext: boolean }) {
  const { nextEp, show, handleEnter, handleLeave } = NextEpisodeTooltip();

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <Button variant="dark" size="sm" onClick={onNext} disabled={!hasNext} title="Next" aria-label="Next track">
        &raquo;|
      </Button>
      {show && nextEp && (
        <div className="hidden md:block absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="w98-raised-dark bg-raised-surface px-2 py-1.5 max-w-[200px] whitespace-nowrap">
            <div className="text-[9px] text-bevel-dark/50 mb-0.5">Up Next</div>
            <div className="text-[9px] text-desktop-gray truncate">{nextEp.title || nextEp.fileName}</div>
            {nextEp.guestName && <div className="text-[9px] text-static-green/70 truncate">{nextEp.guestName}</div>}
            {nextEp.airDate && <div className="text-[9px] text-bevel-dark/60">{nextEp.airDate}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Tiny decorative volume knob SVG (desktop only) */
function VolumeKnob({ volume }: { volume: number }) {
  // 0% = 7 o'clock (210°), 100% = 5 o'clock (150° + 360° = 510°), ~300° range
  const angle = 210 + volume * 300;
  const rad = (angle * Math.PI) / 180;
  const cx = 10, cy = 10, r = 6;
  const nx = cx + Math.cos(rad) * r * 0.7;
  const ny = cy + Math.sin(rad) * r * 0.7;

  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      className="hidden md:block flex-shrink-0"
      aria-hidden="true"
    >
      <circle cx={cx} cy={cy} r={r} fill="var(--color-bevel-dark, #2a2a2a)" stroke="var(--color-bevel-dark, #333)" strokeWidth={1} />
      <line
        x1={cx}
        y1={cy}
        x2={nx}
        y2={ny}
        stroke="var(--color-desert-amber, #d4a84b)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  );
}
