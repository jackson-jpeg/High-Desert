"use client";

import { useState, useEffect } from "react";
import { useOutageStore, selectOutage } from "@/stores/outage-store";

/** The outage banner's words. The chaos test and the unit tests read them from here. */
export const OUTAGE_BANNER_TEXT = "archive.org is down. Playing from the High Desert mirror.";

export function OfflineIndicator() {
  const [online, setOnline] = useState(true);
  const [showReconnect, setShowReconnect] = useState(false);
  // Outage mode, from the one store the rows, the filter and the play path
  // also read. It clears when a probe says archive.org is back — not on a
  // timer, which used to take the banner down after five minutes whether or
  // not anything had recovered.
  const outage = useOutageStore(selectOutage);
  // Dismissed for this outage only: a new outage shows it again.
  const [dismissed, setDismissed] = useState(false);
  const archiveDown = outage && !dismissed;

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the dismissal belongs to one outage
    if (!outage) setDismissed(false);
  }, [outage]);

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
        You are offline. Cached episodes are still available
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
        data-testid="outage-banner"
        className="fixed top-0 inset-x-0 z-50 text-center py-1 px-4 text-hd-11 md:text-hd-10 font-bold bg-desert-amber/15 text-desert-amber flex items-center justify-center gap-2"
      >
        <span>{OUTAGE_BANNER_TEXT}</span>
        <button
          onClick={() => setDismissed(true)}
          className="text-desert-amber/85 hover:text-desert-amber cursor-pointer text-hd-12 md:text-hd-10 ml-1"
          aria-label="Dismiss"
        >
          {"\u2715"}
        </button>
      </div>
    );
  }

  return null;
}
