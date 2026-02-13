"use client";

import { useRef, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { cn } from "@/lib/utils/cn";

export function QueuePanel() {
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const moveInQueue = usePlayerStore((s) => s.moveInQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);

  // Drag-to-reorder state
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
  const totalMinutes = Math.round(totalSeconds / 60);

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
          <div className="text-[10px] text-bevel-dark text-center">
            Queue is empty
          </div>
          <div className="text-[8px] text-bevel-dark/50 text-center leading-relaxed">
            Right-click episodes to add, or use Play Next in the detail panel
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w98-inset-dark bg-inset-well animate-slide-up">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-bevel-dark/20">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-bevel-dark">
            Queue ({queue.length})
          </span>
          {totalMinutes > 0 && (
            <span className="text-[8px] text-bevel-dark/50 tabular-nums">
              {totalMinutes > 60 ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m` : `${totalMinutes}m`}
              {remainingMinutes > 0 && remainingMinutes !== totalMinutes && (
                <span className="text-bevel-dark/30"> ({remainingMinutes}m left)</span>
              )}
            </span>
          )}
          {/* Shuffle/Repeat indicators */}
          {shuffle && (
            <span className="text-[8px] text-desert-amber" title="Shuffle on">{"\u21C6"}</span>
          )}
          {repeat !== "off" && (
            <span className="text-[8px] text-desert-amber" title={`Repeat: ${repeat}`}>
              {repeat === "one" ? "\u21BB1" : "\u21BB"}
            </span>
          )}
        </div>
        <button
          onClick={clearQueue}
          className="text-[9px] text-bevel-dark hover:text-red-400 cursor-pointer transition-colors-fast"
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
                "group flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none",
                "hover:bg-title-bar-blue/10 transition-colors-fast",
                isCurrent && "ring-1 ring-static-green/40 bg-title-bar-blue/10",
                isPast && "opacity-50",
                dragFrom === i && "opacity-30",
                isDragTarget && "border-t-2 border-t-desert-amber/60",
              )}
              onClick={() => handlePlay(i)}
            >
              {/* Drag handle */}
              <span className="text-[8px] text-bevel-dark/30 cursor-grab active:cursor-grabbing flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {"\u2261"}
              </span>
              <span className={cn(
                "text-[9px] w-[16px] text-right tabular-nums flex-shrink-0",
                isCurrent ? "text-static-green" : "text-bevel-dark",
              )}>
                {isCurrent ? "\u25B6" : i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className={cn(
                  "text-[10px] truncate",
                  isCurrent ? "text-desktop-gray font-bold" : "text-desktop-gray",
                )}>
                  {ep.title || ep.fileName}
                </div>
                <div className="text-[9px] text-bevel-dark truncate">
                  {[ep.airDate, ep.guestName].filter(Boolean).join(" \u2014 ")}
                  {ep.duration != null && ` \u00B7 ${Math.floor(ep.duration / 60)}m`}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFromQueue(i);
                }}
                className="text-[9px] text-bevel-dark hover:text-red-400 cursor-pointer flex-shrink-0 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove from queue"
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
