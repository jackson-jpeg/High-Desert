"use client";

import { useEffect, useState } from "react";
import { getCacheSize, clearAudioCache } from "@/audio/cache";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils/cn";

/** Bytes for people: "850 KB", "1.2 GB". */
export function formatSavedBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * Shows saved on this device, and a way to clear them (UI plan push 6, batch
 * 2: it was "Audio Cache · Offline audio cached in OPFS" on /stats). Only a
 * show played from the listener's own file is kept (src/audio/cache.ts), so
 * for almost everyone there is nothing here, and then nothing is drawn.
 *
 * In the settings a device has: the More sheet on a phone, the Display
 * dialog on a desktop (both looks). `variant` picks the look of the row.
 */
export function SavedAudioSetting({ variant }: { variant: "sheet" | "win98" | "night" }) {
  const [bytes, setBytes] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    getCacheSize()
      .then((n) => live && setBytes(n))
      .catch(() => live && setBytes(0));
    return () => {
      live = false;
    };
  }, []);
  if (!bytes) return null;

  const clear = async () => {
    await clearAudioCache();
    setBytes(0);
    toast.success("Saved shows cleared from this device");
  };

  const words = (
    <>
      <span className={cn(variant === "win98" ? "font-bold" : "text-desktop-gray")}>Saved on this device: {formatSavedBytes(bytes)}</span>
      <span className={cn("text-hd-caption", variant === "win98" ? "" : "text-bevel-dark")}>
        Shows you opened from your own files, kept so they play again without the file.
      </span>
    </>
  );

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3",
        variant === "sheet" && "px-4 py-3 min-h-[48px]",
        variant === "night" && "px-4 pt-4",
        variant === "win98" && "text-hd-12",
      )}
      data-testid="saved-audio"
    >
      <div className="flex flex-col gap-0.5 min-w-0">{words}</div>
      <button
        type="button"
        onClick={clear}
        className={cn(
          "flex-shrink-0 cursor-pointer min-h-touch md:min-h-0 px-3",
          variant === "win98" ? "w98-raised bg-[var(--w98-surface)] py-1" : "rounded-lg text-desert-amber active:bg-white/[0.06]",
        )}
        data-testid="saved-audio-clear"
      >
        Clear
      </button>
    </div>
  );
}
