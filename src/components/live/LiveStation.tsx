"use client";

import { useState } from "react";
import { Window } from "@/components/win98";
import { cn } from "@/lib/utils/cn";
import { formatAirDate } from "@/lib/utils/format";
import { formatCountdown, formatStationTime } from "@/lib/live/format";
import { upcoming, knownSlots, type LiveSchedule, type ProgramSlot } from "@/lib/live/schedule";
import { useLiveStore } from "@/stores/live-store";
import { usePlayerStore } from "@/stores/player-store";
import { tuneIn, tuneOut } from "@/audio/live-controller";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { onAirAt, useLiveSchedule, useStationClock } from "@/hooks/useLiveStation";
import { useCommunityNow } from "@/hooks/useCommunityNow";
import { presenceAttrs } from "@/services/stats/now-feed";
import { OnAirLamp } from "./OnAirLamp";
import { KIND_LABEL, ProgramGuide } from "./ProgramGuide";
import { LiveChat } from "./LiveChat";
import { LiveChatSheet } from "./LiveChatSheet";

/**
 * The Live screen: a late-night studio. The ON AIR sign, the wall clock, the
 * show on the air and how long it has left, what is next, the day's log, how
 * many people are tuned in — and the phone lines, beside the console on
 * desktop and behind a button (a sheet) on a phone.
 *
 * Every number that moves is computed from the published schedule and the
 * synced clock (`useStationClock`), never from the player's element — the
 * screen shows the station whether or not this browser is tuned in to it.
 */
export function LiveStation() {
  const schedule = useLiveSchedule();
  const isMobile = useIsMobile();
  const [linesOpen, setLinesOpen] = useState(false);

  return (
    <div className="h-full min-h-0 p-2 md:p-3 overflow-auto md:overflow-hidden">
      <div
        className={cn(
          "grid gap-3 min-h-full md:h-full",
          "md:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]",
        )}
      >
        <Window title="High Desert Live — Studio" variant="dark" headingLevel={2} className="flex flex-col min-h-0">
          {schedule ? <Console schedule={schedule} /> : <OffAir />}
        </Window>

        {isMobile ? (
          <button
            type="button"
            onClick={() => setLinesOpen(true)}
            className={cn(
              // First on a phone: below the studio it sat under the tab bar,
              // where nobody would find the phone lines.
              "order-first w98-raised-dark bg-raised-surface min-h-touch px-4 flex items-center justify-between gap-3 cursor-pointer",
              "w98-font text-hd-body text-desktop-gray",
            )}
          >
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-static-green animate-on-air" aria-hidden="true" />
              Phone lines are open
            </span>
            <span className="text-hd-caption text-desert-amber uppercase tracking-[0.18em]">Call in</span>
          </button>
        ) : (
          <Window title="Phone Lines" variant="dark" headingLevel={2} className="flex flex-col min-h-0">
            <div className="flex-1 min-h-0 flex flex-col">
              <LiveChat />
            </div>
          </Window>
        )}
      </div>
      {isMobile && (
        <LiveChatSheet open={linesOpen} onClose={() => setLinesOpen(false)}>
          <LiveChat />
        </LiveChatSheet>
      )}
    </div>
  );
}

function OffAir() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center min-h-[200px]">
      <OnAirLamp lit={false} size="lg" />
      <p className="text-hd-body text-bevel-dark">Warming up the transmitter…</p>
    </div>
  );
}

/** The console. Re-renders once a second — it is the clock. */
function Console({ schedule }: { schedule: LiveSchedule }) {
  const now = useStationClock(1000);
  const tuned = useLiveStore((s) => s.tuned);
  const phase = useLiveStore((s) => s.phase);
  const playing = usePlayerStore((s) => s.playing);
  const on = onAirAt(schedule, now);
  const slot = on && "slot" in on ? on.slot : null;
  const next = upcoming(knownSlots(schedule), now)[0] ?? null;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Top of the console: the sign, the wall clock, who is listening. */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 bg-inset-well border-b border-bevel-dark/20">
        <OnAirLamp lit={!!slot} tuned={tuned} size="lg" />
        <div className="flex flex-col items-end">
          <span
            data-testid="live-clock"
            className="w98-font text-hd-h2 text-phosphor-amber tabular-nums leading-none"
          >
            {formatStationTime(now)}
          </span>
          <span className="text-hd-micro text-bevel-dark uppercase tracking-[0.2em]">Pacific · Station time</span>
        </div>
        <Listeners />
      </div>

      {schedule.outage && (
        <p className="px-3 py-1.5 text-hd-caption text-desert-amber bg-inset-well border-b border-bevel-dark/20">
          archive.org is down. The station is playing from the High Desert mirror.
        </p>
      )}

      <div className="px-3 py-3 flex flex-col gap-3">
        {slot ? <NowPlaying slot={slot} now={now} /> : <StationBreak until={on?.endsAt ?? now} now={now} />}

        <div className="flex flex-wrap items-center gap-3">
          {tuned ? (
            <button
              type="button"
              onClick={() => tuneOut()}
              className="w98-raised-dark bg-raised-surface text-desktop-gray w98-font text-hd-body px-4 min-h-touch md:min-h-0 md:py-1.5 cursor-pointer"
            >
              Leave the station
            </button>
          ) : (
            <button
              type="button"
              onClick={() => tuneIn()}
              data-testid="live-tune-in"
              className="w98-raised-dark bg-raised-surface text-desert-amber w98-font text-hd-title px-5 min-h-touch md:min-h-0 md:py-1.5 cursor-pointer"
            >
              Tune in
            </button>
          )}
          <VuMeter live={tuned && (playing || phase === "station-id")} />
          <span className="text-hd-caption text-bevel-dark">
            {tuned
              ? phase === "station-id"
                ? "Station identification…"
                : "You're listening live, with everyone else."
              : "Everyone tuned in hears the same second."}
          </span>
        </div>

        {next && <UpNext slot={next} />}
      </div>

      <div className="flex-1 min-h-[160px] overflow-auto border-t border-bevel-dark/20 bg-card-surface">
        <h3 className="sticky top-0 z-10 px-3 py-1.5 bg-raised-surface w98-font text-hd-caption uppercase tracking-[0.2em] text-bevel-dark">
          Tonight&apos;s log · {schedule.day}
        </h3>
        <ProgramGuide slots={schedule.guide} now={now} />
      </div>
    </div>
  );
}

