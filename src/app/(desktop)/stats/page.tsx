"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { useAdminStore } from "@/stores/admin-store";
import { Window, Button } from "@/components/win98";
import { HistoryPanel } from "@/components/library/HistoryPanel";
import { SmartPlaylists } from "@/components/library/SmartPlaylists";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";
import { ListeningStats } from "@/components/library/ListeningStats";
import { cn } from "@/lib/utils/cn";
import { getCacheSize, clearAudioCache } from "@/audio/cache";
import { toast } from "@/stores/toast-store";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

export default function StatsPage() {
  const router = useRouter();
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const episodes = useLiveQuery(() => db.episodes.toArray(), []);
  const history = useLiveQuery(() => db.history.orderBy("timestamp").reverse().toArray(), []);

  // Audio cache size
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  useEffect(() => {
    getCacheSize().then(setCacheSize);
  }, []);
  const handleClearCache = useCallback(async () => {
    await clearAudioCache();
    setCacheSize(0);
    toast.success("Audio cache cleared");
  }, []);

  const stats = useMemo(() => {
    if (!episodes) return null;

    const total = episodes.length;
    const played = episodes.filter((e) => (e.playbackPosition ?? 0) > 0);
    const completed = episodes.filter(
      (e) => e.duration && e.playbackPosition && e.playbackPosition / e.duration > 0.9,
    );

    // Listening time
    const totalListenedSeconds = played.reduce((sum, e) => sum + (e.playbackPosition ?? 0), 0);
    const librarySeconds = episodes.reduce((sum, e) => sum + (e.duration ?? 0), 0);

    // Episodes per year
    const yearCounts = new Map<string, number>();
    const yearDurations = new Map<string, number>();
    for (const ep of episodes) {
      const year = ep.airDate?.slice(0, 4) ?? "Unknown";
      yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
      yearDurations.set(year, (yearDurations.get(year) ?? 0) + (ep.duration ?? 0));
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
      .slice(0, 20);
    const maxGuestCount = topGuests[0]?.[1] ?? 1;

    // Show types
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

    // Tag cloud
    const tagCounts = new Map<string, number>();
    for (const ep of episodes) {
      if (ep.aiTags) {
        for (const tag of ep.aiTags) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }
    }
    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50);
    const maxTagCount = topTags[0]?.[1] ?? 1;

    // Most-listened episodes (by play count)
    const mostListened = [...episodes]
      .filter((e) => (e.playCount ?? 0) > 0)
      .sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
      .slice(0, 5);

    // Decade breakdown
    const decades = new Map<string, number>();
    for (const [year, count] of yearCounts) {
      if (year === "Unknown") continue;
      const decade = year.slice(0, 3) + "0s";
      decades.set(decade, (decades.get(decade) ?? 0) + count);
    }

    // Category breakdown
    const categoryCounts = new Map<string, number>();
    for (const ep of episodes) {
      if (ep.aiCategory) {
        categoryCounts.set(ep.aiCategory, (categoryCounts.get(ep.aiCategory) ?? 0) + 1);
      }
    }
    const topCategories = Array.from(categoryCounts.entries())
      .sort((a, b) => b[1] - a[1]);
    const maxCategoryCount = topCategories[0]?.[1] ?? 1;

    // Notable episodes count
    const notableCount = episodes.filter((e) => e.aiNotable).length;

    // Series count
    const seriesNames = new Set(episodes.filter((e) => e.aiSeries).map((e) => e.aiSeries!));

    // Ratings stats
    const rated = episodes.filter((e) => e.rating && e.rating >= 1);
    const avgRating = rated.length > 0
      ? rated.reduce((sum, e) => sum + (e.rating ?? 0), 0) / rated.length
      : 0;
    const fiveStarCount = episodes.filter((e) => e.rating === 5).length;

    // Listening streak (consecutive days with history entries)
    let streak = 0;
    if (history && history.length > 0) {
      const daySet = new Set<string>();
      for (const entry of history) {
        daySet.add(new Date(entry.timestamp).toISOString().slice(0, 10));
      }
      const today = new Date();
      for (let d = 0; d < 365; d++) {
        const date = new Date(today);
        date.setDate(date.getDate() - d);
        const key = date.toISOString().slice(0, 10);
        if (daySet.has(key)) {
          streak++;
        } else if (d === 0) {
          // Today hasn't been listened yet, still check yesterday
          continue;
        } else {
          break;
        }
      }
    }
    const favoriteCount = episodes.filter((e) => !!e.favoritedAt).length;

    return {
      total,
      played: played.length,
      completed: completed.length,
      totalListenedSeconds,
      librarySeconds,
      years,
      yearDurations,
      topGuests,
      maxGuestCount,
      showCounts,
      aiCompleted,
      aiFailed,
      aiPending,
      archiveCount,
      localCount,
      topTags,
      maxTagCount,
      mostListened,
      decades: Array.from(decades.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      uniqueGuests: guestCounts.size,
      uniqueTags: tagCounts.size,
      topCategories,
      maxCategoryCount,
      notableCount,
      seriesCount: seriesNames.size,
      avgRating,
      ratedCount: rated.length,
      fiveStarCount,
      streak,
      favoriteCount,
    };
  }, [episodes, history]);

  if (!stats) {
    return (
      <div className="p-4 flex flex-col gap-4 max-w-5xl mx-auto">
        <Window title="Station Dashboard" variant="dark">
          <div className="p-6 text-center min-h-[200px] flex items-center justify-center">
            <div className="animate-dot-1 inline-block text-bevel-dark text-[10px]">Loading station data</div>
          </div>
        </Window>
      </div>
    );
  }

  if (stats.total === 0) {
    return (
      <div className="p-4 flex flex-col gap-4 max-w-5xl mx-auto">
        <Window title="Station Dashboard" variant="dark">
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <div className="text-[24px] text-desert-amber/30 select-none">{"\u{1F4E1}"}</div>
            <div className="text-[11px] text-bevel-dark">No episodes in the library yet.</div>
            <div className="text-[9px] text-bevel-dark/60">
              {isAdmin
                ? "Import episodes from the Scanner or Search page to see your station stats."
                : "No episodes in the library yet. Check back soon!"}
            </div>
          </div>
        </Window>
      </div>
    );
  }

  const maxYearCount = Math.max(...stats.years.map(([, c]) => c), 1);
  const completionPct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  const listenedHours = stats.totalListenedSeconds / 3600;
  const libraryHours = stats.librarySeconds / 3600;
  const listenedDays = listenedHours / 24;

  return (
    <div className="p-4 flex flex-col gap-4 max-w-5xl mx-auto h-full overflow-auto overscroll-contain">

      {/* Listening Stats Banner */}
      <ListeningStats />

      {/* ── Signal Report ── Hero stats */}
      <Window title="Signal Report" variant="dark">
        <div className="p-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            <HeroStat
              label="Episodes"
              value={stats.total.toLocaleString()}
              sub={`${stats.uniqueGuests.toLocaleString()} guests`}
              color="text-desktop-gray"
            />
            <HeroStat
              label="Library"
              value={`${libraryHours.toFixed(0)}h`}
              sub={`${listenedDays > 1 ? Math.round(libraryHours / 24) + " days" : Math.round(libraryHours) + " hours"} of audio`}
              color="text-title-bar-blue"
            />
            <HeroStat
              label="Listened"
              value={`${listenedHours.toFixed(1)}h`}
              sub={`${stats.played.toLocaleString()} episodes`}
              color="text-static-green"
            />
            <HeroStat
              label="Completed"
              value={stats.completed.toLocaleString()}
              sub={`${completionPct}% of library`}
              color="text-desert-amber"
            />
            <HeroStat
              label="Sources"
              value={stats.archiveCount.toLocaleString()}
              sub={`archive \u00B7 ${stats.localCount.toLocaleString()} local`}
              color="text-bevel-dark"
            />
          </div>

          {/* Second row: enrichment stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mt-2">
            <HeroStat
              label="Notable"
              value={stats.notableCount.toLocaleString()}
              sub="iconic episodes"
              color="text-yellow-400"
            />
            <HeroStat
              label="Series"
              value={stats.seriesCount.toLocaleString()}
              sub="multi-part sets"
              color="text-title-bar-blue"
            />
            <HeroStat
              label="Favorites"
              value={stats.favoriteCount.toLocaleString()}
              sub={`${stats.ratedCount} rated`}
              color="text-desert-amber"
            />
            <HeroStat
              label="Avg Rating"
              value={stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "\u2014"}
              sub={stats.fiveStarCount > 0 ? `${stats.fiveStarCount} five-star` : "no ratings yet"}
              color="text-desert-amber"
            />
            <HeroStat
              label="Streak"
              value={stats.streak > 0 ? `${stats.streak}d` : "\u2014"}
              sub={stats.streak > 0 ? "consecutive days" : "listen today!"}
              color="text-static-green"
            />
          </div>

          {/* Completion gauge */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[8px] text-bevel-dark uppercase tracking-wider w-[60px]">Progress</span>
            <div className="flex-1 h-[6px] w98-inset-dark bg-inset-well overflow-hidden">
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${completionPct}%`,
                  background: "linear-gradient(90deg, #000080 0%, #4ADE80 50%, #D4A843 100%)",
                }}
              />
            </div>
            <span className="text-[9px] text-desert-amber tabular-nums w-[30px] text-right">
              {completionPct}%
            </span>
          </div>
        </div>
      </Window>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ── Broadcast Log ── Year chart */}
        {stats.years.length > 0 && (
          <Window title="Broadcast Log" variant="dark" className="lg:col-span-2">
            <div className="p-3">
              {/* Decade summary */}
              {stats.decades.length > 1 && (
                <div className="flex items-center gap-3 mb-3 overflow-x-auto">
                  {stats.decades.map(([decade, count]) => (
                    <span key={decade} className="text-[10px] md:text-[9px] text-bevel-dark whitespace-nowrap flex-shrink-0">
                      <span className="text-desktop-gray">{decade}</span>
                      <span className="text-bevel-dark/60 ml-1">{count.toLocaleString()}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Year bars */}
              <div className="flex flex-col gap-[3px]">
                {stats.years.map(([year, count], i) => {
                  const pct = (count / maxYearCount) * 100;
                  const yearHours = (stats.yearDurations.get(year) ?? 0) / 3600;
                  return (
                    <div key={year} className="flex items-center gap-2 group">
                      <span className="text-[11px] md:text-[9px] text-desert-amber tabular-nums w-[36px] md:w-[32px] text-right">
                        {year}
                      </span>
                      <div className="flex-1 h-[18px] md:h-[14px] w98-inset-dark bg-inset-well overflow-hidden">
                        <div
                          className="h-full animate-bar-grow relative"
                          style={{
                            width: `${pct}%`,
                            "--i": i,
                            background: `linear-gradient(90deg, #000080 0%, ${pct > 60 ? "#0A246A" : "#000080"} 100%)`,
                          } as React.CSSProperties}
                        >
                          {/* Inner label */}
                          {pct > 20 && (
                            <span className="absolute inset-0 flex items-center justify-end pr-1 text-[7px] text-white/60 tabular-nums">
                              {count}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-[8px] text-bevel-dark/60 tabular-nums w-[36px] md:w-[48px] text-right opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        {yearHours.toFixed(0)}h
                      </span>
                      {pct <= 20 && (
                        <span className="text-[8px] text-bevel-dark tabular-nums w-[20px]">
                          {count}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </Window>
        )}

        {/* ── Program Guide ── Show types */}
        <Window title="Program Guide" variant="dark">
          <div className="p-3 flex flex-col gap-3">
            {/* Stacked bar */}
            <div className="h-[20px] w98-inset-dark bg-inset-well overflow-hidden flex">
              {(
                [
                  ["coast", "#000080"],
                  ["dreamland", "#166534"],
                  ["special", "#92400e"],
                  ["unknown", "#333B58"],
                ] as const
              ).map(([key, color]) => {
                const count = stats.showCounts.get(key) ?? 0;
                if (count === 0) return null;
                const pct = (count / stats.total) * 100;
                return (
                  <div
                    key={key}
                    className="h-full relative group"
                    style={{ width: `${pct}%`, background: color }}
                    title={`${key}: ${count}`}
                  >
                    {pct > 8 && (
                      <span className="absolute inset-0 flex items-center justify-center text-[7px] text-white/70">
                        {Math.round(pct)}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="grid grid-cols-2 gap-2">
              {([
                ["coast", "Coast to Coast AM", "bg-title-bar-blue"],
                ["dreamland", "Dreamland", "bg-green-800"],
                ["special", "Specials", "bg-amber-800"],
                ["unknown", "Uncategorized", "bg-[#333B58]"],
              ] as const).map(([key, label, bg]) => {
                const count = stats.showCounts.get(key) ?? 0;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className={cn("w-[8px] h-[8px] flex-shrink-0", bg)} />
                    <span className="text-[9px] text-desktop-gray flex-1 truncate">{label}</span>
                    <span className="text-[9px] text-bevel-dark tabular-nums">{count.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Window>

        {/* ── Subject Breakdown ── Category chart */}
        {stats.topCategories.length > 0 && (
          <Window title="Subject Breakdown" variant="dark">
            <div className="p-3">
              <div className="flex flex-col gap-[3px]">
                {stats.topCategories.map(([cat, count], i) => {
                  const pct = (count / stats.maxCategoryCount) * 100;
                  return (
                    <div key={cat} className="flex items-center gap-2 group">
                      <span className="text-[10px] md:text-[9px] text-desktop-gray truncate w-[80px] md:w-[120px] flex-shrink-0 text-right">
                        {cat}
                      </span>
                      <div className="flex-1 h-[12px] w98-inset-dark bg-inset-well overflow-hidden">
                        <div
                          className="h-full bg-desert-amber/40 animate-bar-grow"
                          style={{
                            width: `${pct}%`,
                            "--i": i,
                          } as React.CSSProperties}
                        />
                      </div>
                      <span className="text-[8px] text-bevel-dark tabular-nums w-[28px] text-right">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Window>
        )}

        {/* ── Station Status ── AI + Sources */}
        <Window title="Station Status" variant="dark">
          <div className="p-3 flex flex-col gap-3">
            {/* AI categorization progress */}
            <div>
              <div className="text-[8px] text-bevel-dark uppercase tracking-wider mb-1.5">
                AI Categorization
              </div>
              <div className="h-[8px] w98-inset-dark bg-inset-well overflow-hidden flex mb-1.5">
                {stats.aiCompleted > 0 && (
                  <div
                    className="h-full bg-static-green/60"
                    style={{ width: `${(stats.aiCompleted / stats.total) * 100}%` }}
                  />
                )}
                {stats.aiFailed > 0 && (
                  <div
                    className="h-full bg-red-500/60"
                    style={{ width: `${(stats.aiFailed / stats.total) * 100}%` }}
                  />
                )}
              </div>
              <div className="flex items-center gap-3 text-[9px]">
                <span className="text-static-green">{stats.aiCompleted.toLocaleString()} done</span>
                <span className="text-desert-amber">{stats.aiPending.toLocaleString()} pending</span>
                {stats.aiFailed > 0 && <span className="text-red-400">{stats.aiFailed.toLocaleString()} failed</span>}
              </div>
            </div>

            {/* Source breakdown */}
            <div>
              <div className="text-[8px] text-bevel-dark uppercase tracking-wider mb-1.5">
                Sources
              </div>
              <div className="h-[8px] w98-inset-dark bg-inset-well overflow-hidden flex mb-1.5">
                {stats.archiveCount > 0 && (
                  <div
                    className="h-full bg-title-bar-blue/70"
                    style={{ width: `${(stats.archiveCount / stats.total) * 100}%` }}
                  />
                )}
                {stats.localCount > 0 && (
                  <div
                    className="h-full bg-bevel-dark/50"
                    style={{ width: `${(stats.localCount / stats.total) * 100}%` }}
                  />
                )}
              </div>
              <div className="flex items-center gap-3 text-[9px]">
                <span className="text-title-bar-blue">{stats.archiveCount.toLocaleString()} archive</span>
                <span className="text-bevel-dark">{stats.localCount.toLocaleString()} local</span>
              </div>
            </div>
          </div>
        </Window>

        {/* ── Audio Cache ── OPFS storage */}
        {cacheSize !== null && (
          <Window title="Audio Cache" variant="dark">
            <div className="p-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[12px] md:text-[10px] text-desktop-gray">
                  {cacheSize > 0 ? formatBytes(cacheSize) : "Empty"}
                </div>
                <div className="text-[10px] md:text-[8px] text-bevel-dark/60">
                  Offline audio cached in OPFS
                </div>
              </div>
              {cacheSize > 0 && (
                <Button variant="dark" size="sm" onClick={handleClearCache}>
                  Clear Cache
                </Button>
              )}
            </div>
          </Window>
        )}

        {/* ── Frequent Callers ── Top guests */}
        {stats.topGuests.length > 0 && (
          <Window title="Frequent Callers" variant="dark">
            <div className="p-3">
              <div className="flex flex-col gap-[3px]">
                {stats.topGuests.map(([guest, count], i) => (
                  <div key={guest} className="flex items-center gap-2 group">
                    <span className="text-[8px] text-bevel-dark/60 tabular-nums w-[14px] text-right">
                      {i + 1}
                    </span>
                    <span className="text-[11px] md:text-[10px] text-desktop-gray truncate w-[100px] md:w-[140px] flex-shrink-0">
                      {guest}
                    </span>
                    <div className="flex-1 h-[10px] w98-inset-dark bg-inset-well overflow-hidden">
                      <div
                        className="h-full bg-static-green/40 animate-bar-grow"
                        style={{
                          width: `${(count / stats.maxGuestCount) * 100}%`,
                          "--i": i,
                        } as React.CSSProperties}
                      />
                    </div>
                    <span className="text-[8px] text-bevel-dark tabular-nums w-[24px] text-right">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Window>
        )}

        {/* ── Most Listened ── Top played episodes */}
        {stats.mostListened.length > 0 && (
          <Window title="Most Listened" variant="dark">
            <div className="p-3">
              <div className="flex flex-col gap-2">
                {stats.mostListened.map((ep, i) => {
                  const progress = ep.duration && ep.playbackPosition
                    ? Math.min(100, Math.round((ep.playbackPosition / ep.duration) * 100))
                    : 0;
                  return (
                    <div key={ep.id} className="flex items-start gap-2">
                      <span className="text-[8px] text-bevel-dark/60 tabular-nums w-[12px] text-right mt-0.5">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] md:text-[10px] text-desktop-gray truncate font-bold">
                          {ep.title || ep.fileName}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {ep.airDate && (
                            <span className="text-[9px] md:text-[8px] text-desert-amber tabular-nums">{ep.airDate}</span>
                          )}
                          {ep.guestName && (
                            <span className="text-[9px] md:text-[8px] text-static-green/70 truncate">{ep.guestName}</span>
                          )}
                        </div>
                        <div className="h-[3px] w98-inset-dark bg-inset-well mt-1 overflow-hidden">
                          <div
                            className="h-full bg-desert-amber/50"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-[8px] text-bevel-dark tabular-nums flex-shrink-0 mt-0.5">
                        {progress}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Window>
        )}
      </div>

      {/* ── Topic Index ── Tag cloud (full width) */}
      {stats.topTags.length > 0 && (
        <Window title={`Topic Index \u00B7 ${stats.uniqueTags.toLocaleString()} tags`} variant="dark">
          <div className="p-4">
            <div className="flex flex-wrap gap-x-2 gap-y-1.5 justify-center">
              {stats.topTags.map(([tag, count]) => {
                const ratio = count / stats.maxTagCount;
                const size = 10 + ratio * 10; // 10px to 20px
                const opacity = 0.3 + ratio * 0.7; // 0.3 to 1.0
                return (
                  <button
                    key={tag}
                    className="tag-cloud-item cursor-pointer select-none hover:underline"
                    style={{
                      fontSize: `${size}px`,
                      color: `rgba(212, 168, 67, ${opacity})`,
                    }}
                    title={`Filter library by "${tag}" (${count})`}
                    onClick={() => {
                      router.push("/library");
                      setTimeout(() => {
                        window.dispatchEvent(new CustomEvent("hd:filter-tag", { detail: tag }));
                      }, 100);
                    }}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        </Window>
      )}

      {/* Smart Playlists + History row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WidgetErrorBoundary name="Smart Playlists">
          <SmartPlaylists onPlay={(ep) => {
            window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: ep }));
          }} />
        </WidgetErrorBoundary>
        <WidgetErrorBoundary name="History">
          <HistoryPanel />
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}

function HeroStat({ label, value, sub, color }: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center p-2.5 md:p-2 w98-inset-dark bg-inset-well gap-0.5">
      <div className={cn("text-[18px] md:text-[16px] font-bold tabular-nums", color)}>
        {value}
      </div>
      <div className="text-[9px] md:text-[8px] text-bevel-dark uppercase tracking-wider">
        {label}
      </div>
      <div className="text-[8px] md:text-[7px] text-bevel-dark/50 truncate max-w-full text-center">
        {sub}
      </div>
    </div>
  );
}
