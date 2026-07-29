"use client";

import { useCallback, useState } from "react";
import { Dialog, Button } from "@/components/win98";
import { usePlayerStore } from "@/stores/player-store";
import { db } from "@/db";
import { toast } from "@/stores/toast-store";

/**
 * Shown when a show will not start.
 *
 * A listener wrote: "sometimes when I go to play a show it doesnt start… I
 * usually will find another show and put it on when that happens… could very
 * well be user error on my end too." Nothing in the app ever told them
 * otherwise, so they carried the blame for a bug.
 *
 * Two jobs, then. Say plainly that the failure is ours, and turn the workaround
 * they invented into a button.
 *
 * Only raised once the automatic retry has already been spent (loadState
 * "failed"). Transient interruptions mid-playback keep using the inline banner
 * — a modal for every network blip on a train would be its own kind of rude.
 */
export function PlaybackErrorDialog() {
  const loadState = usePlayerStore((s) => s.loadState);
  const currentEpisode = usePlayerStore((s) => s.currentEpisode);
  const setLoadState = usePlayerStore((s) => s.setLoadState);
  const setError = usePlayerStore((s) => s.setError);
  const [picking, setPicking] = useState(false);

  const open = loadState === "failed" && currentEpisode !== null;

  const dismiss = useCallback(() => {
    setLoadState("idle");
    setError(null);
  }, [setLoadState, setError]);

  const handleRetry = useCallback(() => {
    const ep = usePlayerStore.getState().currentEpisode;
    dismiss();
    if (ep) {
      window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: ep }));
    }
  }, [dismiss]);

  /**
   * Picks its own episode rather than firing `hd:shuffle`, which is only
   * handled by the library page — and a failure is just as likely to happen
   * from /radio or /stats, where that event falls on the floor.
   */
  const handleSomethingElse = useCallback(async () => {
    setPicking(true);
    try {
      const failedId = usePlayerStore.getState().currentEpisode?.id;
      const count = await db.episodes.count();
      if (count === 0) {
        toast.info("No episodes in the library yet");
        dismiss();
        return;
      }

      let pick = null;
      // A couple of tries is enough to avoid handing back the show that just
      // failed, without looping forever on a one-episode library.
      for (let i = 0; i < 3 && !pick; i++) {
        const offset = Math.floor(Math.random() * count);
        const [candidate] = await db.episodes.offset(offset).limit(1).toArray();
        if (candidate && candidate.id !== failedId) pick = candidate;
      }

      dismiss();
      if (pick) {
        window.dispatchEvent(
          new CustomEvent("hd:play-episode", { detail: pick }),
        );
      }
    } catch {
      dismiss();
      toast.error("Couldn't pick another show.");
    } finally {
      setPicking(false);
    }
  }, [dismiss]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={dismiss}
      title="Transmission Interrupted"
      urgent
      width="360px"
    >
      <div className="p-4 flex flex-col gap-4">
        <div className="text-hd-body text-desktop-gray">
          This broadcast isn&apos;t coming through. The signal may be weak on
          this end.
          {currentEpisode && (
            <span className="block mt-2 text-hd-caption text-bevel-dark break-words">
              {currentEpisode.title || currentEpisode.fileName}
            </span>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={handleSomethingElse} disabled={picking}>
            {picking ? "Tuning…" : "Play Something Else"}
          </Button>
          <Button variant="dark" onClick={handleRetry}>
            Try Again
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
