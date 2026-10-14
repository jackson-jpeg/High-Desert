"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import type { LiveSchedule } from "@/lib/live/schedule";
import { PICK_A_SHOW, REQUEST_LINE_LABEL, REQUEST_LINE_PATH, tonightsRequest, tonightsRequestText } from "@/lib/live/request-line";
import { useRequestPicks } from "@/hooks/useRequestPicks";
import type { Look } from "@/lib/look/look";

/**
 * "Tonight's request at 10 PM" on the Live screen (docs/request-line.md).
 * Read from the published program (`tonightsRequest`), so it says what the
 * station will play: open for votes until 6 PM Pacific (with how many shows
 * are in the running, once there is one), then the pick and who asked for
 * it, or a fan favorite on a night nobody nominated. Gone once the request
 * has aired.
 *
 * On a desktop it is one link in the console under its top row. On a phone
 * (2026-10-14) it sits right under the hero's Listen live, as a card with
 * its own "Pick a show" button: below the calls and the clock it went
 * unseen.
 */
export function TonightsRequestNote({ schedule, now, look = "night", phone = false }: { schedule: LiveSchedule; now: number; look?: Look; phone?: boolean }) {
  const note = tonightsRequest(schedule.guide, schedule.day, now);
  const picks = useRequestPicks(schedule.day, note.state === "voting");
  const text = tonightsRequestText(note, picks);
  if (!text) return null;
  const label = <span className="shrink-0 text-hd-micro uppercase tracking-[0.18em] text-desert-amber">{REQUEST_LINE_LABEL}</span>;

  if (!phone) {
    return (
      <Link
        href={REQUEST_LINE_PATH}
        data-testid="live-request-note"
        data-state={note.state}
        data-picks={picks ?? undefined}
        className="flex items-center gap-2 min-h-touch md:min-h-0 px-3 py-1.5 text-hd-caption text-desktop-gray hover:text-desert-amber bg-inset-well border-b border-bevel-dark/20"
      >
        {label}
        <span className="min-w-0">{text}</span>
      </Link>
    );
  }

  return (
    <section
      data-testid="live-request-note"
      data-state={note.state}
      data-picks={picks ?? undefined}
      aria-label={REQUEST_LINE_LABEL}
      className={cn(
        "w98-inset-dark bg-inset-well px-3 py-2 flex items-center gap-3 min-w-0",
        look === "night" && "rounded-xl",
      )}
    >
      <p className="flex-1 min-w-0 flex flex-col gap-0.5 text-hd-caption text-desktop-gray">
        {label}
        <span>{text}</span>
      </p>
      <Link
        href={REQUEST_LINE_PATH}
        data-testid="live-request-pick"
        className={cn(
          "shrink-0 min-h-touch px-3 flex items-center text-hd-caption whitespace-nowrap",
          look === "win98"
            ? "w98-raised-dark bg-raised-surface w98-font text-desktop-gray"
            : "rounded-full border border-desert-amber/60 text-desert-amber active:bg-desert-amber/15",
        )}
      >
        {PICK_A_SHOW}
      </Link>
    </section>
  );
}
