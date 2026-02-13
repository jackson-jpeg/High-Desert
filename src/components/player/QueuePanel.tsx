"use client";

import { useRef, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { cn } from "@/lib/utils/cn";

export function QueuePanel() {
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const moveInQueue = usePlayerStore((s) => s.moveInQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);

  // Drag-to-reorder state (desktop)
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragCountRef = useRef(0);

  const handlePlay = (index: number) => {
    const episode = usePlayerStore.getState().playFromQueue(index);
    if (episode) {
      window.dispatchEvent(
        new CustomEvent("hd:play-episode", { detail: episode }),
      );
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragFrom(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragEnter = (index: number) => {
    dragCountRef.current++;
    setDragOver(index);
  };

  const handleDragLeave = () => {
    dragCountRef.current--;
    if (dragCountRef.current <= 0) {
      setDragOver(null);
      dragCountRef.current = 0;
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (dragFrom !== null && dragFrom !== toIndex) {
      moveInQueue(dragFrom, toIndex);
    }
    setDragFrom(null);
    setDragOver(null);
    dragCountRef.current = 0;
  };

  const handleDragEnd = () => {
    setDragFrom(null);
    setDragOver(null);
    dragCountRef.current = 0;
  };

  // Total queue duration
  const totalSeconds = queue.reduce((sum, ep) => sum + (ep.duration ?? 0), 0);

  // Remaining queue duration (from current track onward)
  const remainingSeconds = queue
    .slice(queueIndex + 1)
    .reduce((sum, ep) => sum + (ep.duration ?? 0), 0);
  const remainingMinutes = Math.round(remainingSeconds / 60);

  if (queue.length === 0) {
    return (
      <div className="w98-inset-dark bg-inset-well p-4 animate-slide-up">
        <div className="flex flex-col items-center gap-2 py-2">
          <span className="text-[14px] text-bevel-dark/30 select-none">{"\u266B"}</span>
          <div className="text-[12px] md:text-[10px] text-bevel-dark text-center">
            Queue is empty
          </div>
          <div className="text-[11px] md:text-[8px] text-bevel-dark/50 text-center leading-relaxed">
            Right-click episodes to add, or use Play Next in the detail panel
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w98-inset-dark bg-inset-well animate-slide-up">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-bevel-dark/15">
        <div className="flex items-center gap-2">
          <span className="text-[12px] md:text-[10px] text-bevel-dark/70">
            {queue.length} track{queue.length !== 1 ? "s" : ""}
          </span>
          {remainingMinutes > 0 && (
            <span className="text-[10px] md:text-[8px] text-bevel-dark/40 tabular-nums">
              {remainingMinutes > 60 ? `${Math.floor(remainingMinutes / 60)}h ${remainingMinutes % 60}m` : `${remainingMinutes}m`} left
            </span>
          )}
        </div>
        <button
          onClick={clearQueue}
          className="text-[11px] md:text-[9px] text-bevel-dark/50 hover:text-red-400 active:text-red-400 cursor-pointer transition-colors-fast min-h-[44px] md:min-h-0 flex items-center px-2"
        >
          Clear
        </button>
      </div>
      <div className="max-h-[240px] overflow-auto">
        {queue.map((ep, i) => {
          const isCurrent = i === queueIndex;
          const isPast = i < queueIndex;
          const isDragTarget = dragOver === i && dragFrom !== i;
          return (
            <div
              key={`${ep.id}-${i}`}
              draggable
              onDragStart={(e) => handleDragStart(e, i)}
              onDragEnter={() => handleDragEnter(i)}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, i)}
              onDragEnd={handleDragEnd}
              className={cn(
                "group flex items-center gap-2 px-3 py-1.5 min-h-[44px] md:min-h-0 cursor-pointer select-none",
                "hover:bg-title-bar-blue/10 active:bg-title-bar-blue/10 transition-colors-fast",
                isCurrent && "ring-1 ring-static-green/40 bg-title-bar-blue/10",
                isPast && "opacity-50",
                dragFrom === i && "opacity-30",
                isDragTarget && "border-t-2 border-t-desert-amber/60",
              )}
              onClick={() => handlePlay(i)}
            >
              {/* Drag handle — always visible on mobile */}
              <span className="text-[10px] md:text-[8px] text-bevel-dark/20 cursor-grab active:cursor-grabbing flex-shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-60 transition-opacity">
                {"\u2261"}
              </span>

              {/* Mobile reorder arrows */}
              <div className="flex flex-col gap-0.5 md:hidden flex-shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (i > 0) moveInQueue(i, i - 1);
                  }}
                  disabled={i === 0}
                  className="text-[10px] text-bevel-dark/40 active:text-desktop-gray disabled:opacity-20 cursor-pointer px-1"
                  aria-label="Move up"
                >
                  {"\u25B2"}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (i < queue.length - 1) moveInQueue(i, i + 1);
                  }}
                  disabled={i === queue.length - 1}
                  className="text-[10px] text-bevel-dark/40 active:text-desktop-gray disabled:opacity-20 cursor-pointer px-1"
                  aria-label="Move down"
                >
                  {"\u25BC"}
                </button>
              </div>

              {isCurrent && (
                <span className="text-[11px] md:text-[9px] text-static-green/70 flex-shrink-0">
                  {"\u25B6"}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className={cn(
                  "text-[12px] md:text-[10px] truncate",
                  isCurrent ? "text-desktop-gray font-bold" : "text-desktop-gray/80",
                )}>
                  {ep.title || ep.fileName}
                </div>
                {(ep.guestName || ep.airDate) && (
                  <div className="text-[11px] md:text-[9px] text-bevel-dark/60 truncate">
                    {[ep.guestName, ep.airDate].filter(Boolean).join(" \u00B7 ")}
                  </div>
                )}
              </div>
              {/* Remove button — always visible on mobile */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFromQueue(i);
                }}
                className="text-[11px] md:text-[9px] text-bevel-dark/30 hover:text-red-400 active:text-red-400 cursor-pointer flex-shrink-0 px-1 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                title="Remove"
              >
                {"\u2715"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
