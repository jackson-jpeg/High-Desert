"use client";

import { useCallback, useState } from "react";
import type { Episode } from "@/db/schema";
import { Dialog, Button } from "@/components/win98";
import { useHdEvent } from "@/lib/events";
import {
  removedFromCatalog,
  UNAVAILABLE_BODY,
  UNAVAILABLE_TITLE,
} from "@/lib/library/removed-episodes";

/**
 * What pressing play on a pulled episode says (src/lib/library/removed-episodes.ts).
 *
 * The play path stops before it assigns a source, so nothing is requested from
 * archive.org and whatever was already playing carries on. This is not
 * PlaybackErrorDialog: nothing failed, and neither "Try Again" nor "the signal
 * may be weak" is true. Mounted in the desktop layout, beside that dialog, so
 * it answers on every route the player can be started from.
 */
export function UnavailableEpisodeDialog() {
  const [episode, setEpisode] = useState<Episode | null>(null);
  useHdEvent("episode-unavailable", (ep) => setEpisode(ep));
  const close = useCallback(() => setEpisode(null), []);

  if (!episode) return null;
  const removed = removedFromCatalog(episode);

  return (
    <Dialog open onClose={close} title={UNAVAILABLE_TITLE} width="360px">
      <div className="p-4 flex flex-col gap-4" data-unavailable-dialog="">
        <div className="text-hd-body text-desktop-gray">
          {UNAVAILABLE_BODY}
          <span className="block mt-2 text-hd-caption text-bevel-dark break-words">
            {episode.title || episode.fileName}
          </span>
          {removed && (
            <span className="block mt-1 text-hd-caption text-bevel-dark/85">{removed.reason}</span>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="dark" onClick={close}>
            OK
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
