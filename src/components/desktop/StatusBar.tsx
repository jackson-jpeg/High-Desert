"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { cn } from "@/lib/utils/cn";
import { StatusBar as Win98StatusBar } from "@/components/win98";
import { usePlayerStore } from "@/stores/player-store";
import { db } from "@/db";
import { computeStreak } from "@/lib/utils/streak";
import { presenceAttrs, type LivePresence } from "@/services/stats/now-feed";
import { MirrorBadge } from "@/components/player/MirrorBadge";
import { emit, useHdEvent } from "@/lib/events";
import { useOpenLibraryIntent } from "@/hooks/useOpenLibraryIntent";

export const CALLER_MESSAGES = [
  "East of the Rockies, you’re on the air...",
  "West of the Rockies, first-time caller...",
  "From the Kingdom of Nye, Nevada...",
  "The wildcard line is open...",
  "Somewhere in the night...",
  "The desert is listening...",
  "Coast to Coast, you’re on the air...",
  "From the high desert...",
  "What’s on your mind tonight?",
  "Open lines, area code first...",
  "The bumper music plays on...",
  "You’re in the first half...",
  "We’ll be right back after this...",
  "From the Great American Southwest...",
  "The phone lines are lit up...",
  "You’re on the wild card line...",
];

/** How often the clock re-reads the time and the caller line rotates. */
export const STATUS_TICK_MS = 30_000;

/** "10:05 PM" — the status bar clock's format. */
export function formatClock(now: Date): string {
  const h = now.getHours() % 12 || 12;
  const m = String(now.getMinutes()).padStart(2, "0");
  const period = now.getHours() >= 12 ? "PM" : "AM";
  return `${h}:${m} ${period}`;
}

interface StatusBarProps {
  episodeCount: number;
  presence: LivePresence;
}

/**
 * The desktop status bar: now playing (or the rotating caller line), the
 * Ghost to Ghost badge, streak, presence, episode count, signal and clock.
 *
 * It owns the two 30-second intervals — the clock and the caller rotation —
 * and the `hd:status-message` flash. HD-018: when those lived in DesktopShell,
 * every tick re-rendered the shell, which rebuilt all four menus and every nav
 * tab to change five characters in a corner. Keep any timer-driven state here;
 * `shell-render-pressure.test.tsx` holds it.
 */
