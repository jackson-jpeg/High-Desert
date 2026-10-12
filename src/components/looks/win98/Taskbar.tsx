"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppPathname } from "@/hooks/useAppPathname";
import { cn } from "@/lib/utils/cn";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { usePlayerStore } from "@/stores/player-store";
import { presenceAttrs, type LivePresence } from "@/services/stats/now-feed";
import { formatClock, STATUS_TICK_MS } from "@/components/desktop/StatusBar";
import { isKeyOwnedByTarget } from "@/lib/utils/key-ownership";
import { StartMenu } from "./StartMenu";
import { HelpDialog, RunDialog, SafeToTurnOff, ShutDownDialog } from "./Win98Dialogs";
import { startMenuItems, typeKey, type StartAction, type StartItem } from "./start-menu";
import { Win98Icon } from "./Win98Icon";
import { PHONE_LINES_HREF } from "@/lib/live/phone-lines";

// Reachable only by the Run box or by typing on the desktop: fetched when opened.
const MelsHole = dynamic(() => import("./MelsHole").then((m) => m.MelsHole), { ssr: false });

/** The windows a taskbar shows as buttons: the three places a listener lives. */
export const TASKS = [
  { label: "Library", path: "/library", icon: "library" },
  { label: "Live", path: "/live", icon: "live" },
  { label: "Stats", path: "/stats", icon: "stats" },
] as const;

/**
 * On a phone, Radio's old place goes to the Phone Lines (docs/live-qa.md):
 * between Live and Stats, opening the Live screen with the lines open. A
 * desktop has the lines beside the console already, so it keeps three.
 */
export const PHONE_LINES_TASK = { label: "Phone Lines", path: PHONE_LINES_HREF, icon: "phone", testId: "phone-lines" } as const;

type Task = { label: string; path: string; icon: (typeof TASKS)[number]["icon"] | "phone"; testId?: string };

/** The task buttons for this screen: the three places, and on a phone the Phone Lines. */
export function tasksFor(isMobile: boolean): readonly Task[] {
  return isMobile ? [TASKS[0], TASKS[1], PHONE_LINES_TASK, TASKS[2]] : TASKS;
}

type Overlay = "run" | "shutdown" | "help" | "mels-hole" | "off" | null;

export interface TaskbarProps {
  isAdmin: boolean;
  presence: LivePresence;
  onAbout: () => void;
  onShortcuts: () => void;
  /** The phone's More sheet (text size, sound, export). */
  onSettings: () => void;
  /** Start > Settings > Display: the look (DisplayProperties, owned by the shell). */
  onDisplay: () => void;
}

/**
 * The Win98 look's taskbar: Start, a button per place, and the tray (who is
 * here, the speaker, the clock). It stands in for the nav tabs on every
 * screen: at the bottom of the desktop, and as the phone's bottom bar.
 */
