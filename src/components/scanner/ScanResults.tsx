"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { Window } from "@/components/win98";
import { formatTime } from "@/lib/utils/format";
import { ScannerErrorBoundary } from "./ScannerErrorBoundary";
import { useScannerStore } from "@/stores/scanner-store";

interface ScanResultsProps {
  className?: string;
}

function ScanResultsContent({ className }: ScanResultsProps) {
  const episodes = useLiveQuery(
    () => db.episodes.orderBy("airDate").reverse().toArray(),
    [],
  );
  const { status } = useScannerStore();

  // Validate episode data structure
  const validateEpisodes = (data: any): data is typeof episodes => {
    if (!Array.isArray(data)) return false;
    return data.every(ep => 
      typeof ep === 'object' && 
      ep !== null && 
      'id' in ep &&
      (ep.airDate === undefined || typeof ep.airDate === 'string') &&
      (ep.title === undefined || typeof ep.title === 'string') &&
      (ep.fileName === undefined || typeof ep.fileName === 'string') &&
      (ep.guestName === undefined || typeof ep.guestName === 'string') &&
      (ep.showType === undefined || typeof ep.showType === 'string') &&
      (ep.duration === undefined || typeof ep.duration === 'number')
    );
  };

  // Handle loading and empty states
  if (status === "scanning") {
    return (
      <Window title="Library" variant="dark" className={className}>
        <div className="p-4">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-bevel-dark/20 rounded w-3/4"></div>
            <div className="h-3 bg-bevel-dark/10 rounded w-1/2"></div>
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-8 bg-bevel-dark/10 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </Window>
    );
  }

  if (!episodes || !Array.isArray(episodes)) {
    return (
      <Window title="Library" variant="dark" className={className}>
        <div className="p-4 text-[11px] text-red-400">
          Error: Could not load episode data. Please refresh the page.
        </div>
      </Window>
    );
  }

  if (episodes.length === 0) {
    return (
      <Window title="Library" variant="dark" className={className}>
        <div className="p-4 text-center">
          <div className="text-[11px] text-bevel-dark mb-2">
            No folders found
          </div>
          <div className="text-[10px] text-desktop-gray">
            Start scanning to add files from your archive.
          </div>
        </div>
      </Window>
    );
  }

  // Validate data integrity
  if (!validateEpisodes(episodes)) {
    return (
      <Window title="Library" variant="dark" className={className}>
        <div className="p-4 text-[11px] text-red-400">
          Error: Episode data appears to be corrupted. Try refreshing or re-scanning your folder.
        </div>
      </Window>
    );
  }

  return (
    <Window title={`Library (${episodes.length} episodes)`} variant="dark" className={className}>
      <div className="max-h-[60vh] md:max-h-[300px] overflow-auto overscroll-contain">
        {/* Desktop: table */}
        <table className="w-full text-[11px] hidden md:table">
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
            {episodes?.map((ep) => (
              <tr
                key={ep.id}
                className="border-b border-bevel-dark/10 hover:bg-title-bar-blue/20 transition-colors-fast"
              >
                <td className="px-2 py-1 text-desert-amber whitespace-nowrap">
                  {ep?.airDate ?? "Unknown"}
                </td>
                <td className="px-2 py-1 text-desktop-gray truncate max-w-[200px]">
                  {ep?.title ?? ep?.fileName ?? "Unknown File"}
                </td>
                <td className="px-2 py-1 text-static-green truncate max-w-[150px]">
                  {ep?.guestName ?? "\u2014"}
                </td>
                <td className="px-2 py-1 text-bevel-dark capitalize">
                  {ep?.showType ?? "\u2014"}
                </td>
                <td className="px-2 py-1 text-right text-bevel-dark whitespace-nowrap">
                  {ep?.duration ? formatTime(ep.duration) : "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile: stacked cards */}
        <div className="flex flex-col gap-[2px] md:hidden">
          {episodes?.map((ep) => (
            <div
              key={ep?.id}
              className="p-3 min-h-[56px] border-b border-bevel-dark/10 active:bg-title-bar-blue/10"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-desert-amber tabular-nums">
                  {ep?.airDate ?? "Unknown"}
                </span>
                <span className="text-[11px] text-bevel-dark capitalize">
                  {ep?.showType ?? "\u2014"}
                </span>
              </div>
              <div className="text-[13px] text-desktop-gray font-bold truncate mt-0.5">
                {ep?.title ?? ep?.fileName ?? "Unknown File"}
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-[12px] text-static-green truncate">
                  {ep?.guestName ?? "\u2014"}
                </span>
                <span className="text-[11px] text-bevel-dark tabular-nums flex-shrink-0">
                  {ep?.duration ? formatTime(ep.duration) : "\u2014"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Window>
  );
}

export function ScanResults({ className }: ScanResultsProps) {
  return (
    <ScannerErrorBoundary>
      <ScanResultsContent className={className} />
    </ScannerErrorBoundary>
  );
}
