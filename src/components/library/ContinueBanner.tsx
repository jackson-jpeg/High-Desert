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

export function ContinueBanner({ episode, onResume, onDismiss, className }: ContinueBannerProps) {
  const [visible, setVisible] = useState(true);

  // Auto-dismiss after 10 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, 10000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (!visible) return null;

  const title = episode.title || episode.fileName;

  return (
    <div
      className={cn(
        "w98-raised-dark bg-raised-surface px-4 py-3 flex items-center justify-between gap-3 animate-slide-up",
        className,
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-bevel-dark mb-0.5">
          Continue listening?
        </div>
        <div className="text-[11px] text-desktop-gray font-bold truncate">
          {title}
        </div>
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
          className="text-[9px] text-bevel-dark hover:text-desktop-gray cursor-pointer"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
