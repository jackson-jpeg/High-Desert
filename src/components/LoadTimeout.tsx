"use client";

import { cn } from "@/lib/utils/cn";

/**
 * What a screen shows when the browser's database has not answered in
 * `DB_WAIT_MS` (src/hooks/useTimedLiveQuery.ts): never a spinner that runs
 * forever. Both looks style it through the w98 classes and `hd-load-timeout`.
 */
export function LoadTimeout({
  what,
  onRetry,
  compact = false,
  className,
}: {
  /** "Your library", "Your listening stats". */
  what: string;
  onRetry: () => void;
  /** One line, for small places (Mel's Hole). */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      data-testid="load-timeout"
      className={cn(
        "hd-load-timeout flex flex-col items-center justify-center text-center",
        compact ? "gap-2 py-3 px-3" : "gap-3 py-16 px-8",
        className,
      )}
    >
      <div className="text-hd-13 text-desktop-gray">{what} is taking too long to load.</div>
      {!compact && (
        <div className="text-hd-11 text-bevel-dark leading-relaxed max-w-[300px]">
          Another High Desert tab or the installed app may be holding it. Close the others, then try again.
        </div>
      )}
      <button
        type="button"
        data-testid="load-timeout-retry"
        onClick={onRetry}
        className="text-hd-11 text-signal-blue cursor-pointer transition-colors-fast px-3 py-1.5 min-h-touch md:min-h-0 w98-raised-dark bg-raised-surface"
      >
        Retry
      </button>
    </div>
  );
}
