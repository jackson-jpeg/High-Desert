"use client";

import { useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Dialog, Button } from "@/components/win98";
import { db } from "@/db";
import { useOutageStore } from "@/stores/outage-store";
import { emit } from "@/lib/events";
import { formatAirDate } from "@/lib/utils/format";
import { suggestPlayable, REASON_LABEL } from "@/lib/library/playable-suggestions";

/**
 * A start refused because archive.org is down and the mirror does not hold
 * the show (`refuseIfUnavailable`, src/audio/outage-gate.ts).
 *
 * It appears the instant the tap lands — the refusal is decided from the
 * manifest already in memory, with no request — and it says what is true: the
 * show is fine, archive.org is not, and here are three that will play now.
 * The suggestions come from this browser's own library (IndexedDB, no
 * network) and fill in a moment after the dialog opens.
 *
 * It closes itself when archive.org comes back (`setArchiveUp(true)` clears
 * `unavailable`). Mounted in `(desktop)/layout.tsx`, beside
 * `PlaybackErrorDialog`, so it works on every route and in every player state.
 */
export function OutageDialog() {
  const target = useOutageStore((s) => s.unavailable);
  const manifest = useOutageStore((s) => s.manifest);
  const dismiss = useOutageStore((s) => s.dismissUnavailable);

  const suggestions = useLiveQuery(
    async () => {
      if (!target || !manifest) return [];
      return suggestPlayable(target, await db.episodes.toArray(), manifest.fileHashes);
    },
    [target, manifest],
  );

  const play = useCallback(
    (fileHash: string) => {
      const pick = suggestions?.find((s) => s.episode.fileHash === fileHash)?.episode;
      dismiss();
      if (pick) emit("play-episode", pick);
    },
    [suggestions, dismiss],
  );

  if (!target) return null;

  return (
    <Dialog open onClose={dismiss} title="Not On The Mirror" width="380px">
      <div className="p-4 flex flex-col gap-3" data-testid="outage-dialog">
        <div className="text-hd-body text-desktop-gray">
          archive.org is down, and the High Desert mirror doesn&rsquo;t keep a copy of this one. It will play again
          when archive.org is back.
          <span className="block mt-2 text-hd-caption text-bevel-dark break-words">
            {target.title || target.fileName}
          </span>
        </div>
        {suggestions && suggestions.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-hd-caption text-bevel-dark">These play now:</div>
            <ul className="flex flex-col gap-1" aria-label="Shows on the mirror">
              {suggestions.map(({ episode, reason }) => (
                <li key={episode.fileHash}>
                  <button
                    type="button"
                    onClick={() => play(episode.fileHash)}
                    data-suggestion={reason}
                    className="w-full text-left px-2 py-1.5 min-h-touch md:min-h-0 w98-raised-dark bg-card-surface hover:bg-title-bar-blue/15 cursor-pointer flex flex-col"
                  >
                    <span className="text-hd-caption text-desktop-gray font-bold truncate">
                      {episode.title || episode.fileName}
                    </span>
                    <span className="text-hd-micro text-bevel-dark truncate">
                      {REASON_LABEL[reason]}
                      {episode.guestName ? ` · ${episode.guestName}` : ""}
                      {episode.airDate ? ` · ${formatAirDate(episode.airDate)}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="dark" onClick={dismiss}>
            OK
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
