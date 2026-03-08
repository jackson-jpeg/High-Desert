"use client";

import { useState, useEffect } from "react";

export function OfflineIndicator() {
  const [online, setOnline] = useState(true);
  const [showReconnect, setShowReconnect] = useState(false);
  const [archiveDown, setArchiveDown] = useState(false);

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

    const handleArchiveStatus = (e: Event) => {
      const { up } = (e as CustomEvent<{ up: boolean }>).detail;
      if (!up) {
        setArchiveDown(true);
      } else {
        setArchiveDown(false);
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("hd:archive-status", handleArchiveStatus);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("hd:archive-status", handleArchiveStatus);
    };
  }, []);

  // Auto-clear archive banner after 5 minutes (re-check will fire if still down)
  useEffect(() => {
    if (!archiveDown) return;
    const timer = setTimeout(() => setArchiveDown(false), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [archiveDown]);

  // Nothing to show
  if (online && !showReconnect && !archiveDown) return null;

  // Offline takes priority
  if (!online) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed top-0 inset-x-0 z-50 text-center py-1.5 text-hd-11 md:text-hd-10 font-bold bg-red-900/30 text-red-400"
      >
        You are offline &mdash; cached episodes still available
      </div>
    );
  }

  // Reconnected message
  if (showReconnect) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed top-0 inset-x-0 z-50 text-center py-1.5 text-hd-11 md:text-hd-10 font-bold bg-static-green/20 text-static-green transition-colors duration-300"
      >
        Back online
      </div>
    );
  }

  // Archive.org outage
  if (archiveDown) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed top-0 inset-x-0 z-50 text-center py-1.5 px-4 text-hd-11 md:text-hd-10 font-bold bg-desert-amber/15 text-desert-amber flex items-center justify-center gap-2"
      >
        <span>Archive.org is temporarily down &mdash; this is not a High Desert issue</span>
        <button
          onClick={() => setArchiveDown(false)}
          className="text-desert-amber/50 hover:text-desert-amber cursor-pointer text-hd-12 md:text-hd-10 ml-1"
          aria-label="Dismiss"
        >
          {"\u2715"}
        </button>
      </div>
    );
  }

  return null;
}
