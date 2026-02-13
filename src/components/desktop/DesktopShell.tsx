"use client";

import { cn } from "@/lib/utils/cn";
import { MenuBar, StatusBar, Dialog, Button } from "@/components/win98";
import { ContextMenu } from "@/components/win98/ContextMenu";
import { Starfield } from "./Starfield";
import type { Menu } from "@/components/win98";
import { useRouter, usePathname } from "next/navigation";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { db } from "@/lib/db";
import { clearAudioCache, getCacheSize } from "@/lib/audio/cache";

interface DesktopShellProps {
  children: ReactNode;
  player?: ReactNode;
  episodeCount?: number;
  className?: string;
}

const NAV_ITEMS = [
  { label: "Library", path: "/library", icon: "\u{1F4DA}" },
  { label: "Scanner", path: "/scanner", icon: "\u{1F4E1}" },
  { label: "Search", path: "/search", icon: "\u{1F50D}" },
  { label: "Stats", path: "/stats", icon: "\u{1F4CA}" },
] as const;

const SHORTCUTS = [
  { keys: "Space", action: "Play / Pause" },
  { keys: "\u2190", action: "Seek back 15s" },
  { keys: "\u2192", action: "Seek forward 30s" },
  { keys: "\u2191", action: "Volume up" },
  { keys: "\u2193", action: "Volume down" },
  { keys: "N", action: "Next track" },
  { keys: "P", action: "Previous track" },
  { keys: "M", action: "Mute / Unmute" },
  { keys: "/ or Ctrl+F", action: "Focus search" },
  { keys: "\u21E7\u2191 / \u21E7\u2193", action: "Navigate library" },
  { keys: "Enter", action: "Play selected" },
  { keys: "Delete", action: "Delete selected" },
  { keys: "Escape", action: "Clear selection" },
];

