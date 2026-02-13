"use client";

import { useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils/cn";

interface MobileMenuSheetProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onToggleAdmin: () => void;
  onAbout: () => void;
}

export function MobileMenuSheet({ open, onClose, isAdmin, onToggleAdmin, onAbout }: MobileMenuSheetProps) {
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
        className="fixed inset-0 z-[100] bg-black/50"
        onClick={hide}
      />
      {/* Sheet */}
      <div className="fixed bottom-0 inset-x-0 z-[101] bg-raised-surface w98-raised-dark pb-[var(--safe-bottom)] animate-slide-up">
        <div className="flex flex-col">
          {/* Admin toggle */}
          <button
            onClick={() => {
              onToggleAdmin();
              hide();
            }}
            className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desktop-gray cursor-pointer active:bg-title-bar-blue/20 transition-colors-fast flex items-center justify-between"
          >
            <span>Admin Mode</span>
            <span className={cn(
              "text-[12px]",
              isAdmin ? "text-desert-amber" : "text-bevel-dark/50",
            )}>
              {isAdmin ? "On" : "Off"}
            </span>
          </button>

          {/* About */}
          <div className="border-t border-bevel-dark/20">
            <button
              onClick={() => {
                onAbout();
                hide();
              }}
              className="w-full text-left px-4 py-3 text-[14px] min-h-[48px] text-desktop-gray cursor-pointer active:bg-title-bar-blue/20 transition-colors-fast"
            >
              About High Desert
            </button>
          </div>

          {/* Cancel */}
          <div className="border-t border-bevel-dark/20">
            <button
              onClick={hide}
              className="w-full text-center px-4 py-3 text-[14px] min-h-[48px] text-bevel-dark cursor-pointer active:bg-title-bar-blue/10"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
