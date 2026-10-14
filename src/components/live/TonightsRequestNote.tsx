"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import type { LiveSchedule } from "@/lib/live/schedule";
import { REQUEST_LINE_PATH, tonightsRequest, tonightsRequestText } from "@/lib/live/request-line";
import type { Look } from "@/lib/look/look";

/**
 * "Tonight's request at 10 PM" on the Live screen (docs/request-line.md):
 * under the phone's strip, and in the desktop console under its top row. The
 * whole note is one link to the Request Line. Read from the published
 * program (`tonightsRequest`), so it says what the station will play: open
 * for votes until 6 PM Pacific, then the pick and who asked for it, or a fan
 * favorite on a night nobody nominated. Gone once the request has aired.
 */
export function TonightsRequestNote({ schedule, now, look = "night", phone = false }: { schedule: LiveSchedule; now: number; look?: Look; phone?: boolean }) {
  const note = tonightsRequest(schedule.guide, schedule.day, now);
  const text = tonightsRequestText(note);
  if (!text) return null;
  return (
    <Link
      href={REQUEST_LINE_PATH}
      data-testid="live-request-note"
      data-state={note.state}
      className={cn(
        "flex items-center gap-2 min-h-touch md:min-h-0 px-3 py-1.5 text-hd-caption text-desktop-gray hover:text-desert-amber",
        phone ? "w98-inset-dark bg-inset-well" : "bg-inset-well border-b border-bevel-dark/20",
        phone && look === "night" && "rounded-xl",
      )}
    >
      <span className="shrink-0 text-hd-micro uppercase tracking-[0.18em] text-desert-amber">Request Line</span>
      <span className="min-w-0">{text}</span>
    </Link>
  );
}