export function Taskbar({ isAdmin, presence, onAbout, onShortcuts, onSettings, onDisplay }: TaskbarProps) {
  const router = useRouter();
  const pathname = useAppPathname();
  const isMobile = useIsMobile();
  const [startOpen, setStartOpen] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const closeStart = useCallback(({ restoreFocus }: { restoreFocus: boolean }) => {
    setStartOpen(false);
    if (restoreFocus) startRef.current?.focus();
  }, []);

  // The route, on <html>, for the look's CSS: screens made of windows (Live,
  // Stats) show the teal desktop between them.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.w98Route = pathname ?? "";
    return () => {
      delete root.dataset.w98Route;
    };
  }, [pathname]);

  // A click anywhere else closes the menu, as on the real desktop.
  useEffect(() => {
    if (!startOpen) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setStartOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [startOpen]);

  // Ctrl+Esc opens the Start menu; typing "hole" with nothing focused opens
  // Mel's Hole (start-menu.ts, HOLE_WORD).
  const typed = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && e.ctrlKey) {
        e.preventDefault();
        setStartOpen((o) => !o);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (isKeyOwnedByTarget(e)) {
        typed.current = 0;
        return;
      }
      const r = typeKey(typed.current, e.key);
      typed.current = r.progress;
      if (r.done) setOverlay("mels-hole");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const runAction = useCallback(
    (action: StartAction) => {
      switch (action.kind) {
        case "route":
          // Phone Lines too: /live?lines=1 opens them (src/lib/live/phone-lines.ts).
          router.push(action.href);
          return;
        case "about":
          return onAbout();
        case "shortcuts":
          return onShortcuts();
        case "settings":
          return onSettings();
        case "display":
          return onDisplay();
        case "submenu":
          // The Start menu opens its own submenus; nothing to do here.
          return;
        case "help":
          return setOverlay("help");
        case "run":
          return setOverlay("run");
        case "shutdown":
          return setOverlay("shutdown");
      }
    },
    [router, onAbout, onShortcuts, onSettings, onDisplay],
  );

  const pick = useCallback(
    (item: StartItem) => {
      setStartOpen(false);
      runAction(item.action);
    },
    [runAction],
  );

  const items = startMenuItems({ isAdmin, isMobile });

  return (
    <div
      ref={rootRef}
      data-testid="w98-taskbar"
      className={cn("hd-w98-taskbar relative flex items-center gap-[3px] w98-font", isMobile ? "h-[56px] px-[3px]" : "h-[30px] px-[2px]")}
    >
      <button
        ref={startRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={startOpen}
        aria-pressed={startOpen}
        data-testid="w98-start"
        onClick={() => setStartOpen((o) => !o)}
        className={cn(
          "hd-w98-start-button w98-raised-dark bg-raised-surface flex items-center gap-1 font-bold cursor-pointer flex-shrink-0",
          isMobile ? "min-h-touch px-3 text-hd-body" : "h-[24px] px-[6px] text-hd-12",
        )}
      >
        <Win98Icon name="start" size={isMobile ? 20 : 16} />
        Start
      </button>
      {startOpen && (
        <div className="hd-w98-start-anchor absolute left-[2px] bottom-full z-[60]">
          <StartMenu items={items} onPick={pick} onClose={closeStart} large={isMobile} />
        </div>
      )}

      <span className="hd-w98-taskbar-divider" aria-hidden="true" />

      <div className="flex items-center gap-[3px] flex-1 min-w-0" role="group" aria-label="Places">
        {tasksFor(isMobile).map((t) => {
          const active = pathname === t.path;
          const lines = t.path === PHONE_LINES_HREF;
          return (
            <button
              key={t.path}
              type="button"
              aria-current={active ? "page" : undefined}
              aria-pressed={active}
              data-testid={`w98-task-${t.testId ?? t.label.toLowerCase()}`}
              onClick={() => router.push(t.path)}
              className={cn(
                "hd-w98-task w98-raised-dark bg-raised-surface flex items-center gap-1 cursor-pointer min-w-0",
                // Two short lines rather than "Phone L…" in a quarter of a phone.
                lines ? "whitespace-normal leading-tight text-center" : "truncate",
                isMobile ? "min-h-touch flex-1 justify-center px-1 text-hd-12" : "h-[24px] w-[150px] px-[6px] text-hd-12",
                active && "hd-w98-task-active",
              )}
            >
              <Win98Icon name={t.icon} size={16} className="flex-shrink-0" />
              <span className={lines ? "min-w-0" : "truncate"}>{t.label}</span>
            </button>
          );
        })}
      </div>

      <Tray presence={presence} compact={isMobile} />

      {overlay === "run" && (
        <RunDialog
          onClose={() => setOverlay(null)}
          onResult={(r) => {
            if (r.kind === "mels-hole") setOverlay("mels-hole");
            else if (r.kind === "action") {
              setOverlay(null);
              runAction(r.action);
            }
          }}
        />
      )}
      {overlay === "shutdown" && <ShutDownDialog onClose={() => setOverlay(null)} onShutDown={() => setOverlay("off")} />}
      {overlay === "off" && <SafeToTurnOff onWake={() => setOverlay(null)} />}
      {overlay === "help" && <HelpDialog onClose={() => setOverlay(null)} />}
      {overlay === "mels-hole" && <MelsHole onClose={() => setOverlay(null)} />}
    </div>
  );
}

/** The tray: presence, the speaker, the clock. Owns the clock's timer, so a tick re-renders only this. */
function Tray({ presence, compact }: { presence: LivePresence; compact: boolean }) {
  const [clock, setClock] = useState("");
  const muted = usePlayerStore((s) => s.volume === 0);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const playing = usePlayerStore((s) => s.playing);
  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()));
    tick();
    const id = setInterval(tick, STATUS_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      data-testid="w98-tray"
      className={cn(
        "hd-w98-tray w98-inset-dark flex items-center gap-2 flex-shrink-0 text-hd-12",
        compact ? "min-h-touch px-2" : "h-[24px] px-2",
      )}
    >
      <span
        className="flex items-center gap-1 tabular-nums"
        title={`${presence.online} online, ${presence.listening} listening`}
        data-testid="w98-tray-online"
        {...presenceAttrs("taskbar", presence)}
      >
        <span className={cn("hd-w98-tray-dot", playing && "hd-w98-tray-dot-on")} aria-hidden="true" />
        {presence.online}
        <span className="sr-only"> online</span>
      </span>
      {!compact && (
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          className="cursor-pointer flex items-center"
          data-testid="w98-tray-volume"
        >
          <Win98Icon name="speaker" size={16} />
        </button>
      )}
      <span className="tabular-nums whitespace-nowrap" data-testid="w98-tray-clock">
        {clock}
      </span>
    </div>
  );
}
