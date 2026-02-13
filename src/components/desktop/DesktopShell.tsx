"use client";

import { cn } from "@/lib/utils/cn";
import { MenuBar, StatusBar, Dialog, Button } from "@/components/win98";
import { ContextMenu } from "@/components/win98/ContextMenu";
import { Toaster } from "@/components/ui/Toaster";
import { Starfield } from "./Starfield";
import type { Menu } from "@/components/win98";
import { useRouter, usePathname } from "next/navigation";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { useAdminStore } from "@/stores/admin-store";
import { toast } from "@/stores/toast-store";
import { db } from "@/lib/db";
import { clearAudioCache, getCacheSize } from "@/lib/audio/cache";
import { useCatalogScraper } from "@/hooks/useCatalogScraper";
import { exportLibrarySeed } from "@/lib/db/seed";
import { MobileMenuSheet } from "@/components/mobile/MobileMenuSheet";


interface DesktopShellProps {
  children: ReactNode;
  player?: ReactNode;
  episodeCount?: number;
  className?: string;
}

const NAV_ITEMS = [
  { label: "Library", path: "/library" },
  { label: "Scanner", path: "/scanner" },
  { label: "Search", path: "/search" },
  { label: "Stats", path: "/stats" },
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
  { keys: "?", action: "Show this dialog" },
];

