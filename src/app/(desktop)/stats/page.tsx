"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { Window } from "@/components/win98";

export default function StatsPage() {
  const episodes = useLiveQuery(() => db.episodes.toArray(), []);

  const stats = useMemo(() => {
    if (!episodes) return null;

    const total = episodes.length;
    const played = episodes.filter((e) => (e.playbackPosition ?? 0) > 0);
    const completed = episodes.filter(
      (e) => e.duration && e.playbackPosition && e.playbackPosition / e.duration > 0.9,
    );

    // Total listening time (sum of playbackPosition for played episodes)
    const totalSeconds = played.reduce((sum, e) => sum + (e.playbackPosition ?? 0), 0);
    const totalHours = totalSeconds / 3600;

    // Total library duration
    const librarySeconds = episodes.reduce((sum, e) => sum + (e.duration ?? 0), 0);
    const libraryHours = librarySeconds / 3600;

    // Episodes per year
    const yearCounts = new Map<string, number>();
    for (const ep of episodes) {
      const year = ep.airDate?.slice(0, 4) ?? "Unknown";
      yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
    }
    const years = Array.from(yearCounts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .filter(([y]) => y !== "Unknown");

    // Top guests
    const guestCounts = new Map<string, number>();
    for (const ep of episodes) {
      if (ep.guestName) {
        guestCounts.set(ep.guestName, (guestCounts.get(ep.guestName) ?? 0) + 1);
      }
    }
    const topGuests = Array.from(guestCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    // Show type breakdown
    const showCounts = new Map<string, number>();
    for (const ep of episodes) {
      const type = ep.showType ?? "unknown";
      showCounts.set(type, (showCounts.get(type) ?? 0) + 1);
    }

    // AI status
    const aiCompleted = episodes.filter((e) => e.aiStatus === "completed").length;
    const aiFailed = episodes.filter((e) => e.aiStatus === "failed").length;
    const aiPending = episodes.filter((e) => e.aiStatus === "pending").length;

    // Source breakdown
    const archiveCount = episodes.filter((e) => e.source === "archive").length;
    const localCount = episodes.filter((e) => e.source === "local").length;

    return {
      total,
      played: played.length,
      completed: completed.length,
      totalHours,
      libraryHours,
      years,
      topGuests,
      showCounts,
      aiCompleted,
      aiFailed,
      aiPending,
      archiveCount,
      localCount,
    };
  }, [episodes]);

  if (!stats) {
    return (
      <div className="p-4 flex flex-col gap-4 max-w-2xl mx-auto">
        <Window title="Statistics" variant="dark">
          <div className="p-4 text-[11px] text-bevel-dark">Loading...</div>
        </Window>
      </div>
    );
  }

  const maxYearCount = Math.max(...stats.years.map(([, c]) => c), 1);

  return (
    <div className="p-4 flex flex-col gap-4 max-w-2xl mx-auto">
      {/* Overview cards */}
      <Window title="Overview" variant="dark">
        <div className="p-3 grid grid-cols-4 gap-2">
          <StatCard label="Episodes" value={stats.total.toLocaleString()} color="text-desktop-gray" />
          <StatCard label="Listened" value={stats.played.toLocaleString()} color="text-static-green" />
          <StatCard label="Completed" value={stats.completed.toLocaleString()} color="text-desert-amber" />
          <StatCard
            label="Hours Listened"
            value={stats.totalHours.toFixed(1)}
            color="text-title-bar-blue"
          />
        </div>
        <div className="px-3 pb-3 grid grid-cols-4 gap-2">
          <StatCard
            label="Library Hours"
            value={stats.libraryHours.toFixed(0)}
            color="text-bevel-dark"
          />
          <StatCard
            label="Archive"
            value={stats.archiveCount.toLocaleString()}
            color="text-title-bar-blue"
          />
          <StatCard
            label="Local"
            value={stats.localCount.toLocaleString()}
            color="text-desktop-gray"
          />
          <StatCard
            label="Completion"
            value={stats.total > 0 ? `${Math.round((stats.completed / stats.total) * 100)}%` : "0%"}
            color="text-static-green"
          />
        </div>
      </Window>

      {/* Show type breakdown */}
      <Window title="Show Types" variant="dark">
        <div className="p-3 grid grid-cols-4 gap-2">
          {[
            ["coast", "Coast to Coast", "text-title-bar-blue"],
            ["dreamland", "Dreamland", "text-static-green"],
            ["special", "Specials", "text-desert-amber"],
            ["unknown", "Uncategorized", "text-bevel-dark"],
          ].map(([key, label, color]) => (
            <StatCard
              key={key}
              label={label}
              value={(stats.showCounts.get(key) ?? 0).toLocaleString()}
              color={color}
            />
          ))}
        </div>
      </Window>

      {/* AI Status */}
      <Window title="AI Categorization" variant="dark">
        <div className="p-3 grid grid-cols-3 gap-2">
          <StatCard label="Categorized" value={stats.aiCompleted.toLocaleString()} color="text-static-green" />
          <StatCard label="Pending" value={stats.aiPending.toLocaleString()} color="text-desert-amber" />
          <StatCard label="Failed" value={stats.aiFailed.toLocaleString()} color="text-red-400" />
        </div>
      </Window>

      {/* Episodes per year chart */}
      {stats.years.length > 0 && (
        <Window title="Episodes by Year" variant="dark">
          <div className="p-3">
            <div className="flex flex-col gap-1">
              {stats.years.map(([year, count]) => (
                <div key={year} className="flex items-center gap-2">
                  <span className="text-[9px] text-desert-amber tabular-nums w-[32px] text-right">
                    {year}
                  </span>
                  <div className="flex-1 h-[12px] w98-inset-dark bg-inset-well">
                    <div
                      className="h-full bg-title-bar-blue/60"
                      style={{ width: `${(count / maxYearCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-bevel-dark tabular-nums w-[24px]">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Window>
      )}

      {/* Top guests */}
      {stats.topGuests.length > 0 && (
        <Window title="Top Guests" variant="dark">
          <div className="p-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {stats.topGuests.map(([guest, count], i) => (
                <div key={guest} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-desktop-gray truncate">
                    <span className="text-bevel-dark mr-1">{i + 1}.</span>
                    {guest}
                  </span>
                  <span className="text-[9px] text-bevel-dark tabular-nums flex-shrink-0">
                    {count} ep{count !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Window>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center p-2 w98-inset-dark bg-inset-well">
      <div className={`text-[14px] font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[8px] text-bevel-dark uppercase tracking-wider">{label}</div>
    </div>
  );
}
