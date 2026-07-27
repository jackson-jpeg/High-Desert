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
import { CommunityLeaderboard } from "@/components/library/CommunityLeaderboard";
import { SignalTraffic } from "@/components/library/SignalTraffic";
import { OnAir } from "@/components/library/OnAir";
import { cn } from "@/lib/utils/cn";
import { formatAirDate } from "@/lib/utils/format";
import { getCacheSize, clearAudioCache } from "@/audio/cache";
import { toast } from "@/stores/toast-store";
import { computeStreak } from "@/lib/utils/streak";

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

    const streak = computeStreak(history);
    const favoriteCount = episodes.filter((e) => !!e.favoritedAt).length;
    const flaggedEpisodes = episodes.filter((e) => !!e.flaggedAt);

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
      flaggedEpisodes,
    };
  }, [episodes, history]);

  if (!stats) {
    return (
      <div className="p-4 flex flex-col gap-4 max-w-5xl mx-auto">
        <Window title="Station Dashboard" variant="dark" headingLevel={1}>
          <div className="p-6 text-center min-h-[200px] flex items-center justify-center">
            <div className="animate-dot-1 inline-block text-bevel-dark text-hd-10">Loading station data</div>
          </div>
        </Window>
      </div>
    );
  }

  if (stats.total === 0) {
    return (
      <div className="p-4 flex flex-col gap-4 max-w-5xl mx-auto">
        <Window title="Station Dashboard" variant="dark" headingLevel={1}>
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <div className="text-hd-24 text-desert-amber/30 select-none">{"\u{1F4E1}"}</div>
            <div className="text-hd-11 text-bevel-dark">No episodes in the library yet.</div>
            <div className="text-hd-9 text-bevel-dark/85">
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
  const listenedHours = stats.totalListenedSeconds / 3600;
  const libraryHours = stats.librarySeconds / 3600;

  return (
    <div className="p-4 pb-24 md:pb-4 flex flex-col gap-4 max-w-7xl mx-auto h-full overflow-auto overscroll-contain">

      {/* The ListeningStats banner used to sit here, rendering the streak 40px
          above the Streak tile below it. computeStreak ran three times across
          the app; the status bar keeps its copy, this page keeps the tile. */}

      {/* ── On Air ── what other people have playing right now, joinable in a
          click. First on the page because it is the only thing here that is
          about anyone other than the visitor, and the only reason to come back
          to this page twice. Renders nothing when nobody is around or the
          stats service is unavailable. */}
      <WidgetErrorBoundary name="On Air">
        <OnAir />
      </WidgetErrorBoundary>

      {/* ── Signal Traffic ── the click-through target for the live count in
          the status bar. Ahead of the personal figures: it is the only
          genuinely multi-visitor data here, and the only part that changes
          minute to minute. Renders nothing when the stats service is
          unavailable. */}
      <WidgetErrorBoundary name="Signal Traffic">
        <SignalTraffic />
      </WidgetErrorBoundary>

      {/* ── Your Listening ──
          Only figures that describe *this visitor*. Previously these were mixed
          in with catalog counts under one "Signal Report" heading, so a first
          visit showed a dashboard of zeros and it was not obvious which numbers
          were even capable of changing. */}
      <Window title="Your Listening" variant="dark" headingLevel={2}>
        <div className="p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <HeroStat
              label="Listened"
              value={`${listenedHours.toFixed(1)}h`}
              sub={`${stats.played.toLocaleString()} ${stats.played === 1 ? 'episode' : 'episodes'}`}
              color="text-static-green"
            />
            <HeroStat
              label="Favorites"
              value={stats.favoriteCount.toLocaleString()}
              sub={stats.favoriteCount === 0 ? "Star episodes to save them here." : `${stats.ratedCount} ${stats.ratedCount === 1 ? 'episode' : 'episodes'} rated`}
              color="text-desert-amber"
            />
            <HeroStat
              label="Avg Rating"
              value={stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "\u2014"}
              sub={stats.avgRating === 0 ? "Rate episodes to track your taste." : `${stats.ratedCount} ${stats.ratedCount === 1 ? 'rating' : 'ratings'}`}
              color="text-desert-amber"
            />
            <HeroStat
              label="Streak"
              value={stats.streak > 0 ? `${stats.streak}d` : "\u2014"}
              sub={stats.streak > 0 ? (stats.streak === 1 ? "consecutive day" : "consecutive days") : "listen today!"}
              color="text-static-green"
            />
          </div>
          {/* The "Completed" tile and its Progress gauge lived here. Across
              ~1,300 four-hour episodes both read 0 for essentially everyone,
              forever \u2014 the code even special-cased 0% to add an apology. A
              metric whose only realistic value is 0 is not a metric. */}

        </div>
      </Window>

      {/* \u2500\u2500 The Archive \u2500\u2500
          Composition of the shipped catalog. Identical for every visitor, and
          labelled as such: several of these were previously framed as personal
          statistics, which they never were. */}
      <Window title="The Archive" variant="dark" headingLevel={2}>
        <div className="p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <HeroStat
              label="Episodes"
              value={stats.total.toLocaleString()}
              sub={`${stats.uniqueGuests.toLocaleString()} ${stats.uniqueGuests === 1 ? 'guest' : 'guests'}`}
              color="text-desktop-gray"
            />
            <HeroStat
              label="Runtime"
              value={`${libraryHours.toFixed(0)}h`}
              sub={`${Math.round(libraryHours / 24).toLocaleString()} days of audio`}
              color="text-signal-blue"
            />
            <HeroStat
              label="Notable"
              value={stats.notableCount.toLocaleString()}
              sub={stats.notableCount === 1 ? "iconic episode" : "iconic episodes"}
              color="text-yellow-400"
            />
            <HeroStat
              label="Series"
              value={stats.seriesCount.toLocaleString()}
              sub={stats.seriesCount === 1 ? "multi-part set" : "multi-part sets"}
              color="text-signal-blue"
            />
          </div>
        </div>
      </Window>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ── Broadcast Log ── Year chart */}
        {stats.years.length > 0 && (
          <Window title="Broadcast Log" variant="dark" headingLevel={2} className="lg:col-span-2">
            <div className="p-3">
              {/* Decade summary */}
              {stats.decades.length > 1 && (
                <div className="flex items-center gap-3 mb-3 overflow-x-auto">
                  {stats.decades.map(([decade, count]) => (
                    <span key={decade} className="text-hd-10 md:text-hd-9 text-bevel-dark whitespace-nowrap flex-shrink-0">
                      <span className="text-desktop-gray">{decade}</span>
                      <span className="text-bevel-dark/85 ml-1">{count.toLocaleString()}</span>
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
                    /* The count used to render *inside* the bar when it was
                       wide enough (white/60 on mid-blue, ~2.3:1) and, when it
                       wasn't, in an extra span appended after the hours column
                       — so short years printed their number far to the right,
                       detached from their bar. One fixed column, always in the
                       same place, outside the fill. */
                    <div key={year} className="flex items-center gap-2 group">
                      <span className="text-hd-11 md:text-hd-9 text-desert-amber tabular-nums w-[36px] md:w-[32px] text-right">
                        {year}
                      </span>
                      <div className="flex-1 h-[18px] md:h-[14px] w98-inset-dark bg-inset-well overflow-hidden">
                        <div
                          className="h-full animate-bar-grow"
                          style={{
                            width: `${pct}%`,
                            "--i": i,
                            background: `linear-gradient(90deg, #1E3A8A 0%, ${pct > 60 ? "#1D4ED8" : "#1E3A8A"} 100%)`,
                          } as React.CSSProperties}
                        />
                      </div>
                      <span className="text-hd-9 text-desktop-gray tabular-nums w-[36px] text-right">
                        {count}
                      </span>
                      <span className="text-hd-9 text-bevel-dark/85 tabular-nums w-[40px] text-right">
                        {yearHours.toFixed(0)}h
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Window>
        )}

        {/* ── Program Guide ── Show types */}
        <Window title="Program Guide" variant="dark" headingLevel={2}>
          <div className="p-3 flex flex-col gap-3">
            {/* Stacked bar */}
            <div className="h-[20px] w98-inset-dark bg-inset-well overflow-hidden flex">
              {(
                [
                  ["coast", "#1E3A8A"],
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
                      <span className="absolute inset-0 flex items-center justify-center text-hd-7 text-white/70">
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
                    <span className="text-hd-9 text-desktop-gray flex-1 truncate">{label}</span>
                    <span className="text-hd-9 text-bevel-dark tabular-nums">{count.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Window>

        {/* ── Subject Breakdown ── Category chart */}
        {stats.topCategories.length > 0 && (
          <Window title="Subject Breakdown" variant="dark" headingLevel={2}>
            <div className="p-3">
              <div className="flex flex-col gap-[3px]">
                {stats.topCategories.map(([cat, count], i) => {
                  const pct = (count / stats.maxCategoryCount) * 100;
                  return (
                    <div key={cat} className="flex items-center gap-2 group">
                      <span className="text-hd-10 md:text-hd-9 text-desktop-gray truncate w-[80px] md:w-[120px] flex-shrink-0 text-right">
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
                      <span className="text-hd-8 text-bevel-dark tabular-nums w-[28px] text-right">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Window>
        )}

        {/* The "Station Status" window stood here with two panels, both
            removed as they could only ever display one value:

            - AI Categorization: db/seed.ts sets aiStatus to "completed" for
              every seeded row, so for anyone on the shipped catalog the bar was
              permanently 100% green with "0 pending, 0 failed".
            - Sources: `local` only becomes non-zero via the Scanner, which is
              admin-gated, so every ordinary visitor saw a fixed
              "1313 archive · 0 local" — the same constant the Sources hero tile
              was already rendering a few hundred pixels above. */}

        {/* ── Audio Cache ── OPFS storage */}
        {cacheSize !== null && (
          <Window title="Audio Cache" variant="dark" headingLevel={2}>
            <div className="p-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-hd-12 md:text-hd-10 text-desktop-gray">
                  {cacheSize > 0 ? formatBytes(cacheSize) : "Empty"}
                </div>
                <div className="text-hd-10 md:text-hd-8 text-bevel-dark/85">
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

        {/* ── Flagged Episodes ── Admin only */}
        {isAdmin && stats.flaggedEpisodes.length > 0 && (
          <Window title={`Flagged Episodes \u00B7 ${stats.flaggedEpisodes.length}`} variant="dark" headingLevel={2}>
            <div className="p-3 flex flex-col gap-[3px] max-h-[200px] overflow-auto overscroll-contain">
              {stats.flaggedEpisodes.map((ep) => (
                <button
                  key={ep.id}
                  onClick={() => {
                    router.push("/library");
                    setTimeout(() => {
                      window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: ep }));
                    }, 200);
                  }}
                  className="flex items-center gap-2 text-left px-2 py-1.5 w98-raised-dark bg-card-surface cursor-pointer hover:bg-title-bar-blue/15 transition-colors-fast"
                >
                  <span className="text-hd-9 text-red-400/70">⚑</span>
                  <span className="text-hd-10 text-desktop-gray truncate flex-1">{ep.title || ep.fileName}</span>
                  <span className="text-hd-8 text-bevel-dark/85 tabular-nums flex-shrink-0">
                    {ep.airDate ? formatAirDate(ep.airDate) : ""}
                  </span>
                </button>
              ))}
            </div>
          </Window>
        )}

        {/* ── Most-Featured Guests ──
            Catalog composition: who appears most across the archive. It was
            titled "Frequent Callers", which reads as a record of who *you* have
            listened to; it never was. */}
        {stats.topGuests.length > 0 && (
          <Window title="Most-Featured Guests" variant="dark" headingLevel={2}>
            <div className="p-3">
              <div className="flex flex-col gap-[3px]">
                {stats.topGuests.map(([guest, count], i) => (
                  <div key={guest} className="flex items-center gap-2 group">
                    <span className="text-hd-8 text-bevel-dark/85 tabular-nums w-[14px] text-right">
                      {i + 1}
                    </span>
                    <span className="text-hd-11 md:text-hd-10 text-desktop-gray truncate w-[100px] md:w-[140px] flex-shrink-0">
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
                    <span className="text-hd-8 text-bevel-dark tabular-nums w-[24px] text-right">
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
          <Window title="Most Listened" variant="dark" headingLevel={2}>
            <div className="p-3">
              <div className="flex flex-col gap-2">
                {stats.mostListened.map((ep, i) => {
                  const progress = ep.duration && ep.playbackPosition
                    ? Math.min(100, Math.round((ep.playbackPosition / ep.duration) * 100))
                    : 0;
                  return (
                    <div key={ep.id} className="flex items-start gap-2">
                      <span className="text-hd-8 text-bevel-dark/85 tabular-nums w-[12px] text-right mt-0.5">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-hd-12 md:text-hd-10 text-desktop-gray truncate font-bold">
                          {ep.title || ep.fileName}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {ep.airDate && (
                            <span className="text-hd-9 md:text-hd-8 text-desert-amber tabular-nums">{ep.airDate}</span>
                          )}
                          {ep.guestName && (
                            <span className="text-hd-9 md:text-hd-8 text-static-green/85 truncate">{ep.guestName}</span>
                          )}
                        </div>
                        <div className="h-[3px] w98-inset-dark bg-inset-well mt-1 overflow-hidden">
                          <div
                            className="h-full bg-desert-amber/50"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-hd-8 text-bevel-dark tabular-nums flex-shrink-0 mt-0.5">
                        {progress}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Window>
        )}
        {/* ── Community Top 20 ── Leaderboard */}
        <WidgetErrorBoundary name="Community Leaderboard">
          <CommunityLeaderboard />
        </WidgetErrorBoundary>
      </div>

      {/* ── Topic Index ── Tag cloud (full width) */}
      {stats.topTags.length > 0 && (
        <Window title={`Topic Index \u00B7 ${stats.uniqueTags.toLocaleString()} tags`} variant="dark" headingLevel={2}>
          <div className="p-4">
            <div className="flex flex-wrap gap-x-2 gap-y-1.5 justify-center">
              {stats.topTags.map(([tag, count]) => {
                const ratio = count / stats.maxTagCount;
                const size = 10 + ratio * 10; // 10px to 20px
                const opacity = 0.5 + ratio * 0.5; // 0.5 to 1.0
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

function HeroStat({ label, value, sub, color, className }: {
  label: string;
  value: string;
  sub: string;
  color: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center p-2.5 md:p-2 w98-inset-dark bg-inset-well gap-0.5", className)}>
      <div className={cn("text-hd-18 md:text-hd-16 font-bold tabular-nums", color)}>
        {value}
      </div>
      <div className="text-hd-9 md:text-hd-8 text-bevel-dark uppercase tracking-wider">
        {label}
      </div>
      <div className="text-hd-8 md:text-hd-7 text-bevel-dark/85 truncate max-w-full text-center">
        {sub}
      </div>
    </div>
  );
}
