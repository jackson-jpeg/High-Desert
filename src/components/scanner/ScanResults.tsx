"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { Window } from "@/components/win98";
import { formatTime } from "@/lib/utils/format";

interface ScanResultsProps {
  className?: string;
}

export function ScanResults({ className }: ScanResultsProps) {
  const episodes = useLiveQuery(
    () => db.episodes.orderBy("airDate").reverse().toArray(),
    [],
  );

  if (!episodes || episodes.length === 0) {
    return null;
  }

  return (
    <Window title={`Library (${episodes.length} episodes)`} variant="dark" className={className}>
      <div className="max-h-[300px] overflow-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-bevel-dark border-b border-bevel-dark/30 sticky top-0 bg-raised-surface">
              <th className="px-2 py-1">Date</th>
              <th className="px-2 py-1">Title / Filename</th>
              <th className="px-2 py-1">Guest</th>
              <th className="px-2 py-1">Type</th>
              <th className="px-2 py-1 text-right">Duration</th>
            </tr>
          </thead>
          <tbody>
            {episodes.map((ep) => (
              <tr
                key={ep.id}
                className="border-b border-bevel-dark/10 hover:bg-title-bar-blue/20 transition-colors-fast"
              >
                <td className="px-2 py-1 text-desert-amber whitespace-nowrap">
                  {ep.airDate ?? "Unknown"}
                </td>
                <td className="px-2 py-1 text-desktop-gray truncate max-w-[200px]">
                  {ep.title || ep.fileName}
                </td>
                <td className="px-2 py-1 text-static-green truncate max-w-[150px]">
                  {ep.guestName ?? "\u2014"}
                </td>
                <td className="px-2 py-1 text-bevel-dark capitalize">
                  {ep.showType ?? "\u2014"}
                </td>
                <td className="px-2 py-1 text-right text-bevel-dark whitespace-nowrap">
                  {ep.duration ? formatTime(ep.duration) : "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Window>
  );
}
