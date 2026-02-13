"use client";

import { usePlayerStore } from "@/stores/player-store";
import { cn } from "@/lib/utils/cn";

export function QueuePanel() {
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);

  const handlePlay = (index: number) => {
    const episode = usePlayerStore.getState().playFromQueue(index);
    if (episode) {
      window.dispatchEvent(
        new CustomEvent("hd:play-episode", { detail: episode }),
      );
    }
  };

  if (queue.length === 0) {
    return (
      <div className="w98-inset-dark bg-inset-well p-3 animate-slide-up">
        <div className="text-[10px] text-bevel-dark text-center py-2">
          Queue is empty
        </div>
      </div>
    );
  }

  return (
    <div className="w98-inset-dark bg-inset-well animate-slide-up">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-bevel-dark/20">
        <span className="text-[10px] text-bevel-dark">
          Queue ({queue.length})
        </span>
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
          return (
            <div
              key={`${ep.id}-${i}`}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 cursor-pointer",
                "hover:bg-title-bar-blue/10 transition-colors-fast",
                isCurrent && "ring-1 ring-static-green/40 bg-title-bar-blue/10",
              )}
              onClick={() => handlePlay(i)}
            >
              <span className="text-[9px] text-bevel-dark w-[16px] text-right tabular-nums flex-shrink-0">
                {isCurrent ? "\u25B6" : i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-desktop-gray truncate">
                  {ep.title || ep.fileName}
                </div>
                <div className="text-[9px] text-bevel-dark truncate">
                  {ep.airDate ?? ""}
                  {ep.duration != null && ` \u2014 ${Math.floor(ep.duration / 60)}m`}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFromQueue(i);
                }}
                className="text-[9px] text-bevel-dark hover:text-red-400 cursor-pointer flex-shrink-0 px-1"
                title="Remove from queue"
              >
                \u2715
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
