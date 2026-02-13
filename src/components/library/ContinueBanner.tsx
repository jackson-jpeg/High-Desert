"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/win98";
import type { Episode } from "@/lib/db/schema";
import { cn } from "@/lib/utils/cn";

interface ContinueBannerProps {
  episode: Episode;
  onResume: (episode: Episode) => void;
  onDismiss: () => void;
  className?: string;
}

const DISMISS_MS = 10000;

export function ContinueBanner({ episode, onResume, onDismiss, className }: ContinueBannerProps) {
  const [visible, setVisible] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  // Auto-dismiss after 10 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  // Countdown tick
  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 100), 100);
    return () => clearInterval(id);
  }, []);

  if (!visible) return null;

  const title = episode.title || episode.fileName;
  const progressPct = episode.duration && episode.playbackPosition
    ? Math.round((episode.playbackPosition / episode.duration) * 100)
    : 0;
  const posMin = Math.floor((episode.playbackPosition ?? 0) / 60);
  const posSec = Math.floor((episode.playbackPosition ?? 0) % 60);
  const countdownPct = Math.min(100, (elapsed / DISMISS_MS) * 100);

  return (
    <div
      className={cn(
        "w98-raised-dark bg-raised-surface relative overflow-hidden animate-slide-up",
        className,
      )}
    >
      {/* Countdown bar */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-transparent">
        <div
          className="h-full bg-desert-amber/40 transition-none"
          style={{ width: `${100 - countdownPct}%` }}
        />
      </div>

      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] text-bevel-dark">
              Continue listening?
            </span>
            {progressPct > 0 && (
              <span className="text-[8px] text-desert-amber/60 tabular-nums">
                {posMin}:{String(posSec).padStart(2, "0")} &middot; {progressPct}%
              </span>
            )}
          </div>
          <div className="text-[11px] text-desktop-gray font-bold truncate">
            {title}
          </div>
          {episode.guestName && (
            <div className="text-[9px] text-static-green/70 truncate mt-0.5">
              {episode.guestName}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button size="sm" variant="dark" onClick={() => onResume(episode)}>
            Resume
          </Button>
          <button
            onClick={() => {
              setVisible(false);
              onDismiss();
            }}
            className="text-[9px] text-bevel-dark hover:text-desktop-gray cursor-pointer transition-colors-fast"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
