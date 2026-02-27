"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { lockScroll, unlockScroll } from "@/lib/utils/scroll-lock";

interface MobileMenuSheetProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onToggleAdmin: () => void;
  onAbout: () => void;
  startupSoundOn?: boolean;
  onToggleStartupSound?: () => void;
}

export function MobileMenuSheet({ open, onClose, isAdmin, onToggleAdmin, onAbout, startupSoundOn, onToggleStartupSound }: MobileMenuSheetProps) {
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

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
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className={cn(
          "fixed bottom-0 inset-x-0 z-[101] glass-heavy rounded-t-2xl overflow-hidden pb-[var(--safe-bottom)] pl-[var(--safe-left)] pr-[var(--safe-right)]",
          closing ? "animate-glass-sheet-out" : "animate-glass-sheet",
        )}
      >
        {/* Grab handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-[4px] rounded-full bg-white/12" />
        </div>
        <div className="flex flex-col max-h-[60vh] overflow-y-auto overscroll-contain px-1">
          {/* Quick actions group */}
          <div className="px-3 pb-1">
            <span className="text-[10px] text-bevel-dark/40 uppercase tracking-wider font-sans">Quick Actions</span>
          </div>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent("hd:shuffle", { detail: "all" }));
              hide();
            }}
            className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desert-amber cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-3 rounded-lg"
          >
            <span className="w-[24px] text-center text-[16px]">{"\u21C6"}</span>
            <span>Surprise Me — Shuffle All</span>
          </button>

          {/* Navigation group */}
          <div className="h-[1px] bg-white/[0.06] mx-3 my-2" />
          <div className="px-3 pb-1">
            <span className="text-[10px] text-bevel-dark/40 uppercase tracking-wider font-sans">Navigate</span>
          </div>
          <button
            onClick={() => {
              router.push("/radio");
              hide();
            }}
            className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-3 rounded-lg"
          >
            <span className="w-[24px] text-center text-[14px] text-bevel-dark/60">{"\u{1F4FB}"}</span>
            <span>Radio Dial</span>
          </button>
          <button
            onClick={() => {
              router.push("/stats");
              hide();
            }}
            className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-3 rounded-lg"
          >
            <span className="w-[24px] text-center text-[14px] text-bevel-dark/60">{"\u{1F4CA}"}</span>
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
                className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-3 rounded-lg"
              >
                <span className="w-[24px] text-center text-[14px] text-desert-amber/50">{"\u2699"}</span>
                <span>Scanner</span>
              </button>
              <button
                onClick={() => {
                  router.push("/search");
                  hide();
                }}
                className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-3 rounded-lg"
              >
                <span className="w-[24px] text-center text-[14px] text-desert-amber/50">{"\u{1F50D}"}</span>
                <span>Archive Search</span>
              </button>
            </>
          )}

          {/* Settings group */}
          <div className="h-[1px] bg-white/[0.06] mx-3 my-2" />
          <div className="px-3 pb-1">
            <span className="text-[10px] text-bevel-dark/40 uppercase tracking-wider font-sans">Settings</span>
          </div>
          <button
            onClick={() => {
              onToggleAdmin();
              hide();
            }}
            aria-pressed={isAdmin}
            className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center justify-between rounded-lg"
          >
            <div className="flex items-center gap-3">
              <span className="w-[24px] text-center text-[14px] text-bevel-dark/60">{"\u{1F512}"}</span>
              <span>Admin Mode</span>
            </div>
            <span className={cn(
              "text-[12px]",
              isAdmin ? "text-desert-amber" : "text-bevel-dark/50",
            )}>
              {isAdmin ? "On" : "Off"}
            </span>
          </button>

          {onToggleStartupSound && (
            <button
              onClick={() => {
                onToggleStartupSound();
                hide();
              }}
              aria-pressed={startupSoundOn ?? false}
              className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center justify-between rounded-lg"
            >
              <div className="flex items-center gap-3">
                <span className="w-[24px] text-center text-[14px] text-bevel-dark/60">{"\u{1F50A}"}</span>
                <span>Startup Sound</span>
              </div>
              <span className={cn(
                "text-[12px]",
                startupSoundOn ? "text-desert-amber" : "text-bevel-dark/50",
              )}>
                {startupSoundOn ? "On" : "Off"}
              </span>
            </button>
          )}

          <button
            onClick={() => {
              onAbout();
              hide();
            }}
            className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-3 rounded-lg"
          >
            <span className="w-[24px] text-center text-[14px] text-bevel-dark/60">{"\u2139"}</span>
            <span>About High Desert</span>
          </button>

          {/* Cancel */}
          <div className="h-[1px] bg-white/[0.06] mx-3 my-2" />
          <button
            onClick={hide}
            className="w-full text-center px-4 py-3 text-[14px] min-h-[48px] text-bevel-dark/70 cursor-pointer active:bg-white/[0.04] rounded-lg mb-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
