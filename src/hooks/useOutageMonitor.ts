"use client";

import { useEffect } from "react";
import { checkArchiveHealth, msUntilReprobe } from "@/services/archive/health";
import { hydrateManifest, loadManifest } from "@/services/mirror/manifest";
import { useOutageStore } from "@/stores/outage-store";

/**
 * Keeps outage mode current: probes archive.org's health once on load, then
 * again whenever the verdict's TTL lapses — every 30 s while it is down, so
 * the banner and the dimming clear on their own soon after it returns, and
 * every 5 minutes while it is up, so an outage that begins mid-visit is noticed
 * without anyone having to press play into it. A probe that could not reach
 * this server is retried after `MISS_RETRY_MS`.
 *
 * The mirror's manifest is read the moment outage mode begins; the fast fail
 * and the row marks need it, and a copy from an earlier visit is put in place
 * first so they work before it arrives.
 *
 * Mounted once, in `(desktop)/layout.tsx`.
 */

export const MISS_RETRY_MS = 30_000;

export function startOutageMonitor(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  hydrateManifest();

  const schedule = () => {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(tick, msUntilReprobe() || MISS_RETRY_MS);
  };

  async function tick() {
    if (stopped) return;
    await checkArchiveHealth();
    schedule();
  }

  // A background tab's timers are throttled; the verdict may have lapsed
  // while nobody was looking. Coming back is when someone is about to tap.
  const onVisible = () => {
    if (document.visibilityState === "visible" && msUntilReprobe() === 0) void tick();
  };

  const offStore = useOutageStore.subscribe((s, prev) => {
    if (s.archiveUp === false && prev.archiveUp !== false) void loadManifest({ force: true });
  });
  if (useOutageStore.getState().archiveUp === false) void loadManifest();

  document.addEventListener("visibilitychange", onVisible);
  void tick();

  return () => {
    stopped = true;
    clearTimeout(timer);
    offStore();
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export function useOutageMonitor(): void {
  useEffect(() => startOutageMonitor(), []);
}