function NowPlaying({ slot, now }: { slot: ProgramSlot; now: number }) {
  const elapsed = Math.max(0, (now - slot.start) / 1000);
  const length = (slot.end - slot.start) / 1000;
  const left = Math.max(0, (slot.end - now) / 1000);
  const pct = length > 0 ? Math.min(100, (elapsed / length) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5" data-testid="live-now">
      <span className="text-hd-micro uppercase tracking-[0.2em] text-static-green">
        Now playing · {KIND_LABEL[slot.kind]}
      </span>
      <span data-testid="live-now-title" className="text-hd-h3 md:text-hd-h2 text-desktop-gray leading-tight">
        {slot.title}
      </span>
      <span className="text-hd-body text-bevel-dark">
        {[slot.guestName, slot.airDate ? `Originally aired ${formatAirDate(slot.airDate)}` : null]
          .filter(Boolean)
          .join(" · ")}
      </span>
      <div className="flex items-center gap-3 mt-1">
        <span className="text-hd-caption tabular-nums text-bevel-dark w98-font">{formatCountdown(elapsed)}</span>
        <div
          className="flex-1 h-[10px] w98-inset-dark bg-inset-well"
          role="progressbar"
          aria-label="Show progress"
          aria-valuemin={0}
          aria-valuemax={Math.round(length)}
          aria-valuenow={Math.round(elapsed)}
        >
          <div className="h-full bg-desert-amber" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-hd-caption tabular-nums text-desert-amber w98-font" data-testid="live-time-left">
          −{formatCountdown(left)}
        </span>
      </div>
      <span className="text-hd-micro text-bevel-dark/85">
        Time left {formatCountdown(left)} · ends {formatStationTime(slot.end)} PT
      </span>
    </div>
  );
}

function StationBreak({ until, now }: { until: number; now: number }) {
  return (
    <div className="flex flex-col gap-1" data-testid="live-now">
      <span className="text-hd-micro uppercase tracking-[0.2em] text-static-green">Station break</span>
      <span data-testid="live-now-title" className="text-hd-h3 text-desktop-gray">
        You&apos;re listening to High Desert
      </span>
      <span className="text-hd-caption tabular-nums text-desert-amber" data-testid="live-time-left">
        Next show in {formatCountdown((until - now) / 1000)}
      </span>
    </div>
  );
}

function UpNext({ slot }: { slot: ProgramSlot }) {
  return (
    <div data-testid="live-up-next" className="w98-inset-dark bg-inset-well px-3 py-2 flex flex-col gap-0.5">
      <span className="text-hd-micro uppercase tracking-[0.2em] text-bevel-dark">
        Up next · {formatStationTime(slot.start)} PT
      </span>
      <span className="text-hd-body text-desktop-gray truncate">{slot.title}</span>
      {(slot.guestName || slot.airDate) && (
        <span className="text-hd-micro text-bevel-dark truncate">
          {[slot.guestName, slot.airDate ? formatAirDate(slot.airDate) : null].filter(Boolean).join(" · ")}
        </span>
      )}
    </div>
  );
}

/** The live count, from the one presence feed — the same poll as every other surface. */
function Listeners() {
  const now = useCommunityNow();
  return (
    <span
      className="flex items-center gap-2 text-hd-caption text-bevel-dark tabular-nums"
      data-testid="live-listeners"
      {...presenceAttrs("live", now)}
    >
      <span className="w-2 h-2 rounded-full bg-static-green animate-on-air" aria-hidden="true" />
      <span>
        <span className="text-static-green">{now.live}</span> tuned in live
      </span>
      <span aria-hidden="true">·</span>
      <span>{now.online} online</span>
    </span>
  );
}

/** A VU meter that dances while the station is in your ears. Decorative. */
function VuMeter({ live }: { live: boolean }) {
  return (
    <span className="flex items-end gap-[2px] h-[18px]" aria-hidden="true">
      {[6, 12, 9, 16, 11, 7].map((h, i) => (
        <span
          key={i}
          className={cn("w-[3px]", live ? `bg-static-green animate-signal-${(i % 4) + 1}` : "bg-bevel-dark/40")}
          style={{ height: `${h}px` }}
        />
      ))}
    </span>
  );
}