export function StatusBar({ episodeCount, presence }: StatusBarProps) {
  const router = useRouter();
  const [clock, setClock] = useState("");
  const [callerIdx, setCallerIdx] = useState(0);
  const [callerFade, setCallerFade] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const actionTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const nowPlayingTitle = usePlayerStore((s) => s.currentEpisode?.title ?? s.currentEpisode?.fileName);
  const nowPlayingGuest = usePlayerStore((s) => s.currentEpisode?.guestName);
  const isPlaying = usePlayerStore((s) => s.playing);
  const hasEpisode = usePlayerStore((s) => !!s.currentEpisode);

  // Clock tick
  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()));
    tick();
    const id = setInterval(tick, STATUS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Randomize initial caller message on client only (avoids hydration mismatch)
  useEffect(() => {
    // The lint rule never saw this while it sat in DesktopShell (the compiler
    // bailed on that component); moved unchanged, it now does.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe: 0 on SSR, random on client
    setCallerIdx(Math.floor(Math.random() * CALLER_MESSAGES.length));
  }, []);

  // Rotating caller line messages (every 30s)
  useEffect(() => {
    const id = setInterval(() => {
      setCallerFade(false);
      setTimeout(() => {
        setCallerIdx((prev) => (prev + 1) % CALLER_MESSAGES.length);
        setCallerFade(true);
      }, 500);
    }, STATUS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Status bar action messages — show briefly then fade back to flavor text
  useHdEvent("status-message", (msg) => {
    if (!msg) return;
    clearTimeout(actionTimeoutRef.current);
    setActionMessage(msg);
    actionTimeoutRef.current = setTimeout(() => setActionMessage(null), 4000);
  });
  useEffect(() => () => clearTimeout(actionTimeoutRef.current), []);

  // Listening streak. Only the last year of history can affect it, so bound the
  // read by time rather than by row count (the old .limit(500) could disagree
  // with the same figure shown on the stats page).
  const streak = useLiveQuery(async () => {
    const cutoff = Date.now() - 366 * 86_400_000;
    const entries = await db.history.where("timestamp").above(cutoff).toArray();
    return computeStreak(entries);
  }, []);

  // Ghost to Ghost easter egg: detect Halloween season (Oct 28 - Nov 2)
  const [isHalloweenSeason, setIsHalloweenSeason] = useState(false);
  useEffect(() => {
    const now = new Date();
    const m = now.getMonth(); // 0-indexed
    const d = now.getDate();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe: false on SSR, computed once on client
    setIsHalloweenSeason((m === 9 && d >= 28) || (m === 10 && d <= 2));
  }, []);

  // The now-playing text and the Ghost to Ghost badge both ask the library for
  // something. They used to navigate and then fire a window event — the first
  // into a page that had not mounted yet ("Now playing" did nothing from
  // /stats), the second after a 150 ms guess. A URL intent arrives with the
  // page instead (HD-013).
  const openLibrary = useOpenLibraryIntent();
  const handleStatusClick = useCallback(() => {
    if (!hasEpisode) return;
    openLibrary({ scroll: "current" });
  }, [hasEpisode, openLibrary]);

  const handleGhostClick = useCallback(() => openLibrary({ q: "ghost to ghost" }), [openLibrary]);

  // Status bar now-playing content
  const statusContent = (() => {
    if (!hasEpisode) return (
      <span
        className="transition-opacity duration-500"
        style={{ opacity: callerFade ? 1 : 0 }}
      >
        {actionMessage ?? CALLER_MESSAGES[callerIdx]}
      </span>
    );
    const icon = isPlaying ? "▶" : "❚❚";
    const parts = [nowPlayingTitle];
    if (nowPlayingGuest) parts.push(nowPlayingGuest);
    return (
      <button
        onClick={handleStatusClick}
        onDoubleClick={() => emit("toggle-ultra-mini")}
        className="flex items-center gap-1.5 cursor-pointer hover:text-desktop-gray transition-colors-fast text-left w-full"
      >
        {isPlaying && (
          <span className="inline-block w-[5px] h-[5px] rounded-full bg-red-500 animate-on-air flex-shrink-0" />
        )}
        <span className="text-bevel-dark">{icon}</span>
        <span className="truncate">{parts.join(" · ")}</span>
        <MirrorBadge />
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
            // Signal-strength bars: a graphic, no text.
            // eslint-disable-next-line hd/text-opacity-floor
            isPlaying ? `animate-signal-${i + 1}` : "opacity-20",
          )}
          style={{ height: `${h}px` }}
        />
      ))}
    </span>
  );

  return (
    <Win98StatusBar
      variant="dark"
      panels={[
        { content: statusContent, flex: 1 },
        ...(isHalloweenSeason ? [{
          content: (
            <button
              onClick={handleGhostClick}
              className="text-hd-10 cursor-pointer hover:text-desert-amber transition-colors-fast"
              style={{ color: "var(--hd-egg-halloween)" }}
              title="Ghost to Ghost AM Collection"
            >
              🎃 Ghost to Ghost
            </button>
          ),
          width: "110px",
        }] : []),
        ...((streak ?? 0) > 1 ? [{
          content: (
            <span className="text-hd-10 text-desert-amber/85" title={`${streak}-day listening streak`}>
              🔥 {streak}d
            </span>
          ),
          width: "48px",
        }] : []),
        // Live presence. Always rendered when anyone is here — including this
        // visitor — and clickable through to the traffic history. It used to
        // be buried in ListeningStats behind a guard that returned null
        // unless *you* already had a streak or listening hours, so the one
        // genuinely social signal on the site was invisible to exactly the
        // first-time visitors it would impress.
        ...(presence.online > 0 ? [{
          content: (
            <button
              onClick={() => router.push("/stats#on-air")}
              className="flex items-center gap-1.5 cursor-pointer text-hd-10 text-static-green/85 hover:text-static-green transition-colors-fast w-full"
              title={
                `${presence.online} ${presence.online === 1 ? "person" : "people"} on the site` +
                (presence.listening > 0 ? `, ${presence.listening} listening` : "") +
                ": click to see what they have on"
              }
              {...presenceAttrs("status-bar", presence)}
            >
              <span className="w-[6px] h-[6px] rounded-full bg-static-green animate-on-air flex-shrink-0" />
              <span className="tabular-nums">{presence.online} online</span>
              {presence.listening > 0 && (
                <span className="text-desert-amber/85 tabular-nums">
                  · {presence.listening} ▶
                </span>
              )}
            </button>
          ),
          width: "150px",
        }] : []),
        { content: `${episodeCount.toLocaleString()} episode${episodeCount !== 1 ? "s" : ""}`, width: "120px" },
        { content: signalBars, width: "24px" },
        { content: clock, width: "72px" },
      ]}
      className="flex-shrink-0 relative z-10 hidden md:flex"
    />
  );
}
