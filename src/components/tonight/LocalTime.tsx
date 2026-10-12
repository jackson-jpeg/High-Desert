"use client";

import { useSyncExternalStore } from "react";

/**
 * A station time in Pacific (what the server sends, and what a reader without
 * JavaScript sees), then, once on the page, the reader's own time beside it
 * when their clock is somewhere else.
 */
const noSubscribe = () => () => {};

/** The reader's own time for `ms`, or null in Pacific (and on the server). */
export function readerTime(ms: number, zone = Intl.DateTimeFormat().resolvedOptions().timeZone): string | null {
  if (zone === "America/Los_Angeles") return null;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(ms));
}

export function LocalTime({ ms, pacific }: { ms: number; pacific: string }) {
  // The server (and hydration) render Pacific only; the client adds its own time after.
  const local = useSyncExternalStore(noSubscribe, () => readerTime(ms), () => null);
  return (
    <time dateTime={new Date(ms).toISOString()} className="hd-tonight-time tabular-nums">
      {pacific} PT
      {local ? <span className="hd-tonight-local text-bevel-dark"> ({local} your time)</span> : null}
    </time>
  );
}
