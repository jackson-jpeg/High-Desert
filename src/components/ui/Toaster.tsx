"use client";

import { useState, useEffect, useCallback } from "react";
import { useToastStore, type Toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils/cn";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-[calc(var(--safe-top)+8px)] md:top-auto md:bottom-10 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:right-4 z-50 flex flex-col gap-1.5 pointer-events-none w-[calc(100vw-2rem)] md:w-auto max-w-[360px]"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const [leaving, setLeaving] = useState(false);

  const dismiss = useCallback(() => {
    setLeaving(true);
    setTimeout(() => removeToast(toast.id), 200);
  }, [toast.id, removeToast]);

  useEffect(() => {
    const timer = setTimeout(dismiss, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, dismiss]);

  const accentColor =
    toast.type === "success"
      ? "bg-static-green/70"
      : toast.type === "error"
        ? "bg-red-400/70"
        : toast.type === "caller"
          ? "bg-[#33FF33]/70"
          : "bg-desert-amber/70";

  return (
    <div
      className={cn(
        "w98-raised-dark bg-raised-surface min-w-[200px] max-w-[320px] overflow-hidden",
        "pointer-events-auto glass-medium",
        leaving
          ? "animate-toast-exit"
          : "animate-slide-up animate-glass-toast",
      )}
    >
      <div className="flex">
        {/* Accent bar — survives glass border override */}
        <div className={cn("w-[2px] flex-shrink-0", accentColor)} />
        <div className="flex items-start gap-2 px-3 py-2 flex-1 min-w-0">
          <span className="text-hd-10 flex-shrink-0 mt-px" aria-hidden="true">
            {toast.type === "success" && <span className="text-static-green">{"\u2713"}</span>}
            {toast.type === "error" && <span className="text-red-400">{"\u2716"}</span>}
            {toast.type === "info" && <span className="text-desert-amber">{"\u25CF"}</span>}
            {toast.type === "caller" && <span style={{ color: "#33FF33" }}>{"☎"}</span>}
          </span>
          <span
            className="text-hd-12 md:text-hd-10 leading-relaxed"
            style={toast.type === "caller" ? { color: "#33FF33", textShadow: "0 0 6px rgba(51,255,51,0.3)" } : undefined}
            role="status"
          >
            {toast.type === "caller" ? `INCOMING CALL — ${toast.message}` : toast.message}
          </span>
          <button
            onClick={dismiss}
            className="text-hd-12 md:text-hd-9 text-bevel-dark hover:text-desktop-gray active:text-desktop-gray cursor-pointer flex-shrink-0 ml-auto min-w-[32px] min-h-[32px] md:min-w-0 md:min-h-0 flex items-center justify-center"
          >
            {"\u2715"}
          </button>
        </div>
      </div>
    </div>
  );
}
