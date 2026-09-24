"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
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
import { PlaybackFailures } from "@/components/library/PlaybackFailures";
import { cn } from "@/lib/utils/cn";
import { formatAirDate } from "@/lib/utils/format";
import { getCacheSize, clearAudioCache } from "@/audio/cache";
import { toast } from "@/stores/toast-store";
import { computeLibraryStats } from "@/lib/stats/library-stats";
import { emit } from "@/lib/events";
import { useOpenLibraryIntent } from "@/hooks/useOpenLibraryIntent";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

export default function StatsPage() {
  const openLibrary = useOpenLibraryIntent();
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

  const stats = useMemo(
    // Both, or neither: with episodes loaded and history not yet, Listened
    // and Streak rendered 0 for a frame and then jumped.
    () => (episodes && history ? computeLibraryStats(episodes, history) : null),
    [episodes, history],
  );

  // The page's h1 is "Station Dashboard" in stats/layout.tsx, present in every
  // state. These two windows used to be h1s themselves, so the loading and
  // empty states had a heading the populated page lacked — and with the
  // layout's, they would have had two.
  if (!stats) {
    return (
      <div className="p-4 flex flex-col gap-4 max-w-5xl mx-auto">
        <Window title="Station Dashboard" variant="dark">
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
        <Window title="Station Dashboard" variant="dark">
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            {/* Decorative glyph, hidden from assistive technology: no text to read. */}
            {/* eslint-disable-next-line hd/text-opacity-floor */}
            <div className="text-hd-24 text-desert-amber opacity-30 select-none" aria-hidden="true">{"\u{1F4E1}"}</div>
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
  const listenedHours = stats.listenedSeconds / 3600;
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
              sub={`${stats.listenedEpisodes.toLocaleString()} ${stats.listenedEpisodes === 1 ? 'episode' : 'episodes'}`}
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
              onClick={stats.ratedCount > 0 ? () => openLibrary({ sort: "my-rating" }) : undefined}
              title="Your ratings — open the library sorted by My rating"
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
          Composition of the catalog as this browser holds it. For a visitor on
          the shipped seed that is the same for everyone; it is not guaranteed
          to be: reconcile never deletes, so a library seeded before an episode
          was pulled (docs/broken-episodes.md) still counts it, and admin
          imports add rows. Several of these were previously framed as personal
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
              sub={`\u2248 ${Math.round(stats.librarySeconds / 86_400).toLocaleString()} days of audio`}
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

              {stats.undated > 0 && (
                <div className="text-hd-9 text-bevel-dark/85 mb-2" data-undated={stats.undated}>
                  {stats.undated.toLocaleString()} undated {stats.undated === 1 ? "episode is" : "episodes are"} in the total but in no year.
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
                      <span className="absolute inset-0 flex items-center justify-center text-hd-7 text-white">
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

        {/* ── Playback Failures ── Admin only. Server-side, unlike everything
            else on this page: which shows fail to start is a fact about the
            catalog, not about this browser's listening. */}
        {isAdmin && <PlaybackFailures />}

        {/* ── Flagged Episodes ── Admin only */}
        {isAdmin && stats.flaggedEpisodes.length > 0 && (
          <Window title={`Flagged Episodes \u00B7 ${stats.flaggedEpisodes.length}`} variant="dark" headingLevel={2}>
            <div className="p-3 flex flex-col gap-[3px] max-h-[200px] overflow-auto overscroll-contain">
              {stats.flaggedEpisodes.map((ep) => (
                <button
                  key={ep.id}
                  onClick={() => {
                    // The layout hears play-episode on every route, so play
                    // first and then show it in the library — no timer waiting
                    // for the page to mount (HD-013).
                    emit("play-episode", ep);
                    openLibrary({ scroll: "current" });
                  }}
                  className="flex items-center gap-2 text-left px-2 py-1.5 w98-raised-dark bg-card-surface cursor-pointer hover:bg-title-bar-blue/15 transition-colors-fast"
                >
                  <span className="text-hd-9 text-red-400">⚑</span>
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

        {/* ── My Most Played ── This browser's plays, and it says so. It was
            "Most Listened", ranked by local playCount but showing progress %,
            so the number beside each row was not the number it was ranked by
            and nothing said whose plays they were. */}
        {stats.myMostPlayed.length > 0 && (
          <Window title="My Most Played" variant="dark" headingLevel={2}>
            <div className="p-3">
              <div className="flex flex-col gap-2" data-testid="my-most-played">
                {stats.myMostPlayed.map((ep, i) => {
                  const plays = ep.playCount ?? 0;
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
                      </div>
                      <span className="text-hd-8 text-bevel-dark tabular-nums flex-shrink-0 mt-0.5" data-plays={plays}>
                        {plays} {plays === 1 ? "play" : "plays"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => openLibrary({ sort: "my-plays" })}
                className="mt-2 text-hd-9 text-signal-blue hover:underline cursor-pointer"
              >
                All, sorted by My plays →
              </button>
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
                // Weight shows in size; colour only steps from the /85 text
                // floor to full (it went down to 0.5 — HD-023).
                const opacity = 0.85 + ratio * 0.15;
                return (
                  <button
                    key={tag}
                    className="tag-cloud-item cursor-pointer select-none hover:underline"
                    style={{
                      // Scaled with the text-size setting, like the text-hd-* steps.
                      fontSize: `calc(${size}px * var(--hd-text-scale, 1))`,
                      color: `rgba(212, 168, 67, ${opacity})`,
                    }}
                    title={`Filter library by "${tag}" (${count})`}
                    onClick={() => openLibrary({ q: `tag:${tag}` })}
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
            emit("play-episode", ep);
          }} />
        </WidgetErrorBoundary>
        <WidgetErrorBoundary name="History">
          <HistoryPanel />
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}

function HeroStat({ label, value, sub, color, className, onClick, title }: {
  label: string;
  value: string;
  sub: string;
  color: string;
  className?: string;
  /** A drill-down: the tile becomes a button. */
  onClick?: () => void;
  title?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick, title } : {})}
      data-stat={label}
      className={cn(
        "flex flex-col items-center p-2.5 md:p-2 w98-inset-dark bg-inset-well gap-0.5",
        onClick && "cursor-pointer hover:bg-title-bar-blue/15",
        className,
      )}
    >
      <div className={cn("text-hd-18 md:text-hd-16 font-bold tabular-nums", color)}>
        {value}
      </div>
      <div className="text-hd-9 md:text-hd-8 text-bevel-dark uppercase tracking-wider">
        {label}
      </div>
      <div className="text-hd-8 md:text-hd-7 text-bevel-dark/85 truncate max-w-full text-center">
        {sub}
      </div>
    </Tag>
  );
}
