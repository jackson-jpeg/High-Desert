"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { lockScroll, unlockScroll } from "@/lib/utils/scroll-lock";

interface MobileMenuSheetProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onAbout: () => void;
  startupSoundOn?: boolean;
  onToggleStartupSound?: () => void;
  textScale?: "1" | "1.15" | "1.3";
  onCycleTextScale?: () => void;
  /** Live presence. The desktop status bar carries this; mobile has none. */
  presence?: { online: number; listening: number };
}

const TEXT_SCALE_LABELS: Record<string, string> = { "1": "Normal", "1.15": "Large", "1.3": "Extra Large" };

export function MobileMenuSheet({ open, onClose, isAdmin, onAbout, startupSoundOn, onToggleStartupSound, textScale, onCycleTextScale, presence }: MobileMenuSheetProps) {
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const hide = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 250);
  }, [onClose]);

  // Reset closing guard when sheet opens
  useEffect(() => {
    if (open) {
      closingRef.current = false;
      setClosing(false); // eslint-disable-line react-hooks/set-state-in-effect -- reset derived state on prop change
    }
  }, [open]);

  // Lock body scroll while sheet is open
  useEffect(() => {
    if (!open) return;
    lockScroll();
    return () => unlockScroll();
  }, [open]);

  // Escape key closes the sheet
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, hide]);

  // Move focus into the sheet and restore it on close. It declared
  // aria-modal="true" but never moved focus, so a screen-reader user was left
  // on the "More" tab behind it with no indication anything had opened.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      sheetRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      previous?.focus();
    };
  }, [open]);

  // Trap Tab within the sheet while it is open.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !sheetRef.current) return;
    const focusable = Array.from(
      sheetRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]"),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-[100] glass-backdrop",
          closing ? "animate-glass-backdrop-out" : "animate-glass-backdrop",
        )}
        onClick={hide}
      />
      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          "fixed bottom-0 inset-x-0 z-[101] glass-heavy rounded-t-2xl overflow-hidden pb-[var(--safe-bottom)] pl-[var(--safe-left)] pr-[var(--safe-right)]",
          closing ? "animate-glass-sheet-out" : "animate-glass-sheet",
        )}
      >
        {/* Grab handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-[4px] rounded-full bg-white/12" />
        </div>
        <div className="flex flex-col max-h-[60dvh] overflow-y-auto overscroll-contain px-1">
          {/* Live presence. The desktop status bar shows this permanently;
              mobile has no status bar, so it surfaces here and taps through to
              the same traffic history. */}
          {presence && presence.online > 0 && (
            <>
              <button
                onClick={() => {
                  router.push("/stats#traffic");
                  hide();
                }}
                className="w-full text-left px-4 py-3 text-hd-14 min-h-[48px] cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-3 rounded-lg"
              >
                <span className="w-[24px] flex items-center justify-center">
                  <span className="w-[8px] h-[8px] rounded-full bg-static-green animate-on-air" />
                </span>
                <span className="text-static-green">
                  {presence.online} online
                  {presence.listening > 0 && (
                    <span className="text-desert-amber/85"> · {presence.listening} listening</span>
                  )}
                </span>
              </button>
              <div className="h-[1px] bg-white/[0.06] mx-3 my-2" />
            </>
          )}

          {/* Quick actions group */}
          <div className="px-3 pb-1">
            <span className="text-hd-11 text-bevel-dark/85 uppercase tracking-wider font-sans">Quick Actions</span>
          </div>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent("hd:shuffle", { detail: "all" }));
              hide();
            }}
            className="w-full text-left px-4 py-3 text-hd-14 min-h-[48px] text-desert-amber cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-3 rounded-lg"
          >
            <span className="w-[24px] text-center text-hd-16">{"\u21C6"}</span>
            <span>Surprise Me — Shuffle All</span>
          </button>

          {/* Sort group.
              Mobile had no way to sort at all: the sort pills in the library
              only render once sortMode !== "date" — a control that appears only
              after you have already used it — and the menu bar carrying
              View > Sort by is `hidden md:flex`. Once a sort is picked here
              those pills appear and take over as the quick switcher. */}
          <div className="h-[1px] bg-white/[0.06] mx-3 my-2" />
          <div className="px-3 pb-1">
            <span className="text-hd-11 text-bevel-dark/85 uppercase tracking-wider font-sans">Sort Episodes</span>
          </div>
          {([
            ["date", "Date — newest first", "\u{1F4C5}"],
            ["recent", "Recently played", "\u{1F553}"],
            ["progress", "In progress", "◑"],
            ["rated", "Top rated", "★"],
            ["played", "Most played", "▶"],
          ] as const).map(([mode, label, icon]) => (
            <button
              key={mode}
              onClick={() => {
                window.dispatchEvent(new CustomEvent("hd:sort", { detail: mode }));
                hide();
              }}
              className="w-full text-left px-4 py-3 text-hd-14 min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-3 rounded-lg"
            >
              <span className="w-[24px] text-center text-hd-14 text-bevel-dark/85">{icon}</span>
              <span>{label}</span>
            </button>
          ))}

          {/* Navigation group */}
          <div className="h-[1px] bg-white/[0.06] mx-3 my-2" />
          <div className="px-3 pb-1">
            <span className="text-hd-11 text-bevel-dark/85 uppercase tracking-wider font-sans">Navigate</span>
          </div>
          <button
            onClick={() => {
              router.push("/radio");
              hide();
            }}
            className="w-full text-left px-4 py-3 text-hd-14 min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-3 rounded-lg"
          >
            <span className="w-[24px] text-center text-hd-14 text-bevel-dark/85">{"\u{1F4FB}"}</span>
            <span>Radio Dial</span>
          </button>
          <button
            onClick={() => {
              router.push("/stats");
              hide();
            }}
            className="w-full text-left px-4 py-3 text-hd-14 min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-3 rounded-lg"
          >
            <span className="w-[24px] text-center text-hd-14 text-bevel-dark/85">{"\u{1F4CA}"}</span>
            <span>Statistics</span>
          </button>

          {/* Admin-only pages */}
          {isAdmin && (
            <>
              <button
                onClick={() => {
                  router.push("/scanner");
                  hide();
                }}
                className="w-full text-left px-4 py-3 text-hd-14 min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-3 rounded-lg"
              >
                <span className="w-[24px] text-center text-hd-14 text-desert-amber/85">{"\u2699"}</span>
                <span>Scanner</span>
              </button>
              <button
                onClick={() => {
                  router.push("/search");
                  hide();
                }}
                className="w-full text-left px-4 py-3 text-hd-14 min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-3 rounded-lg"
              >
                <span className="w-[24px] text-center text-hd-14 text-desert-amber/85">{"\u{1F50D}"}</span>
                <span>Archive Search</span>
              </button>
            </>
          )}

          {/* Settings group */}
          <div className="h-[1px] bg-white/[0.06] mx-3 my-2" />
          <div className="px-3 pb-1">
            <span className="text-hd-11 text-bevel-dark/85 uppercase tracking-wider font-sans">Settings</span>
          </div>
          {onToggleStartupSound && (
            <button
              onClick={() => {
                onToggleStartupSound();
                hide();
              }}
              aria-pressed={startupSoundOn ?? false}
              className="w-full text-left px-4 py-3 text-hd-14 min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center justify-between rounded-lg"
            >
              <div className="flex items-center gap-3">
                <span className="w-[24px] text-center text-hd-14 text-bevel-dark/85">{"\u{1F50A}"}</span>
                <span>Startup Sound</span>
              </div>
              <span className={cn(
                "text-hd-13",
                startupSoundOn ? "text-desert-amber" : "text-bevel-dark/85",
              )}>
                {startupSoundOn ? "On" : "Off"}
              </span>
            </button>
          )}

          {onCycleTextScale && (
            <button
              onClick={() => {
                onCycleTextScale();
                // Don't hide — let user see the change immediately
              }}
              className="w-full text-left px-4 py-3 text-hd-14 min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center justify-between rounded-lg"
            >
              <div className="flex items-center gap-3">
                <span className="w-[24px] text-center text-hd-14 text-bevel-dark/85">Aa</span>
                <span>Text Size</span>
              </div>
              <span className="text-hd-13 text-desert-amber">
                {TEXT_SCALE_LABELS[textScale ?? "1"]}
              </span>
            </button>
          )}

          <button
            onClick={() => {
              onAbout();
              hide();
            }}
            className="w-full text-left px-4 py-3 text-hd-14 min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-3 rounded-lg"
          >
            <span className="w-[24px] text-center text-hd-14 text-bevel-dark/85">{"\u2139"}</span>
            <span>About High Desert</span>
          </button>

          {/* Cancel */}
          <div className="h-[1px] bg-white/[0.06] mx-3 my-2" />
          <button
            onClick={hide}
            className="w-full text-center px-4 py-3 text-hd-14 min-h-[48px] text-bevel-dark/85 cursor-pointer active:bg-white/[0.04] rounded-lg mb-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