export function DesktopShell({ children, player, episodeCount = 0, className }: DesktopShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [clock, setClock] = useState("");

  // Now-playing info from store
  const nowPlayingTitle = usePlayerStore((s) => s.currentEpisode?.title ?? s.currentEpisode?.fileName);
  const nowPlayingGuest = usePlayerStore((s) => s.currentEpisode?.guestName);
  const isPlaying = usePlayerStore((s) => s.playing);
  const hasEpisode = usePlayerStore((s) => !!s.currentEpisode);

  // Clock tick
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const h = now.getHours() % 12 || 12;
      const m = String(now.getMinutes()).padStart(2, "0");
      const period = now.getHours() >= 12 ? "PM" : "AM";
      setClock(`${h}:${m} ${period}`);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  const handleAbout = useCallback(() => setAboutOpen(true), []);
  const handleCloseAbout = useCallback(() => setAboutOpen(false), []);
  const handleShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const handleCloseShortcuts = useCallback(() => setShortcutsOpen(false), []);

  const handleClearLibrary = useCallback(async () => {
    setClearing(true);
    try {
      await db.episodes.clear();
      await db.scanSessions.clear();
    } finally {
      setClearing(false);
      setClearOpen(false);
    }
  }, []);

  const handleOpenClearCache = useCallback(async () => {
    setClearCacheOpen(true);
    const size = await getCacheSize();
    setCacheSize(size);
  }, []);

  const handleClearCache = useCallback(async () => {
    setClearingCache(true);
    try {
      await clearAudioCache();
    } finally {
      setClearingCache(false);
      setClearCacheOpen(false);
      setCacheSize(null);
    }
  }, []);

  const dispatchSort = useCallback((sort: string) => {
    window.dispatchEvent(new CustomEvent("hd:sort", { detail: sort }));
  }, []);

  const handleExport = useCallback(async () => {
    const episodes = await db.episodes.toArray();
    const data = {
      version: "0.4.0",
      exportedAt: new Date().toISOString(),
      episodeCount: episodes.length,
      episodes: episodes.map((ep) => ({
        title: ep.title,
        artist: ep.artist,
        airDate: ep.airDate,
        guestName: ep.guestName,
        showType: ep.showType,
        topic: ep.topic,
        description: ep.description,
        duration: ep.duration,
        format: ep.format,
        source: ep.source,
        sourceUrl: ep.sourceUrl,
        archiveIdentifier: ep.archiveIdentifier,
        aiSummary: ep.aiSummary,
        aiTags: ep.aiTags,
        aiStatus: ep.aiStatus,
        playbackPosition: ep.playbackPosition,
        playCount: ep.playCount,
        lastPlayedAt: ep.lastPlayedAt,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `high-desert-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "Open Folder...", shortcut: "Ctrl+O", onClick: () => router.push("/scanner") },
        { separator: true, label: "" },
        { label: "Exit", onClick: () => window.close() },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Sort by Date", onClick: () => dispatchSort("date") },
        { label: "Sort by Name", onClick: () => dispatchSort("name") },
        { label: "Sort by Guest", onClick: () => dispatchSort("guest") },
        { separator: true, label: "" },
        { label: "Statistics", onClick: () => router.push("/stats") },
      ],
    },
    {
      label: "Library",
      items: [
        {
          label: "Scan Folder...",
          shortcut: "Ctrl+Shift+S",
          onClick: () => router.push("/scanner"),
        },
        {
          label: "Search Archive...",
          onClick: () => router.push("/search"),
        },
        {
          label: "Import Catalog...",
          onClick: () => router.push("/scanner"),
        },
        { separator: true, label: "" },
        { label: "Export Library...", onClick: handleExport },
        { separator: true, label: "" },
        { label: "Clear Audio Cache...", onClick: handleOpenClearCache },
        { label: "Clear Library...", onClick: () => setClearOpen(true) },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Keyboard Shortcuts", onClick: handleShortcuts },
        { separator: true, label: "" },
        { label: "About High Desert", onClick: handleAbout },
      ],
    },
  ];

  // Status bar now-playing content
  const statusContent = (() => {
    if (!hasEpisode) return "Ready";
    const icon = isPlaying ? "\u25B6" : "\u275A\u275A";
    const parts = [nowPlayingTitle];
    if (nowPlayingGuest) parts.push(nowPlayingGuest);
    return (
      <span className="flex items-center gap-1.5">
        {isPlaying && (
          <span className="inline-block w-[5px] h-[5px] rounded-full bg-red-500 animate-on-air flex-shrink-0" />
        )}
        <span className="text-bevel-dark">{icon}</span>
        <span className="truncate">{parts.join(" \u2014 ")}</span>
      </span>
    );
  })();

  // Signal bars (animated when streaming)
  const signalBars = (
    <span className="flex items-end gap-[1px] h-[11px]">
      {[3, 5, 7, 9].map((h, i) => (
        <span
          key={i}
          className={cn(
            "w-[2px] bg-static-green/70",
            isPlaying ? `animate-signal-${i + 1}` : "opacity-20",
          )}
          style={{ height: `${h}px` }}
        />
      ))}
    </span>
  );

  return (
    <div
      className={cn(
        "flex flex-col h-screen w-screen overflow-hidden relative",
        className,
      )}
    >
      {/* Desert night sky */}
      <Starfield />

      {/* Top menu bar */}
      <MenuBar menus={menus} variant="dark" className="flex-shrink-0 relative z-10" />

      {/* Navigation tabs */}
      <nav className="flex-shrink-0 flex items-center gap-0 bg-midnight/80 border-b border-bevel-dark/20 px-2 relative z-10 backdrop-blur-xs">
        {NAV_ITEMS.map(({ label, path }) => {
          const isActive = pathname === path;
          return (
            <button
              key={path}
              onClick={() => router.push(path)}
              className={cn(
                "w98-font text-[10px] px-3 py-1.5 cursor-pointer select-none transition-colors-fast",
                isActive
                  ? "text-desktop-gray border-b-2 border-desert-amber"
                  : "text-bevel-dark hover:text-desktop-gray border-b-2 border-transparent",
              )}
            >
              {label}
            </button>
          );
        })}

        {/* On-Air indicator */}
        {isPlaying && (
          <div className="ml-auto flex items-center gap-1.5 pr-1">
            <span className="inline-block w-[5px] h-[5px] rounded-full bg-red-500 animate-on-air" />
            <span className="text-[8px] text-red-400/80 uppercase tracking-widest">On Air</span>
          </div>
        )}
      </nav>

      {/* Main content area */}
      <main className="flex-1 overflow-auto relative z-10">{children}</main>

      {/* Mini player slot */}
      {player && <div className="flex-shrink-0 relative z-10">{player}</div>}

      {/* Bottom status bar */}
      <StatusBar
        variant="dark"
        panels={[
          { content: statusContent, flex: 1 },
          { content: `${episodeCount.toLocaleString()} episode${episodeCount !== 1 ? "s" : ""}`, width: "120px" },
          { content: signalBars, width: "24px" },
          { content: clock, width: "72px" },
        ]}
        className="flex-shrink-0 relative z-10"
      />

      {/* Global context menu */}
      <ContextMenu />

      {/* About dialog */}
      <Dialog
        open={aboutOpen}
        onClose={handleCloseAbout}
        title="About High Desert"
        width="400px"
      >
        <div className="flex flex-col items-center gap-0 p-5 text-center bg-midnight/90">
          {/* Decorative stars */}
          <div className="text-[10px] text-desert-amber/40 tracking-[0.5em] mb-3 select-none crt-amber" style={{ fontSize: "8px" }}>
            {"\u00B7  \u2726  \u00B7    \u2726       \u00B7   \u2726  \u00B7    \u2726       \u00B7"}
          </div>
          <div className="text-[10px] text-desert-amber/30 tracking-[0.3em] mb-4 select-none" style={{ fontSize: "8px" }}>
            {"\u00B7       \u2726  \u00B7       \u00B7  \u2726       \u00B7       \u2726"}
          </div>

          {/* Title */}
          <div className="text-[18px] font-bold text-desert-amber crt-amber tracking-wider mb-1">
            HIGH DESERT
          </div>
          <div className="text-[11px] text-desktop-gray mb-3">
            Art Bell Radio Archive
          </div>

          {/* Separator */}
          <div className="w-48 h-[1px] bg-gradient-to-r from-transparent via-desert-amber/40 to-transparent mb-3" />

          {/* Version */}
          <div className="text-[10px] text-bevel-dark mb-4">
            v0.4.0 &middot; The Listening Experience
          </div>

          {/* Quote */}
          <div className="text-[10px] text-static-green/80 italic mb-4" style={{
            textShadow: "0 0 4px rgba(74, 222, 128, 0.3)",
          }}>
            &ldquo;From the Kingdom of Nye...&rdquo;
          </div>

          {/* Memorial */}
          <div className="flex flex-col items-center gap-1 mb-4">
            <div className="text-[10px] text-desert-amber/70">
              Art Bell
            </div>
            <div className="text-[9px] text-bevel-dark/80">
              1945 &ndash; 2018
            </div>
            <div className="text-[8px] text-bevel-dark/50 mt-0.5">
              Pahrump, Nevada &middot; Late Night Radio
            </div>
          </div>

          {/* Separator */}
          <div className="w-48 h-[1px] bg-gradient-to-r from-transparent via-bevel-dark/30 to-transparent mb-3" />

          {/* Tech info */}
          <div className="text-[8px] text-bevel-dark/40 mb-4">
            Next.js &middot; React &middot; Dexie &middot; Zustand &middot; archive.org
          </div>

          <Button onClick={handleCloseAbout}>OK</Button>
        </div>
      </Dialog>

      {/* Keyboard shortcuts dialog */}
      <Dialog
        open={shortcutsOpen}
        onClose={handleCloseShortcuts}
        title="Keyboard Shortcuts"
        width="320px"
      >
        <div className="p-4">
          <div className="flex flex-col gap-1.5">
            {SHORTCUTS.map(({ keys, action }) => (
              <div key={keys} className="flex items-center justify-between gap-3">
                <span className="text-[10px] text-desktop-gray">{action}</span>
                <span className="text-[9px] text-desert-amber bg-desert-amber/10 px-1.5 py-0.5 tabular-nums flex-shrink-0">
                  {keys}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={handleCloseShortcuts}>OK</Button>
          </div>
        </div>
      </Dialog>

      {/* Clear library confirmation */}
      <Dialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear Library"
        width="320px"
      >
        <div className="p-4 flex flex-col gap-4">
          <div className="text-[11px] text-desktop-gray">
            Remove all episodes and scan sessions from the library? This cannot be undone.
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setClearOpen(false)}>Cancel</Button>
            <Button variant="dark" onClick={handleClearLibrary} disabled={clearing}>
              {clearing ? "Clearing..." : "Clear"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Clear audio cache confirmation */}
      <Dialog
        open={clearCacheOpen}
        onClose={() => setClearCacheOpen(false)}
        title="Clear Audio Cache"
        width="320px"
      >
        <div className="p-4 flex flex-col gap-4">
          <div className="text-[11px] text-desktop-gray">
            Remove all cached audio files from local storage?
            {cacheSize != null && (
              <span className="block mt-1 text-bevel-dark">
                Cache size: {(cacheSize / 1024 / 1024).toFixed(1)} MB
              </span>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setClearCacheOpen(false)}>Cancel</Button>
            <Button variant="dark" onClick={handleClearCache} disabled={clearingCache}>
              {clearingCache ? "Clearing..." : "Clear Cache"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
