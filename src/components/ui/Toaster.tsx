"use client";

import { useEffect } from "react";
import { useToastStore, type Toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils/cn";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-8 right-3 z-50 flex flex-col gap-1.5 pointer-events-none"
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

  const accent =
    toast.type === "success"
      ? "border-l-static-green/70"
      : toast.type === "error"
        ? "border-l-red-400/70"
        : "border-l-desert-amber/70";

  return (
    <div
      className={cn(
        "w98-raised-dark bg-raised-surface border-l-2 px-3 py-2 min-w-[200px] max-w-[320px]",
        "pointer-events-auto animate-slide-up",
        accent,
      )}
    >
      <div className="flex items-start gap-2">
        <span className="text-[10px] flex-shrink-0 mt-px">
          {toast.type === "success" && <span className="text-static-green">{"\u2713"}</span>}
          {toast.type === "error" && <span className="text-red-400">{"\u2716"}</span>}
          {toast.type === "info" && <span className="text-desert-amber">{"\u25CF"}</span>}
        </span>
        <span className="text-[10px] text-desktop-gray leading-relaxed">
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
  );
}
