"use client";

import { memo, type CSSProperties } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { formatTime } from "@/lib/utils/format";

/**
 * The only components that subscribe to `position`.
 *
 * `position` changes four times a second for as long as a show plays. When
 * AudioPlayer and PlaybackControls selected it themselves, every tick
 * re-rendered the whole player — cassette, oscilloscope, queue and all — to move
 * a thumb and a clock (HD-017). These leaves re-render instead, and nothing
 * above them sees the tick. `src/components/player/__tests__/render-pressure.test.tsx`
 * holds AudioPlayer to that.
 */

const selectPosition = (s: { position: number }) => s.position;

/** "12:34" — the playhead. */
export const PositionTime = memo(function PositionTime({ className }: { className?: string }) {
  const position = usePlayerStore(selectPosition);
  return <span className={className}>{formatTime(position)}</span>;
});

/** The scrub control. `duration` comes from the parent, which changes rarely. */
export const SeekRange = memo(function SeekRange({
  duration,
  onSeek,
  className,
  ariaLabel = "Seek position",
  fullAria = false,
}: {
  duration: number;
  onSeek: (seconds: number) => void;
  className?: string;
  ariaLabel?: string;
  /** Emit the explicit slider aria-* attributes PlaybackControls has always carried. */
  fullAria?: boolean;
}) {
  const position = usePlayerStore(selectPosition);
  return (
    <input
      type="range"
      min={0}
      max={duration || 0}
      value={position}
      onChange={(e) => onSeek(Number(e.target.value))}
      className={className}
      aria-label={ariaLabel}
      {...(fullAria
        ? {
            role: "slider",
            "aria-valuemin": 0,
            "aria-valuemax": duration || 0,
            "aria-valuenow": position,
            "aria-valuetext": formatTime(position),
          }
        : {})}
    />
  );
});

/** A bar filled to the playhead: `width` is position / duration. */
export const ProgressFill = memo(function ProgressFill({
  duration,
  className,
  style,
}: {
  duration: number;
  className?: string;
  style?: CSSProperties;
}) {
  const position = usePlayerStore(selectPosition);
  const pct = duration > 0 ? (position / duration) * 100 : 0;
  return <div className={className} style={{ ...style, width: `${pct}%` }} />;
});

/**
 * How much is downloaded ahead of the playhead. Hidden once the playhead has
 * caught up with the buffer, which is why it needs `position` too.
 */
export const BufferedFill = memo(function BufferedFill({ duration }: { duration: number }) {
  const position = usePlayerStore(selectPosition);
  const bufferedTo = usePlayerStore((s) => s.bufferedTo);
  if (!(duration > 0 && bufferedTo > position)) return null;
  return (
    <div
      className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] pointer-events-none"
      aria-hidden="true"
    >
      <div
        className="h-full bg-desert-amber/25 transition-[width] duration-500"
        style={{ width: `${Math.min(100, (bufferedTo / duration) * 100)}%` }}
      />
    </div>
  );
});
