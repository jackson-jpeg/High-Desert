"use client";

import { cn } from "@/lib/utils/cn";
import { MenuBar, StatusBar, Button, Dialog, TextField } from "@/components/win98";
import { AboutDialog } from "./AboutDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { ClearLibraryDialog } from "./ClearLibraryDialog";
import { ClearCacheDialog } from "./ClearCacheDialog";
import { ContextMenu } from "@/components/win98/ContextMenu";
import { Toaster } from "@/components/ui/Toaster";
import { CommandPalette } from "@/components/CommandPalette";
import { PageTransition } from "@/components/PageTransition";
import { Starfield } from "./Starfield";
import type { Menu } from "@/components/win98";
import { useRouter, usePathname } from "next/navigation";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";


import { usePlayerStore } from "@/stores/player-store";
import { useAdminStore } from "@/stores/admin-store";
import { toast } from "@/stores/toast-store";
import { db, getPreference, setPreference } from "@/db";
import { deduplicateEpisodes } from "@/db/deduplicate";
import { useCatalogScraper } from "@/hooks/useCatalogScraper";
import { exportLibrarySeed } from "@/db/seed";
import { MobileMenuSheet } from "@/components/mobile/MobileMenuSheet";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { useLiveQuery } from "dexie-react-hooks";

const CALLER_MESSAGES = [
  "East of the Rockies, you\u2019re on the air...",
  "West of the Rockies, first-time caller...",
  "From the Kingdom of Nye, Nevada...",
  "The wildcard line is open...",
  "Somewhere in the night...",
  "The desert is listening...",
  "Coast to Coast, you\u2019re on the air...",
  "From the high desert...",
];


interface DesktopShellProps {
  children: ReactNode;
  player?: ReactNode;
  episodeCount?: number;
  className?: string;
}

const NAV_ITEMS = [
  { label: "Library", path: "/library" },
  { label: "Radio", path: "/radio" },
  { label: "Scanner", path: "/scanner" },
  { label: "Search", path: "/search" },
  { label: "Stats", path: "/stats" },
] as const;

