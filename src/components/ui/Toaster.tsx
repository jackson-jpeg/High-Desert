"use client";

import { useEffect } from "react";
import { useToastStore, type Toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils/cn";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-[calc(130px+var(--safe-bottom))] md:bottom-10 right-4 z-50 flex flex-col gap-1.5 pointer-events-none"
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

  useEffect(() => {
    const timer = setTimeout(() => removeToast(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, removeToast]);

  const accentColor =
    toast.type === "success"
      ? "bg-static-green/70"
      : toast.type === "error"
        ? "bg-red-400/70"
        : "bg-desert-amber/70";

  return (
    <div
      className={cn(
        "w98-raised-dark bg-raised-surface min-w-[200px] max-w-[320px] overflow-hidden",
        "pointer-events-auto animate-slide-up glass-medium animate-glass-toast",
      )}
    >
      <div className="flex">
        {/* Accent bar — survives glass border override */}
        <div className={cn("w-[2px] flex-shrink-0", accentColor)} />
        <div className="flex items-start gap-2 px-3 py-2 flex-1 min-w-0">
          <span className="text-[10px] flex-shrink-0 mt-px" aria-hidden="true">
            {toast.type === "success" && <span className="text-static-green">{"\u2713"}</span>}
            {toast.type === "error" && <span className="text-red-400">{"\u2716"}</span>}
            {toast.type === "info" && <span className="text-desert-amber">{"\u25CF"}</span>}
          </span>
          <span className="text-[10px] text-desktop-gray leading-relaxed" role="status">
            {toast.message}
          </span>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-[9px] text-bevel-dark hover:text-desktop-gray cursor-pointer flex-shrink-0 ml-auto"
          >
            {"\u2715"}
          </button>
        </div>
      </div>
    </div>
  );
}
