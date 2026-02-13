"use client";

import { cn } from "@/lib/utils/cn";
import { ReactNode, useEffect, useRef, useCallback } from "react";
import { Window, type WindowProps } from "./Window";

export interface DialogProps extends Omit<WindowProps, "children"> {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  children,
  width = "400px",
  className,
  ...windowProps
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Store the previously focused element and focus the dialog on open
  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus first focusable element inside the dialog
    requestAnimationFrame(() => {
      if (!dialogRef.current) return;
      const first = dialogRef.current.querySelector<HTMLElement>(FOCUSABLE);
      if (first) {
        first.focus();
      } else {
        dialogRef.current.focus();
      }
    });

    // Restore focus on close
    return () => {
      previousFocusRef.current?.focus();
    };
  }, [open]);

  // Focus trap + Escape to close
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Dialog window */}
      <div
        ref={dialogRef}
        className={cn("relative animate-dialog", className)}
        style={{ width, maxWidth: "90vw" }}
        role="alertdialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <Window onClose={onClose} {...windowProps}>
          {children}
        </Window>
      </div>
    </div>
  );
}