export function DesktopShell({ children, player, episodeCount = 0, className }: DesktopShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [startupSoundOn, setStartupSoundOn] = useState(true);
  const [clock, setClock] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [callerIdx, setCallerIdx] = useState(0);
  const [callerFade, setCallerFade] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const [bottomPadding, setBottomPadding] = useState(112); // fallback

  // PWA install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!installPrompt) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (installPrompt as any).prompt();
    setInstallPrompt(null);
  }, [installPrompt]);

  // Load startup sound preference
  useEffect(() => {
    getPreference("startup-sound").then((v) => {
      if (v === "off") setStartupSoundOn(false);
    });
  }, []);

  const handleToggleStartupSound = useCallback(async () => {
    const next = !startupSoundOn;
    setStartupSoundOn(next);
    await setPreference("startup-sound", next ? "on" : "off");
    toast.info(next ? "Startup sound enabled" : "Startup sound disabled");
  }, [startupSoundOn]);

  // Measure actual nav + player height
  useEffect(() => {
    const measure = () => {
      const navH = navRef.current?.offsetHeight ?? 56;
      const playerH = playerRef.current?.offsetHeight ?? 56;
      setBottomPadding(navH + playerH);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (navRef.current) ro.observe(navRef.current);
    if (playerRef.current) ro.observe(playerRef.current);
    return () => ro.disconnect();
  }, []);

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

  // Randomize initial caller message on client only (avoids hydration mismatch)
  useEffect(() => {
    setCallerIdx(Math.floor(Math.random() * CALLER_MESSAGES.length)); // eslint-disable-line react-hooks/set-state-in-effect -- hydration-safe: 0 on SSR, randomized on client
  }, []);

  // Rotating caller line messages (every 30s)
  useEffect(() => {
    const id = setInterval(() => {
      setCallerFade(false);
      setTimeout(() => {
        setCallerIdx((prev) => (prev + 1) % CALLER_MESSAGES.length);
        setCallerFade(true);
      }, 500);
    }, 30000);
    return () => clearInterval(id);
  }, []);

  // Ghost to Ghost easter egg: detect Halloween season (Oct 28 - Nov 2)
  const [isHalloweenSeason, setIsHalloweenSeason] = useState(false);
  useEffect(() => {
    const now = new Date();
    const m = now.getMonth(); // 0-indexed
    const d = now.getDate();
    setIsHalloweenSeason((m === 9 && d >= 28) || (m === 10 && d <= 2)); // eslint-disable-line react-hooks/set-state-in-effect -- hydration-safe: false on SSR, computed on client
  }, []);

  // Show counts for AboutDialog
  const showCounts = useLiveQuery(async () => {
    const coastToCoast = await db.episodes.where("showType").equals("coast-to-coast").count();
    const dreamland = await db.episodes.where("showType").equals("dreamland").count();
    const total = await db.episodes.count();
    return { coastToCoast, dreamland, specials: total - coastToCoast - dreamland };
  }, []);

  const handleAbout = useCallback(() => setAboutOpen(true), []);
  const handleCloseAbout = useCallback(() => setAboutOpen(false), []);
  const handleShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const handleCloseShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const [adminPromptOpen, setAdminPromptOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState(false);

  const handleToggleAdmin = useCallback(() => {
    if (useAdminStore.getState().isAdmin) {
      useAdminStore.getState().logout();
      toast.info("Admin mode disabled");
    } else {
      setAdminPassword("");
      setAdminError(false);
      setAdminPromptOpen(true);
    }
  }, []);

  const handleAdminLogin = async () => {
    const pw = adminPassword;
    // Hash and verify inline to avoid any closure/async issues with store
    const encoder = new TextEncoder();
    const data = encoder.encode(pw);
    const buffer = await crypto.subtle.digest("SHA-256", data);
    const hash = Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const EXPECTED = "7740185e7b5e8ec29b31a918cd2b8d0d491c864072ed360e48999355974280d4";
    if (hash === EXPECTED) {
      try { localStorage.setItem("hd-admin", "1"); } catch {}
      useAdminStore.setState({ isAdmin: true });
      setAdminPromptOpen(false);
      setAdminPassword("");
      setAdminError(false);
      toast.info("Admin mode enabled");
    } else {
      setAdminError(true);
    }
  };

  // Listen for ? key to toggle shortcuts
  useEffect(() => {
    const handler = () => setShortcutsOpen((prev) => !prev);
    window.addEventListener("hd:toggle-shortcuts", handler);
    return () => window.removeEventListener("hd:toggle-shortcuts", handler);
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
        { label: "Radio Dial", onClick: () => router.push("/radio") },
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
            {
              label: "Deduplicate Library...",
              onClick: async () => {
                const result = await deduplicateEpisodes();
                if (result.duplicatesRemoved > 0) {
                  toast.success(`Removed ${result.duplicatesRemoved} duplicate${result.duplicatesRemoved !== 1 ? "s" : ""} from ${result.groupsMerged} group${result.groupsMerged !== 1 ? "s" : ""}`);
                } else {
                  toast.info("No duplicates found");
                }
              },
            },
            { separator: true as const, label: "" },
            { label: "Clear Audio Cache...", onClick: () => setClearCacheOpen(true) },
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
          label: startupSoundOn ? "Startup Sound ✓" : "Startup Sound",
          onClick: handleToggleStartupSound,
        },
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

  // Ghost to Ghost badge click handler
  const handleGhostClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent("hd:search", { detail: "ghost to ghost" }));
  }, []);

  // Status bar now-playing content
  const statusContent = (() => {
    if (!hasEpisode) return (
      <span
        className="transition-opacity duration-500"
        style={{ opacity: callerFade ? 1 : 0 }}
      >
        {CALLER_MESSAGES[callerIdx]}
      </span>
    );
    const icon = isPlaying ? "\u25B6" : "\u275A\u275A";
    const parts = [nowPlayingTitle];
    if (nowPlayingGuest) parts.push(nowPlayingGuest);
    return (
      <button
        onClick={handleStatusClick}
        onDoubleClick={() => window.dispatchEvent(new CustomEvent("hd:toggle-ultra-mini"))}
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
      {/* Offline/online banner */}
      <OfflineIndicator />

      {/* Desert night sky */}
      <Starfield />

      {/* Top menu bar — desktop only */}
      <header>
        <MenuBar menus={menus} variant="dark" className="flex-shrink-0 relative z-40 hidden md:flex" />
      </header>

      {/* Navigation tabs — desktop: top horizontal, mobile: bottom tab bar */}
      <nav
        ref={navRef}
        className={cn(
          // Mobile: fixed bottom tab bar with glass
          "fixed bottom-0 inset-x-0 z-30 glass-light glass-promote",
          "flex items-stretch justify-around",
          "pb-[var(--safe-bottom)]",
          // Desktop: static top nav
          "md:static md:justify-start md:gap-0 md:border-t-0 md:border-b md:border-bevel-dark/15 md:px-2 md:bg-midnight/80 md:backdrop-blur-xs md:pb-0",
        )}
      >
        {NAV_ITEMS.filter(({ path }) => isAdmin || (path !== "/scanner" && path !== "/search")).map(({ label, path }) => {
          const isActive = pathname === path;
          const showNowPlaying = path === "/library" && isPlaying && !isActive;
          return (
            <button
              key={path}
              onClick={() => router.push(path)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "w98-font cursor-pointer select-none transition-colors-fast relative",
                "flex items-center justify-center min-h-[48px] flex-1 text-[12px]",
                "md:flex-none md:min-h-0 md:px-3 md:py-1.5 md:text-[10px]",
                isActive
                  ? "text-desktop-gray border-t-2 border-t-desert-amber md:border-t-0 md:border-b-2 md:border-b-desert-amber"
                  : "text-bevel-dark active:text-desktop-gray md:hover:text-desktop-gray border-t-2 border-t-transparent md:border-t-0 md:border-b-2 md:border-b-transparent",
              )}
            >
              {label}
              {showNowPlaying && (
                <span className="absolute top-1.5 right-[calc(50%-18px)] md:-top-0.5 md:right-auto md:left-1/2 w-[5px] h-[5px] rounded-full bg-red-500 animate-on-air" />
              )}
            </button>
          );
        })}
        {/* Mobile-only more tab */}
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
          More ▾
        </button>
      </nav>

      {/* Main content area — padded on mobile to clear fixed player + tab bar */}
      <main
        className="flex-1 overflow-auto relative z-10 md:pb-0"
        style={{ paddingBottom: `calc(${bottomPadding}px + var(--safe-bottom))` }}
      >
        <PageTransition>{children}</PageTransition>
      </main>

      {/* Mini player slot — mobile: fixed above tab bar; desktop: static */}
      {player && (
        <section aria-label="Audio player" ref={playerRef} className={cn(
          "fixed bottom-[calc(56px+var(--safe-bottom))] inset-x-0 z-20",
          "md:static md:flex-shrink-0 md:relative md:z-10",
        )}>
          {player}
        </section>
      )}

      {/* Bottom status bar — desktop only */}
      <footer>
      <StatusBar
        variant="dark"
        panels={[
          { content: statusContent, flex: 1 },
          ...(isHalloweenSeason ? [{
            content: (
              <button
                onClick={handleGhostClick}
                className="text-[9px] cursor-pointer hover:text-desert-amber transition-colors-fast"
                style={{ color: "#FF8C00" }}
                title="Ghost to Ghost AM Collection"
              >
                🎃 Ghost to Ghost
              </button>
            ),
            width: "110px",
          }] : []),
          ...(installPrompt ? [{
            content: (
              <button
                onClick={handleInstall}
                className="text-[9px] cursor-pointer hover:text-desert-amber transition-colors-fast text-static-green"
                title="Install High Desert as an app"
              >
                Install App
              </button>
            ),
            width: "72px",
          }] : []),
          { content: `${episodeCount.toLocaleString()} episode${episodeCount !== 1 ? "s" : ""}`, width: "120px" },
          { content: signalBars, width: "24px" },
          { content: clock, width: "72px" },
        ]}
        className="flex-shrink-0 relative z-10 hidden md:flex"
      />
      </footer>

      {/* Global context menu */}
      <ContextMenu />

      {/* Toast notifications */}
      <Toaster />

      <AboutDialog open={aboutOpen} onClose={handleCloseAbout} isAdmin={isAdmin} episodeCount={episodeCount} showCounts={showCounts} />
      <ShortcutsDialog open={shortcutsOpen} onClose={handleCloseShortcuts} isAdmin={isAdmin} />
      <ClearLibraryDialog open={clearOpen} onClose={() => setClearOpen(false)} />
      <ClearCacheDialog open={clearCacheOpen} onClose={() => setClearCacheOpen(false)} />

      {/* Command palette (Ctrl+K / Cmd+K) */}
      <CommandPalette />

      {/* Admin password dialog */}
      <Dialog open={adminPromptOpen} onClose={() => setAdminPromptOpen(false)} title="Admin Login" width="300px">
        <form
          onSubmit={async (e) => { e.preventDefault(); e.stopPropagation(); await handleAdminLogin(); }}
          className="p-4 flex flex-col gap-3"
        >
          <div className="text-[10px] text-desktop-gray">
            Enter the admin password to enable admin mode.
          </div>
          <TextField
            type="password"
            value={adminPassword}
            onChange={(e) => { setAdminPassword(e.target.value); setAdminError(false); }}
            placeholder="Password"
            autoFocus
            className="w-full"
          />
          {adminError && (
            <div className="text-[9px] text-red-400">
              Incorrect password.
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setAdminPromptOpen(false)}>Cancel</Button>
            <Button type="submit" variant="dark">Login</Button>
          </div>
        </form>
      </Dialog>

      {/* Mobile menu sheet */}
      <MobileMenuSheet
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        isAdmin={isAdmin}
        onToggleAdmin={handleToggleAdmin}
        onAbout={handleAbout}
        startupSoundOn={startupSoundOn}
        onToggleStartupSound={handleToggleStartupSound}
      />
    </div>
  );
}
