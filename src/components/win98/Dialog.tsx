"use client";

import { cn } from "@/lib/utils/cn";
import { ReactNode, useEffect, useId } from "react";
import { Window, type WindowProps } from "./Window";
import { lockScroll, unlockScroll } from "@/lib/utils/scroll-lock";
import { useFocusTrap } from "@/hooks/useFocusTrap";

export interface DialogProps extends Omit<WindowProps, "children"> {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  /**
   * `alertdialog` is for urgent interruptions that need an immediate answer.
   * Everything else — About, Shortcuts, settings — is a plain `dialog`.
   */
  urgent?: boolean;
}

export function Dialog({
  open,
  onClose,
  children,
  width = "400px",
  className,
  urgent = false,
  ...windowProps
}: DialogProps) {
  const titleId = useId();
  // Focus in on open, Tab wraps, Escape closes without reaching the page
  // behind, focus back on close. Shared with every other modal (HD-022).
  const { ref: dialogRef, onKeyDown: handleKeyDown } = useFocusTrap({ active: open, onEscape: onClose });

  useEffect(() => {
    if (!open) return;
    lockScroll();
    return () => unlockScroll();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm glass-backdrop animate-glass-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      {/* Dialog window */}
      <div
        ref={dialogRef}
        className={cn("relative animate-dialog", className)}
        style={{ width, maxWidth: "calc(90vw - var(--safe-left, 0px) - var(--safe-right, 0px))" }}
        role={urgent ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <Window onClose={onClose} titleId={titleId} {...windowProps}>
          {children}
        </Window>
      </div>
    </div>
  );
}
