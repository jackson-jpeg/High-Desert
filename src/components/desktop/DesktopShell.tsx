"use client";

import { cn } from "@/lib/utils/cn";
import { MenuBar, StatusBar, Dialog, Button } from "@/components/win98";
import { ContextMenu } from "@/components/win98/ContextMenu";
import type { Menu } from "@/components/win98";
import { useRouter, usePathname } from "next/navigation";
import { ReactNode, useCallback, useState } from "react";
import { db } from "@/lib/db";
import { clearAudioCache, getCacheSize } from "@/lib/audio/cache";

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

  return (
    <div
      className={cn(
        "flex flex-col h-screen w-screen bg-midnight overflow-hidden",
        className,
      )}
    >
      {/* Top menu bar */}
      <MenuBar menus={menus} variant="dark" className="flex-shrink-0" />

      {/* Navigation tabs */}
      <nav className="flex-shrink-0 flex items-center gap-0 bg-midnight border-b border-bevel-dark/20 px-2">
        {NAV_ITEMS.map(({ label, path }) => {
          const isActive = pathname === path;
          return (
            <button
              key={path}
              onClick={() => router.push(path)}
              className={cn(
                "w98-font text-[10px] px-3 py-1.5 cursor-pointer select-none transition-colors-fast",
                isActive
                  ? "text-desktop-gray border-b border-desert-amber"
                  : "text-bevel-dark hover:text-desktop-gray border-b border-transparent",
              )}
            >
              {label}
            </button>
          );
        })}
      </nav>

      {/* Main content area */}
      <main className="flex-1 overflow-auto">{children}</main>

      {/* Mini player slot */}
      {player && <div className="flex-shrink-0">{player}</div>}

      {/* Bottom status bar */}
      <StatusBar
        variant="dark"
        panels={[
          { content: "Ready", flex: 1 },
          { content: `${episodeCount} episode${episodeCount !== 1 ? "s" : ""}`, width: "140px" },
        ]}
        className="flex-shrink-0"
      />

      {/* Global context menu */}
      <ContextMenu />

      {/* About dialog */}
      <Dialog
        open={aboutOpen}
        onClose={handleCloseAbout}
        title="About High Desert"
        width="360px"
      >
        <div className="flex flex-col items-center gap-4 p-4 text-center">
          <div className="text-lg font-bold text-desert-amber">
            High Desert
          </div>
          <div className="text-sm text-desktop-gray">
            Art Bell Radio Archive
          </div>
          <div className="text-xs text-bevel-dark">
            v0.4.0 &mdash; The Listening Experience
          </div>
          <Button onClick={handleCloseAbout}>OK</Button>
        </div>
      </Dialog>

      {/* Keyboard shortcuts dialog */}
      <Dialog
        open={shortcutsOpen}
        onClose={handleCloseShortcuts}
        title="Keyboard Shortcuts"
        width="300px"
      >
        <div className="p-4">
          <div className="flex flex-col gap-2">
            {SHORTCUTS.map(({ keys, action }) => (
              <div key={keys} className="flex items-center justify-between">
                <span className="text-[11px] text-desktop-gray">{action}</span>
                <span className="text-[10px] text-desert-amber bg-desert-amber/10 px-1.5 py-0.5 tabular-nums">
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
