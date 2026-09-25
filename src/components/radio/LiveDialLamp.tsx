"use client";

import { cn } from "@/lib/utils/cn";
import { OnAirLamp } from "@/components/live/OnAirLamp";
import { tuneIn } from "@/audio/live-controller";
import { useLiveStore } from "@/stores/live-store";
import { useRadioDialStore } from "@/stores/radio-dial-store";
import type { ProgramSlot } from "@/lib/live/schedule";

const MS_PER_DAY = 86_400_000;

/**
 * Where a show sits on the dial: its air date as a day index from the
 * earliest station — the same arithmetic as the dial's own stations
 * (`dateToDayIndex` in useRadioDial), so the lamp lands on the show's tick.
 */
export function airDateDayIndex(airDate: string | null | undefined, earliest: Date): number | null {
  if (!airDate) return null;
  const d = new Date(`${airDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - earliest.getTime()) / MS_PER_DAY);
}

/**
 * The live station on the radio dial: an ON AIR lamp naming the show on the
 * air. Tapping it tunes in, and swings the needle to the show's place on the
 * dial, where the strip draws the station's marker (TuningStrip, `onAirDay`).
 */
export function LiveDialLamp({
  slot,
  earliest,
  className,
}: {
  slot: ProgramSlot | null;
  earliest: Date;
  className?: string;
}) {
  const tuned = useLiveStore((s) => s.tuned);
  if (!slot) return null;
  const day = airDateDayIndex(slot.airDate, earliest);
  return (
    <button
      type="button"
      data-testid="dial-on-air"
      onClick={(e) => {
        // The dial's own click handler initialises its static; this tap is
        // the station's, and must not also lock or scan the dial.
        e.stopPropagation();
        tuneIn();
        const dial = useRadioDialStore.getState();
        if (dial.scanning) dial.stopScan();
        if (day !== null) dial.setPosition(day);
      }}
      aria-label={
        tuned
          ? `On air: ${slot.title}. You are tuned in to the live station.`
          : `On air: ${slot.title}. Tune in to the live station.`
      }
      className={cn(
        "flex items-center gap-2 min-w-0 cursor-pointer min-h-touch md:min-h-0",
        "text-left select-none",
        className,
      )}
    >
      <OnAirLamp lit tuned={tuned} size="sm" />
      <span className="flex flex-col min-w-0">
        <span className="text-hd-micro uppercase tracking-[0.18em] text-bevel-dark">
          {tuned ? "Tuned in live" : "Live now · tap to tune in"}
        </span>
        <span className="text-hd-caption text-desktop-gray truncate">{slot.title}</span>
      </span>
    </button>
  );
}