export function DesktopShell({ children, player, episodeCount = 0, className }: DesktopShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [clock, setClock] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // AI categorization (runs in-place, no navigation needed)
  const { categorizeOnly, phase: scraperPhase } = useCatalogScraper();

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
  const handleToggleAdmin = useCallback(() => {
    const next = !useAdminStore.getState().isAdmin;
    useAdminStore.getState().setAdmin(next);
    toast.info(next ? "Admin mode enabled" : "Admin mode disabled");
  }, []);

  // Listen for ? key to toggle shortcuts
  useEffect(() => {
    const handler = () => setShortcutsOpen((prev) => !prev);
    window.addEventListener("hd:toggle-shortcuts", handler);
    return () => window.removeEventListener("hd:toggle-shortcuts", handler);
  }, []);

  const handleClearLibrary = useCallback(async () => {
    setClearing(true);
    try {
      await db.episodes.clear();
      await db.scanSessions.clear();
      toast.success("Library cleared");
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
      toast.success("Audio cache cleared");
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
    toast.success(`Exported ${episodes.length} episodes`);
  }, []);

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        ...(isAdmin
          ? [{ label: "Open Folder...", shortcut: "Ctrl+O", onClick: () => router.push("/scanner") },
             { separator: true as const, label: "" }]
          : []),
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
        { label: "Surprise Me \u2014 Shuffle All", onClick: () => window.dispatchEvent(new CustomEvent("hd:shuffle", { detail: "all" })) },
        { label: "Shuffle Coast to Coast", onClick: () => window.dispatchEvent(new CustomEvent("hd:shuffle", { detail: "coast" })) },
        { label: "Shuffle Dreamland", onClick: () => window.dispatchEvent(new CustomEvent("hd:shuffle", { detail: "dreamland" })) },
        { separator: true, label: "" },
        { label: "Statistics", onClick: () => router.push("/stats") },
      ],
    },
    ...(isAdmin
      ? [{
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
            { separator: true as const, label: "" },
            {
              label: scraperPhase === "categorizing" ? "Categorizing..." : "AI Categorize All...",
              onClick: categorizeOnly,
              disabled: scraperPhase === "categorizing" || scraperPhase === "scraping" || scraperPhase === "importing",
            },
            { separator: true as const, label: "" },
            { label: "Export Library...", onClick: handleExport },
            { label: "Export Library Seed...", onClick: exportLibrarySeed },
            { separator: true as const, label: "" },
            { label: "Clear Audio Cache...", onClick: handleOpenClearCache },
            { label: "Clear Library...", onClick: () => setClearOpen(true) },
          ],
        }]
      : []),
    {
      label: "Help",
      items: [
        { label: "Keyboard Shortcuts", onClick: handleShortcuts },
        { separator: true, label: "" },
        {
          label: isAdmin ? "Disable Admin Mode" : "Enable Admin Mode",
          onClick: handleToggleAdmin,
        },
        { separator: true, label: "" },
        { label: "About High Desert", onClick: handleAbout },
      ],
    },
  ];

  // Navigate to library and highlight the current episode when clicking status bar
  const handleStatusClick = useCallback(() => {
    if (!hasEpisode) return;
    if (pathname !== "/library") {
      router.push("/library");
    }
    // Dispatch event so the library page can scroll to the current episode
    window.dispatchEvent(new CustomEvent("hd:scroll-to-current"));
  }, [hasEpisode, pathname, router]);

  // Status bar now-playing content
  const statusContent = (() => {
    if (!hasEpisode) return "Ready";
    const icon = isPlaying ? "\u25B6" : "\u275A\u275A";
    const parts = [nowPlayingTitle];
    if (nowPlayingGuest) parts.push(nowPlayingGuest);
    return (
      <button
        onClick={handleStatusClick}
        className="flex items-center gap-1.5 cursor-pointer hover:text-desktop-gray transition-colors-fast text-left w-full"
      >
        {isPlaying && (
          <span className="inline-block w-[5px] h-[5px] rounded-full bg-red-500 animate-on-air flex-shrink-0" />
        )}
        <span className="text-bevel-dark">{icon}</span>
        <span className="truncate">{parts.join(" \u2014 ")}</span>
      </button>
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

      {/* Top menu bar — desktop only */}
      <MenuBar menus={menus} variant="dark" className="flex-shrink-0 relative z-40 hidden md:flex" />

      {/* Navigation tabs — desktop: top horizontal, mobile: bottom tab bar */}
      <nav
        className={cn(
          // Mobile: fixed bottom tab bar
          "fixed bottom-0 inset-x-0 z-30 bg-midnight/95 backdrop-blur-sm border-t border-bevel-dark/15",
          "flex items-stretch justify-around",
          "pb-[var(--safe-bottom)]",
          // Desktop: static top nav
          "md:static md:justify-start md:gap-0 md:border-t-0 md:border-b md:border-bevel-dark/15 md:px-2 md:bg-midnight/80 md:backdrop-blur-xs md:pb-0",
        )}
      >
        {NAV_ITEMS.filter(({ path }) => isAdmin || (path !== "/scanner" && path !== "/search")).map(({ label, path }) => {
          const isActive = pathname === path;
          return (
            <button
              key={path}
              onClick={() => router.push(path)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "w98-font cursor-pointer select-none transition-colors-fast",
                // Mobile: even tab bar items
                "flex items-center justify-center min-h-[48px] flex-1 text-[12px]",
                // Desktop: inline text tabs
                "md:flex-none md:min-h-0 md:px-3 md:py-1.5 md:text-[10px]",
                isActive
                  ? "text-desktop-gray border-t-2 border-t-desert-amber md:border-t-0 md:border-b-2 md:border-b-desert-amber"
                  : "text-bevel-dark active:text-desktop-gray md:hover:text-desktop-gray border-t-2 border-t-transparent md:border-t-0 md:border-b-2 md:border-b-transparent",
              )}
            >
              {label}
            </button>
          );
        })}
        {/* Mobile-only gear/settings tab */}
        <button
          onClick={() => setMobileMenuOpen(true)}
          className={cn(
            "w98-font cursor-pointer select-none transition-colors-fast",
            "flex items-center justify-center min-h-[48px] flex-1 text-[12px]",
            "text-bevel-dark active:text-desktop-gray border-t-2 border-t-transparent",
            "md:hidden",
          )}
          aria-label="More options"
        >
          {"\u2699"}
        </button>
      </nav>

      {/* Main content area — padded on mobile to clear fixed player + tab bar */}
      <main className="flex-1 overflow-auto relative z-10 pb-[calc(112px+var(--safe-bottom))] md:pb-0">
        {children}
      </main>

      {/* Mini player slot — mobile: fixed above tab bar; desktop: static */}
      {player && (
        <div className={cn(
          "fixed bottom-[calc(56px+var(--safe-bottom))] inset-x-0 z-20",
          "md:static md:flex-shrink-0 md:relative md:z-10",
        )}>
          {player}
        </div>
      )}

      {/* Bottom status bar — desktop only */}
      <StatusBar
        variant="dark"
        panels={[
          { content: statusContent, flex: 1 },
          { content: `${episodeCount.toLocaleString()} episode${episodeCount !== 1 ? "s" : ""}`, width: "120px" },
          { content: signalBars, width: "24px" },
          { content: clock, width: "72px" },
        ]}
        className="flex-shrink-0 relative z-10 hidden md:flex"
      />

      {/* Global context menu */}
      <ContextMenu />

      {/* Toast notifications */}
      <Toaster />

      {/* About dialog */}
      <Dialog
        open={aboutOpen}
        onClose={handleCloseAbout}
        title="About High Desert"
        width="400px"
      >
        <div className="flex flex-col items-center gap-0 p-6 text-center bg-midnight/90">
          {/* Title */}
          <div className="text-[18px] font-bold text-desert-amber crt-amber tracking-wider mb-1">
            HIGH DESERT
          </div>
          <div className="text-[11px] text-desktop-gray/80 mb-4">
            Art Bell Radio Archive
          </div>

          {/* Separator */}
          <div className="w-40 h-[1px] bg-gradient-to-r from-transparent via-desert-amber/30 to-transparent mb-4" />

          {/* Quote */}
          <div className="text-[10px] text-static-green/60 italic mb-5" style={{
            textShadow: "0 0 4px rgba(74, 222, 128, 0.2)",
          }}>
            &ldquo;From the Kingdom of Nye...&rdquo;
          </div>

          {/* Memorial */}
          <div className="flex flex-col items-center gap-0.5 mb-5">
            <div className="text-[10px] text-desert-amber/60">
              Art Bell
            </div>
            <div className="text-[9px] text-bevel-dark/60">
              1945 &ndash; 2018
            </div>
          </div>

          {/* Version */}
          <div className="text-[8px] text-bevel-dark/40 mb-5">
            v0.4.0{isAdmin ? " (Admin)" : ""}
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
          <div className="flex flex-col gap-1">
            {SHORTCUTS.filter(({ keys }) => isAdmin || keys !== "Delete").map(({ keys, action }) => (
              <div key={keys} className="flex items-center justify-between gap-3 py-0.5">
                <span className="text-[10px] text-desktop-gray/80">{action}</span>
                <span className="text-[9px] text-desert-amber/60 tabular-nums flex-shrink-0">
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

      {/* Mobile menu sheet */}
      <MobileMenuSheet
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        isAdmin={isAdmin}
        onToggleAdmin={handleToggleAdmin}
        onAbout={handleAbout}
      />

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
