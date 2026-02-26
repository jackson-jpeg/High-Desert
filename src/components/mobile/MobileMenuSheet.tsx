"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";

interface MobileMenuSheetProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onToggleAdmin: () => void;
  onAbout: () => void;
  startupSoundOn?: boolean;
  onToggleStartupSound?: () => void;
}

export const MobileMenuSheet: React.FC<MobileMenuSheetProps> = ({ open, onClose, isAdmin, onToggleAdmin, onAbout, startupSoundOn, onToggleStartupSound }) => {
  const router = useRouter();
  const closingRef = useRef(false);

  const hide = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    onClose();
  }, [onClose]);

  // Reset closing guard when sheet opens
  useEffect(() => {
    if (open) closingRef.current = false;
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
        className="fixed inset-0 z-[100] glass-backdrop animate-glass-backdrop"
        onClick={hide}
      />
      {/* Sheet */}
      <div role="dialog" aria-modal="true" aria-label="Menu" className="fixed bottom-0 inset-x-0 z-[101] glass-heavy rounded-t-2xl overflow-hidden pb-[var(--safe-bottom)] animate-glass-sheet">
        {/* Grab handle */}
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="w-8 h-[3px] rounded-full bg-white/15" />
        </div>
        <div className="flex flex-col max-h-[60vh] overflow-y-auto">
          {/* Admin toggle */}
          <button
            onClick={() => {
              onToggleAdmin();
              hide();
            }}
            aria-pressed={isAdmin}
            className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center justify-between"
          >
            <span>Admin Mode</span>
            <span className={cn(
              "text-[12px]",
              isAdmin ? "text-desert-amber" : "text-bevel-dark/50",
            )}>
              {isAdmin ? "On" : "Off"}
            </span>
          </button>

          {/* Surprise Me */}
          <div className="border-t glass-divider">
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent("hd:shuffle", { detail: "all" }));
                hide();
              }}
              className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desert-amber cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center gap-2"
            >
              <span>{"\u21C6"}</span>
              <span>Surprise Me — Shuffle All</span>
            </button>
          </div>

          {/* Radio Dial */}
          <div className="border-t glass-divider">
            <button
              onClick={() => {
                router.push("/radio");
                hide();
              }}
              className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast"
            >
              Radio Dial
            </button>
          </div>

          {/* Statistics */}
          <div className="border-t glass-divider">
            <button
              onClick={() => {
                router.push("/stats");
                hide();
              }}
              className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast"
            >
              Statistics
            </button>
          </div>

          {/* Startup Sound */}
          {onToggleStartupSound && (
            <div className="border-t glass-divider">
              <button
                onClick={() => {
                  onToggleStartupSound();
                  hide();
                }}
                aria-pressed={startupSoundOn ?? false}
                className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast flex items-center justify-between"
              >
                <span>Startup Sound</span>
                <span className={cn(
                  "text-[12px]",
                  startupSoundOn ? "text-desert-amber" : "text-bevel-dark/50",
                )}>
                  {startupSoundOn ? "On" : "Off"}
                </span>
              </button>
            </div>
          )}

          {/* About */}
          <div className="border-t glass-divider">
            <button
              onClick={() => {
                onAbout();
                hide();
              }}
              className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desktop-gray cursor-pointer active:bg-white/[0.06] transition-colors-fast"
            >
              About High Desert
            </button>
          </div>

          {/* Cancel */}
          <div className="border-t glass-divider">
            <button
              onClick={hide}
              className="w-full text-center px-4 py-3 text-[14px] min-h-[48px] text-bevel-dark cursor-pointer active:bg-white/[0.04]"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
