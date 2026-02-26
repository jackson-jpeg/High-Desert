"use client";

import { useState, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import type { Bookmark } from "@/db/schema";
import { usePlayerStore } from "@/stores/player-store";
import { useAdminStore } from "@/stores/admin-store";
import { addBookmark, removeBookmark } from "@/services/episodes/management";
import { toast } from "@/stores/toast-store";
import { formatTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

interface BookmarkMarkersProps {
  /** Absolute-positioned markers overlay on a seek bar */
  mode: "markers";
  className?: string;
}

interface BookmarkButtonProps {
  /** Button to add a bookmark at current position */
  mode: "button";
  variant?: "desktop" | "mobile";
  className?: string;
}

type Props = BookmarkMarkersProps | BookmarkButtonProps;

export function BookmarkMarkers(props: Props) {
  const episodeId = usePlayerStore((s) => s.currentEpisode?.id);
  const duration = usePlayerStore((s) => s.duration);

  const bookmarks = useLiveQuery(
    async () => {
      if (!episodeId) return [];
      try {
        return await db.bookmarks.where("episodeId").equals(episodeId).sortBy("position");
      } catch {
        return [];
      }
    },
    [episodeId],
  );

  if (props.mode === "button") {
    return <BookmarkButton variant={props.variant ?? "desktop"} className={props.className} />;
  }

  if (!bookmarks || bookmarks.length === 0 || !duration) {
    return (
      <div className={cn("text-[11px] text-bevel-dark/70 px-2 py-1", props.className)}>
        No bookmarks available
      </div>
    );
  }

  return (
    <div className={cn("absolute inset-0 pointer-events-none", props.className)}>
      {bookmarks.map((bm) => {
        const pct = (bm.position / duration) * 100;
        return (
          <button
            key={bm.id}
            className="absolute top-0 bottom-0 w-[6px] -ml-[3px] pointer-events-auto cursor-pointer group"
            style={{ left: `${pct}%` }}
            onClick={(e) => {
              e.stopPropagation();
              const audio = document.querySelector("audio");
              if (audio && audio.currentTime !== null && typeof audio.currentTime === 'number') {
                audio.currentTime = bm.position;
              }
              usePlayerStore.getState().setPosition(bm.position);
            }}
            title={`${bm.label} (${formatTime(bm.position)})`}
          >
            <div className="absolute top-0 bottom-0 left-1/2 w-[2px] -ml-[1px] bg-desert-amber/80" />
            <div className="absolute -top-1 left-1/2 -ml-[3px] w-[6px] h-[6px] bg-desert-amber rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        );
      })}
    </div>
  );
}

function BookmarkButton({ variant, className }: { variant: "desktop" | "mobile"; className?: string }) {
  const [showInput, setShowInput] = useState(false);
  const [label, setLabel] = useState("");
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const episodeId = usePlayerStore((s) => s.currentEpisode?.id);
  const position = usePlayerStore((s) => s.position);

  const handleAdd = useCallback(async () => {
    if (!episodeId) return;
    const text = label.trim() || `Bookmark at ${formatTime(position)}`;
    await addBookmark(episodeId, position, text);
    toast.info(`Bookmark added at ${formatTime(position)}`);
    setLabel("");
    setShowInput(false);
  }, [episodeId, position, label]);

  if (!isAdmin || !episodeId) return null;

  if (showInput) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
            if (e.key === "Escape") setShowInput(false);
          }}
          placeholder="Label..."
          autoFocus
          className="bg-inset-well w98-inset-dark px-2 py-1.5 md:px-1.5 md:py-0.5 text-[16px] md:text-[10px] text-desktop-gray outline-none flex-1 md:w-[100px] md:flex-initial"
        />
        <button
          onClick={handleAdd}
          className="text-[12px] md:text-[9px] text-static-green active:text-static-green/80 cursor-pointer min-h-[44px] md:min-h-0 px-2 flex items-center"
        >
          Save
        </button>
        <button
          onClick={() => setShowInput(false)}
          className="text-[12px] md:text-[9px] text-bevel-dark active:text-desktop-gray cursor-pointer min-h-[44px] md:min-h-0 px-2 flex items-center"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowInput(true)}
      className={cn(
        "cursor-pointer transition-colors-fast text-bevel-dark/50 hover:text-desert-amber",
        variant === "mobile"
          ? "text-[14px] min-w-[44px] min-h-[44px] flex items-center justify-center"
          : "text-[10px] px-1",
        className,
      )}
      title={`Add bookmark at ${formatTime(position)}`}
      aria-label="Add bookmark"
    >
      {"\u{1F516}"}
    </button>
  );
}

/** Standalone bookmarks list for episode detail */
export function BookmarkList({
  episodeId,
  onSeek,
  className,
}: {
  episodeId: number;
  onSeek?: (position: number) => void;
  className?: string;
}) {
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const bookmarks = useLiveQuery(
    async () => {
      try {
        return await db.bookmarks.where("episodeId").equals(episodeId).sortBy("position");
      } catch {
        return [];
      }
    },
    [episodeId],
  );

  if (!bookmarks || bookmarks.length === 0) return null;

  const handleClick = (bm: Bookmark) => {
    if (onSeek) {
      onSeek(bm.position);
    } else {
      // If episode is currently loaded, seek directly
      const state = usePlayerStore.getState();
      if (state.currentEpisode?.id === episodeId) {
        state.setPosition(bm.position);
      }
    }
  };

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <div className="text-[11px] md:text-[8px] text-desert-amber uppercase tracking-wider font-bold mb-0.5">
        Bookmarks
      </div>
      {bookmarks.map((bm) => (
        <div key={bm.id} className="flex items-center gap-1.5 group">
          <button
            onClick={() => handleClick(bm)}
            className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer hover:bg-title-bar-blue/10 active:bg-title-bar-blue/10 px-2 py-2 md:px-1 md:py-0.5 min-h-[44px] md:min-h-0 transition-colors-fast"
          >
            <span className="text-[12px] md:text-[9px] text-desert-amber tabular-nums flex-shrink-0">
              {formatTime(bm.position)}
            </span>
            <span className="text-[12px] md:text-[9px] text-desktop-gray/70 truncate">
              {bm.label}
            </span>
          </button>
          {isAdmin && (
            <button
              onClick={async () => {
                await removeBookmark(bm.id!);
                toast.info("Bookmark removed");
              }}
              className="text-[12px] md:text-[8px] text-red-400/50 md:text-red-400/0 md:group-hover:text-red-400/50 hover:text-red-400 active:text-red-400 cursor-pointer transition-colors-fast flex-shrink-0 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
            >
              {"\u2715"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
