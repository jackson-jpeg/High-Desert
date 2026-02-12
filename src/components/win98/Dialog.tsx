"use client";

import { cn } from "@/lib/utils/cn";
import { ReactNode, useEffect } from "react";
import { Window, type WindowProps } from "./Window";

export interface DialogProps extends Omit<WindowProps, "children"> {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}

export function Dialog({
  open,
  onClose,
  children,
  width = "400px",
  className,
  ...windowProps
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

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
        className={cn("relative animate-dialog", className)}
        style={{ width, maxWidth: "90vw" }}
      >
        <Window onClose={onClose} {...windowProps}>
          {children}
        </Window>
      </div>
    </div>
  );
}
