"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/win98";
import type { Episode } from "@/db/schema";
import { cn } from "@/lib/utils/cn";

interface ContinueBannerProps {
  episode: Episode | null;
  onResume: (episode: Episode) => void;
  onDismiss: () => void;
  className?: string;
}

const DISMISS_MS = 15000;

export function ContinueBanner({ episode, onResume, onDismiss, className }: ContinueBannerProps) {
  if (!episode) {
    return (
      <div
        className={cn(
          "w98-raised-dark bg-raised-surface relative overflow-hidden animate-slide-up",
          className,
        )}
      >
        <div className="px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="h-[9px] bg-bevel-dark/10 rounded w-[100px] animate-skeleton mb-1" />
            <div className="h-[11px] bg-bevel-dark/10 rounded w-[200px] animate-skeleton" />
            <div className="h-[9px] bg-bevel-dark/10 rounded w-[120px] animate-skeleton mt-0.5" />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="h-[24px] bg-bevel-dark/10 rounded w-[70px] animate-skeleton" />
            <div className="h-[24px] bg-bevel-dark/10 rounded w-[50px] animate-skeleton" />
          </div>
        </div>
      </div>
    );
  }
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

  const progressPct = episode.duration && episode.playbackPosition
    ? Math.round((episode.playbackPosition / episode.duration) * 100)
    : 0;

  // Don't show for near-completed episodes or missing data
  if (!visible || progressPct > 95 || !episode?.id || !episode?.fileName) return null;

  const title = episode?.title || episode?.fileName || 'Unknown Episode';
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

      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] md:text-[9px] text-bevel-dark/60 mb-0.5">
            Continue listening
          </div>
          <div className="text-[13px] md:text-[11px] text-desktop-gray font-bold truncate">
            {title}
          </div>
          {episode.guestName && (
            <div className="text-[11px] md:text-[9px] text-static-green/50 truncate mt-0.5">
              {episode.guestName}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button size="sm" variant="dark" onClick={() => onResume(episode)}>
            {"\u25B6"} Resume
          </Button>
          <button
            onClick={() => {
              setVisible(false);
              onDismiss();
            }}
            className="text-[11px] md:text-[9px] text-bevel-dark hover:text-desktop-gray active:text-desktop-gray cursor-pointer transition-colors-fast min-h-[36px] md:min-h-0 px-2"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
