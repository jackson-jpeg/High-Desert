"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils/cn";

export function OfflineIndicator() {
  const [online, setOnline] = useState(true);
  const [showReconnect, setShowReconnect] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe: true on SSR, actual value on client
    setOnline(navigator.onLine);

    const handleOnline = () => {
      setOnline(true);
      setShowReconnect(true);
      setTimeout(() => setShowReconnect(false), 3000);
    };
    const handleOffline = () => {
      setOnline(false);
      setShowReconnect(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (online && !showReconnect) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed top-0 inset-x-0 z-50 text-center py-1.5 text-[11px] md:text-[10px] font-bold transition-colors duration-300",
        online
          ? "bg-static-green/20 text-static-green"
          : "bg-red-900/30 text-red-400",
      )}
    >
      {online
        ? "Back online"
        : "You are offline \u2014 cached episodes still available"}
    </div>
  );
}
