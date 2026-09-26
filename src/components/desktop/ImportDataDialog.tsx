"use client";

import { Dialog, Button } from "@/components/win98";
import { isEmptyImport, type ImportSummary } from "@/services/user-data/portable";

interface ImportDataDialogProps {
  fileName: string;
  summary: ImportSummary;
  importing: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * "Import My Data" confirmation: what the file will add, before anything is
 * written. Import only ever adds (src/services/user-data/portable.ts), so the
 * dialog says so — the question a listener has at this moment is "will this
 * wipe what I have?", and the answer is no.
 */
export function ImportDataDialog({ fileName, summary, importing, onConfirm, onClose }: ImportDataDialogProps) {
  const empty = isEmptyImport(summary);
  const rows: [string, number][] = [
    ["Favourites", summary.favourites],
    ["Ratings", summary.ratings],
    ["Playback positions", summary.positions],
    ["History entries", summary.history],
    ["Bookmarks", summary.bookmarks],
    ["New playlists", summary.playlistsCreated],
    ["Playlists gaining episodes", summary.playlistsExtended],
    ["Flagged episodes", summary.flags],
    ["Settings", summary.prefs],
  ];
  const shown = rows.filter(([, n]) => n > 0);

  return (
    <Dialog open onClose={onClose} title="Import My Data" width="360px">
      <div className="p-4 flex flex-col gap-3 text-hd-caption text-desktop-gray" data-testid="import-data-dialog">
        <div className="break-all text-bevel-dark">{fileName}</div>
        {empty ? (
          <p>Nothing new to import. Everything in this file is already in your library.</p>
        ) : (
          <>
            <p>This will add to your library:</p>
            <ul className="flex flex-col gap-1 pl-2">
              {shown.map(([label, n]) => (
                <li key={label} className="flex justify-between gap-4">
                  <span>{label}</span>
                  <span className="tabular-nums text-desert-amber">{n.toLocaleString()}</span>
                </li>
              ))}
            </ul>
            <p className="text-bevel-dark">
              Nothing you already have is removed or replaced.
            </p>
          </>
        )}
        {summary.unmatched > 0 && (
          <p className="text-bevel-dark/85">
            {plural(summary.unmatched, "episode")} in the file {summary.unmatched === 1 ? "isn't" : "aren't"} in this library and will be skipped.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>{empty ? "Close" : "Cancel"}</Button>
          {!empty && (
            <Button variant="dark" onClick={onConfirm} disabled={importing}>
              {importing ? "Importing..." : "Import"}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
