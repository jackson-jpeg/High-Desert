"use client";

import { cn } from "@/lib/utils/cn";
import dynamic from "next/dynamic";
import { MenuBar } from "@/components/win98";
import { ContextMenu } from "@/components/win98/ContextMenu";
import { Toaster } from "@/components/ui/Toaster";
import { PageTransition } from "@/components/PageTransition";
import { Starfield } from "./Starfield";
import { StatusBar } from "./StatusBar";
import { AdminPromptDialog } from "./AdminPromptDialog";
import type { EasterEgg } from "./EasterEggOverlays";

/*
 * Modals, the command palette and the easter eggs are pulled out of the shell
 * chunk. They were all statically imported, so ~1,200 lines a visitor may never
 * open — including 401 lines of easter-egg content reachable only by secret
 * input — had to download and parse before the library could render.
 *
 * ssr:false throughout: every one is gated on client state, so there is nothing
 * to server-render, and no loading fallback because each is invisible until
 * some interaction opens it.
 */
const AboutDialog = dynamic(
  () => import("./AboutDialog").then((m) => m.AboutDialog),
  { ssr: false },
);
const ShortcutsDialog = dynamic(
  () => import("./ShortcutsDialog").then((m) => m.ShortcutsDialog),
  { ssr: false },
);
const ClearLibraryDialog = dynamic(
  () => import("./ClearLibraryDialog").then((m) => m.ClearLibraryDialog),
  { ssr: false },
);
const ClearCacheDialog = dynamic(
  () => import("./ClearCacheDialog").then((m) => m.ClearCacheDialog),
  { ssr: false },
);
const ImportDataDialog = dynamic(
  () => import("./ImportDataDialog").then((m) => m.ImportDataDialog),
  { ssr: false },
);
const CommandPalette = dynamic(
  () => import("@/components/CommandPalette").then((m) => m.CommandPalette),
  { ssr: false },
);
const EasterEggOverlays = dynamic(
  () => import("./EasterEggOverlays").then((m) => m.EasterEggOverlays),
  { ssr: false },
);
import { useKonamiCode } from "@/hooks/useKonamiCode";
import { useRouter, usePathname } from "next/navigation";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { useAdminStore } from "@/stores/admin-store";
import { toast } from "@/stores/toast-store";
import { db, getPreference, setPreference } from "@/db";
import { MobileMenuSheet } from "@/components/mobile/MobileMenuSheet";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { useLiveQuery } from "dexie-react-hooks";
import { usePresence } from "@/hooks/usePresence";
import { presenceAttrs } from "@/services/stats/now-feed";
import { useShellMenus } from "@/hooks/useShellMenus";
import { useTextScalePreference } from "@/hooks/useTextScalePreference";
import { useUserDataTransfer } from "@/hooks/useUserDataTransfer";
import { useHdEvent } from "@/lib/events";

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
  const { textScale, setTextScale, cycleTextScale } = useTextScalePreference();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // No timer-driven state in the shell. The clock and the caller rotation live in <StatusBar>.

  // Ctrl/Cmd+K lives here rather than inside CommandPalette, so the palette's
  // chunk is only fetched the first time someone actually opens it.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  // Announces this tab and reports who else is here. The shell is mounted on
  // every route, so this is the one place the heartbeat needs to live.
  const presence = usePresence();

  // Easter eggs — local React state (no store needed)
  const [activeEgg, setActiveEgg] = useState<EasterEgg>(null);
  const [ghostToGhostMode, setGhostToGhostMode] = useState(false);
  const dismissEgg = useCallback(() => setActiveEgg(null), []);
  useKonamiCode(useCallback(() => setActiveEgg("konamiCode"), []));

  // Easter egg: triple-click title → Kingdom of Nye intro
  const titleClickRef = useRef<{ count: number; timer: ReturnType<typeof setTimeout> | undefined }>({ count: 0, timer: undefined });
  const handleTitleClick = useCallback(() => {
    const r = titleClickRef.current;
    r.count++;
    clearTimeout(r.timer);
    if (r.count >= 3) {
      r.count = 0;
      setActiveEgg("kingdomOfNye");
    } else {
      r.timer = setTimeout(() => { r.count = 0; }, 500);
    }
  }, []);
  const navRef = useRef<HTMLElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const [bottomPadding, setBottomPadding] = useState(112); // fallback

  // PWA install prompt
  useEffect(() => {
    const handler = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
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

  // Easter egg triggers from search bar + keyboard shortcuts
  useHdEvent("easter-egg", (egg) => {
    if (egg) setActiveEgg(egg);
  });

  // Drives the nav tab's now-playing dot. The status bar selects its own.
  const isPlaying = usePlayerStore((s) => s.playing);

  // Show counts for AboutDialog
  const showCounts = useLiveQuery(async () => {
    const coastToCoast = await db.episodes.where("showType").equals("coast").count();
    const dreamland = await db.episodes.where("showType").equals("dreamland").count();
    const total = await db.episodes.count();
    return { coastToCoast, dreamland, specials: total - coastToCoast - dreamland };
  }, []);

  const handleAbout = useCallback(() => setAboutOpen(true), []);
  const handleCloseAbout = useCallback(() => setAboutOpen(false), []);
  const handleShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const handleCloseShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const handleClearLibrary = useCallback(() => setClearOpen(true), []);
  const handleClearCache = useCallback(() => setClearCacheOpen(true), []);

  // Listen for ? key to toggle shortcuts
  useHdEvent("toggle-shortcuts", () => setShortcutsOpen((prev) => !prev));

  // File > Export / Import My Data, and the mobile sheet's copies (HD-010).
  const userData = useUserDataTransfer();

  const menus = useShellMenus({
    onAbout: handleAbout,
    onShortcuts: handleShortcuts,
    onClearLibrary: handleClearLibrary,
    onClearCache: handleClearCache,
    startupSoundOn,
    onToggleStartupSound: handleToggleStartupSound,
    textScale,
    onSetTextScale: setTextScale,
    onInstall: installPrompt ? handleInstall : undefined,
    onExportData: userData.exportData,
    onImportData: userData.importData,
  });

  return (
    <div
      className={cn(
        "flex flex-col h-screen w-screen h-dvh w-dvw overflow-hidden relative",
        className,
      )}
    >
      {/* Offline/online banner */}
      <OfflineIndicator />

      {/* Desert night sky */}
      <Starfield />

      {/* Skip link — first tab stop, so keyboard users aren't forced through
          the menu bar and every nav tab to reach the episode list. */}
      <a
        href="#hd-main"
        className={cn(
          "sr-only focus:not-sr-only",
          "focus:fixed focus:top-2 focus:left-2 focus:z-[200]",
          "focus:w98-raised-dark focus:bg-raised-surface",
          "focus:px-3 focus:py-2 focus:text-hd-12 focus:text-desktop-gray",
        )}
      >
        Skip to episode list
      </a>

      {/* Top menu bar — desktop only */}
      <header>
        <MenuBar
          menus={menus}
          variant="dark"
          className="flex-shrink-0 relative z-40 hidden md:flex"
          title={ghostToGhostMode ? "Ghost to Ghost AM" : undefined}
          onTitleClick={handleTitleClick}
        />
      </header>

      {/* Navigation tabs — desktop: top horizontal, mobile: bottom tab bar */}
      <nav
        ref={navRef}
        className={cn(
          // Mobile: fixed bottom tab bar with glass
          "fixed bottom-0 inset-x-0 z-30 glass-light glass-promote",
          "flex items-stretch justify-around",
          "pb-[var(--safe-bottom)] pl-[var(--safe-left)] pr-[var(--safe-right)]",
          // Desktop: static top nav
          "md:static md:justify-start md:gap-0 md:border-t-0 md:border-b md:border-bevel-dark/15 md:px-2 md:bg-midnight/80 md:backdrop-blur-xs md:pb-0",
        )}
      >
        {NAV_ITEMS.filter(({ path }) => isAdmin || (path !== "/scanner" && path !== "/search")).map(({ label, path }) => {
          const isActive = pathname === path;
          const showNowPlaying = path === "/library" && isPlaying && !isActive;
          // A live count on the tab is the whole discovery mechanism for the
          // community pages — the status bar indicator is desktop-only and
          // easy to miss, and nobody opens a statistics page speculatively.
          // Only shown when someone else is here too: a badge that reads "1"
          // because you are looking at it is noise. It shows the same number
          // as every other presence surface — it used to show online − 1,
          // which put a 7 on the tab next to an 8 in the status bar.
          const showPresence = path === "/stats" && presence.online > 1 && !isActive;
          return (
            <button
              key={path}
              onClick={() => router.push(path)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "w98-font cursor-pointer select-none transition-colors-fast relative",
                "flex flex-col items-center justify-center min-h-[52px] flex-1 text-hd-13 gap-1",
                "md:flex-row md:flex-none md:min-h-0 md:px-3 md:py-1.5 md:text-hd-11 md:gap-0",
                isActive
                  ? "text-desktop-gray md:border-b-2 md:border-b-desert-amber"
                  : "text-bevel-dark active:text-desktop-gray md:hover:text-desktop-gray md:border-b-2 md:border-b-transparent",
              )}
            >
              {label}
              {/* Mobile: amber dot indicator for active tab */}
              {isActive && (
                <span className="w-[4px] h-[4px] rounded-full bg-desert-amber md:hidden" />
              )}
              {showNowPlaying && (
                <span className="absolute top-2 right-[calc(50%-18px)] md:-top-0.5 md:right-auto md:left-1/2 w-[5px] h-[5px] rounded-full bg-red-500 animate-on-air" />
              )}
              {showPresence && (
                <span
                  className="absolute top-1.5 right-[calc(50%-26px)] md:top-0.5 md:right-1 flex items-center gap-[3px] text-hd-micro text-static-green tabular-nums pointer-events-none"
                  title={`${presence.online} people online right now`}
                  {...presenceAttrs("badge", presence)}
                >
                  <span className="w-[5px] h-[5px] rounded-full bg-static-green animate-on-air" />
                  {presence.online}
                </span>
              )}
            </button>
          );
        })}
        {/* Mobile-only more tab */}
        <button
          onClick={() => setMobileMenuOpen(true)}
          className={cn(
            "w98-font cursor-pointer select-none transition-colors-fast",
            "flex flex-col items-center justify-center min-h-[52px] flex-1 text-hd-13 gap-1",
            "text-bevel-dark active:text-desktop-gray",
            "md:hidden",
          )}
          aria-label="More options"
        >
          More
        </button>
      </nav>

      {/* Main content area — padded on mobile to clear fixed player + tab bar */}
      {/* `relative` without a z-index on purpose. `z-10` here made <main> a
          stacking context, which capped everything inside it below the player
          (z-20) and the tab bar (z-30) — so the library's z-50 bottom sheets
          painted *underneath* them and the bottom ~120px of every episode
          detail (Delete/Edit/Flag, More Like This) was unreachable on mobile.
          With z-auto, main still paints above the Starfield (which precedes it
          in DOM order and is also z-auto), the player and nav still sit above
          the page content via their explicit z-indices, and the sheets can
          finally rise above both. */}
      <main
        id="hd-main"
        tabIndex={-1}
        className="flex-1 overflow-hidden relative md:pb-0"
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
        <StatusBar episodeCount={episodeCount} presence={presence} />
      </footer>

      {/* Global context menu */}
      <ContextMenu />

      {/* Toast notifications */}
      <Toaster />

      {/* Each is gated on its own open state, not merely lazily imported: these
          components render null when closed, so mounting them unconditionally
          would fetch every chunk on load and defeat the split entirely. */}
      {aboutOpen && (
        <AboutDialog open onClose={handleCloseAbout} isAdmin={isAdmin} episodeCount={episodeCount} showCounts={showCounts} />
      )}
      {shortcutsOpen && (
        <ShortcutsDialog open onClose={handleCloseShortcuts} isAdmin={isAdmin} />
      )}
      {clearOpen && <ClearLibraryDialog open onClose={() => setClearOpen(false)} />}
      {clearCacheOpen && <ClearCacheDialog open onClose={() => setClearCacheOpen(false)} />}
      {userData.pending && (
        <ImportDataDialog
          fileName={userData.pending.fileName}
          summary={userData.pending.summary}
          importing={userData.importing}
          onConfirm={userData.confirmImport}
          onClose={userData.cancelImport}
        />
      )}

      {/* Command palette (Ctrl+K / Cmd+K) */}
      {paletteOpen && <CommandPalette open onClose={() => setPaletteOpen(false)} />}

      {/* Admin password dialog — opened by the "admin-prompt" event */}
      <AdminPromptDialog />

      {/* Easter egg overlays — 401 lines reachable only by secret input, so
          the chunk is fetched at the moment one actually triggers. */}
      {activeEgg && (
        <EasterEggOverlays active={activeEgg} onDismiss={dismissEgg} onGhostToggle={() => setGhostToGhostMode((g) => !g)} />
      )}

      {/* Mobile menu sheet */}
      <MobileMenuSheet
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        isAdmin={isAdmin}
        onAbout={handleAbout}
        startupSoundOn={startupSoundOn}
        onToggleStartupSound={handleToggleStartupSound}
        presence={presence}
        textScale={textScale}
        onCycleTextScale={cycleTextScale}
        onExportData={userData.exportData}
        onImportData={userData.importData}
      />
    </div>
  );
}
