"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Window } from "@/components/win98";
import { cn } from "@/lib/utils/cn";
import { formatAirDate } from "@/lib/utils/format";
import { formatCountdown, formatStationTime, splitShowTitle } from "@/lib/live/format";
import { upcoming, knownSlots, type LiveSchedule, type ProgramSlot } from "@/lib/live/schedule";
import { airYear, showHook } from "@/lib/live/hook";
import { wantsPhoneLines } from "@/lib/live/phone-lines";
import { useLiveStore } from "@/stores/live-store";
import { usePlayerStore } from "@/stores/player-store";
import { leaveStation, tuneIn } from "@/audio/live-controller";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { onAirAt, useLiveSchedule, useStationClock } from "@/hooks/useLiveStation";
import { useCommunityNow } from "@/hooks/useCommunityNow";
import { useLiveChat } from "@/hooks/useLiveChat";
import { presenceAttrs } from "@/services/stats/now-feed";
import { db } from "@/db";
import { OnAirLamp } from "./OnAirLamp";
import { KIND_LABEL, ProgramGuide } from "./ProgramGuide";
import { TonightsRequestNote } from "./TonightsRequestNote";
import { LiveChat } from "./LiveChat";
import { LiveChatSheet } from "./LiveChatSheet";
import { noteFunnelStep } from "@/services/stats/funnel-client";
import { shownGuest } from "@/lib/library/guest";
import { ShowEpisode, ShowTitle } from "@/components/library/ShowTitle";
import { InstallPrompt } from "@/components/install/InstallPrompt";
import { useLook } from "@/hooks/useLook";
import type { Look } from "@/lib/look/look";

// Win98's phone lines (docs/looks.md).
import { NotepadPhoneLines } from "@/components/looks/win98/NotepadPhoneLines";
import { logTime } from "@/components/looks/win98/notepad-log";
import { isOwnCall } from "@/lib/live/chat-rows";

type Chat = ReturnType<typeof useLiveChat>;

/** How many of the latest calls a phone's Live screen shows before the sheet. */
export const PREVIEW_CALLS = 3;

/**
 * The Live screen: a late-night studio. The ON AIR sign, the wall clock, the
 * show on the air and how long it has left, what is next, the day's log, how
 * many people are tuned in, and the phone lines.
 *
 * On a desktop, the console and the phone lines side by side. On a phone
 * (docs/live-qa.md, "The phone's Live screen"), top down:
 *
 *   1. the show on the air (LiveHero): what it is, its guest and year, one
 *      line on why it is worth hearing, the time left, and one big button:
 *      Listen live, then (tuned in) Leave the station, or (held) Rejoin;
 *   2. the Request Line's note (TonightsRequestNote), with its own "Pick a
 *      show" button: tonight's 10 PM request (2026-10-14; it sat below the
 *      clock, where nobody saw it);
 *   3. the phone lines: a sticky "Phone lines are open" bar and the latest
 *      calls, one tap from the call box in its keyboard-safe sheet;
 *   4. the install card, when it applies;
 *   5. one strip (PhoneStudio): the station clock and what is next, then
 *      Tonight's log, whose on-air row is a marker. ON AIR and the show's
 *      title appear once on the screen, in the hero.
 *
 * Every number that moves is computed from the published schedule and the
 * synced clock (`useStationClock`), never from the player's element: the
 * screen shows the station whether or not this browser is tuned in to it.
 */
export function LiveStation() {
  const schedule = useLiveSchedule();
  const isMobile = useIsMobile();
  const [linesOpen, setLinesOpen] = useState(false);
  // The funnel's second step: the Live screen was on screen (docs/funnel.md).
  useEffect(() => noteFunnelStep("live"), []);
  const look = useLook();

  // "Phone Lines" anywhere (the phone's tab bar or taskbar, Win98's Start
  // menu, the app shortcut) is /live?lines=1: the sheet on a phone, the
  // cursor in the call box on a desktop (src/lib/live/phone-lines.ts).
  const openLines = useCallback(() => {
    if (isMobile) setLinesOpen(true);
    else document.querySelector<HTMLInputElement>('[data-testid="phone-lines"] input[aria-label="Your call"]')?.focus();
  }, [isMobile]);

  return (
    <div className="h-full min-h-0 p-2 md:p-3 overflow-auto md:overflow-hidden">
      <Suspense fallback={null}>
        <LinesIntentReader onLines={openLines} />
      </Suspense>
      <div
        className={cn(
          "grid gap-3 min-h-full md:h-full",
          // One column on a phone, and it may shrink: an implicit grid track
          // is sized to max-content, so the untruncated "Up next" title made
          // the studio 555 px wide at 390 and clipped the clock and the count.
          "grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]",
        )}
      >
        {isMobile ? (
          <PhoneLive schedule={schedule} look={look} linesOpen={linesOpen} setLinesOpen={setLinesOpen} />
        ) : (
          <>
            <Window title="High Desert Live · Studio" variant="dark" headingLevel={2} className="flex flex-col min-h-0">
              {schedule ? <Console schedule={schedule} /> : <OffAir />}
            </Window>
            {look === "win98" ? (
              <div id="phone-lines" className="flex flex-col min-h-0">
                <NotepadPhoneLines />
              </div>
            ) : (
              <Window title="Phone Lines" variant="dark" headingLevel={2} className="flex flex-col min-h-0">
                {/* h-full, not flex-1: the Window's body is a scrolling block,
                    not a flex column. As flex-1 the chat grew to its content, the
                    whole window scrolled instead of the list, and on a 900 px
                    desktop the call-in box started below the fold with the list
                    parked on the oldest call. */}
                <div className="h-full min-h-0 flex flex-col" data-testid="phone-lines-body">
                  <LiveChat />
                </div>
              </Window>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * `?lines=1`: open the phone lines, then take the parameter out of the
 * address bar (a replace, like a library intent), so a reload does not
 * reopen them and pressing Phone Lines again on /live opens them again.
 */
function LinesIntentReader({ onLines }: { onLines: () => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const latest = useRef(onLines);
  useEffect(() => {
    latest.current = onLines;
  }, [onLines]);
  const wants = wantsPhoneLines(params);
  useEffect(() => {
    if (!wants) return;
    latest.current();
    router.replace("/live", { scroll: false });
  }, [wants, router]);
  return null;
}

/**
 * The phone's Live screen. One stream to the phone lines for the page: the
 * preview of the latest calls and the sheet's chat share it, so opening the
 * sheet is instant and the room is joined once.
 */
function PhoneLive({
  schedule,
  look,
  linesOpen,
  setLinesOpen,
}: {
  schedule: LiveSchedule | null;
  look: Look;
  linesOpen: boolean;
  setLinesOpen: (open: boolean) => void;
}) {
  const chat = useLiveChat();
  const open = () => setLinesOpen(true);
  const close = () => setLinesOpen(false);
  return (
    <>
      {schedule ? <LiveHero schedule={schedule} look={look} /> : (
        <Window title="High Desert Live" variant="dark" headingLevel={2} className="order-first">
          <OffAir />
        </Window>
      )}

      {schedule && <PhoneRequestNote schedule={schedule} look={look} />}

      <button
        type="button"
        onClick={open}
        data-testid="live-call-in"
        className={cn(
          // Sticky, so no scroll of the column can carry it off the top
          // (2026-10-01: tuning in changes the card above it, and WebKit has
          // no scroll anchoring to hold the column's place).
          "sticky top-0 z-10 w98-raised-dark bg-raised-surface min-h-touch px-4 flex items-center justify-between gap-3 cursor-pointer",
          "w98-font text-hd-body text-desktop-gray",
        )}
      >
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-static-green animate-on-air" aria-hidden="true" />
          Phone lines are open
        </span>
        <span className="text-hd-caption text-desert-amber uppercase tracking-[0.18em]">Call in</span>
      </button>

      <LinesPreview chat={chat} look={look} onOpen={open} />

      <InstallPrompt />

      {schedule && <PhoneStudio schedule={schedule} look={look} />}

      <LiveChatSheet open={linesOpen} onClose={close}>
        {look === "win98" ? <NotepadPhoneLines chat={chat} onClose={close} /> : <LiveChat chat={chat} />}
      </LiveChatSheet>
    </>
  );
}

/**
 * The phone's Request Line card, under the hero. Its own clock, on a slow
 * tick: the note changes at 6 PM and when the request ends, never by the
 * second, so it does not re-render with the hero.
 */
function PhoneRequestNote({ schedule, look }: { schedule: LiveSchedule; look: Look }) {
  const now = useStationClock(15_000);
  return <TonightsRequestNote schedule={schedule} now={now} look={look} phone />;
}

function OffAir() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center min-h-[200px]">
      <OnAirLamp lit={false} size="lg" />
      <p className="text-hd-body text-bevel-dark">Warming up the transmitter…</p>
    </div>
  );
}

/** The catalog row for a show on the air: where its summary (the hook) lives. Null until the library has it. */
function useCatalogRow(fileHash: string | null) {
  return useLiveQuery(async () => {
    if (!fileHash) return null;
    try {
      return (await db.episodes.where("fileHash").equals(fileHash).first()) ?? null;
    } catch {
      return null;
    }
  }, [fileHash]);
}

/**
 * A phone's first screen (docs/funnel.md, docs/live-qa.md): the show on the
 * air and one big button. Not tuned in, the button is Listen live, and the
 * tap is `tuneIn()` itself, so the show starts inside the gesture (Safari's
 * rule). Tuned in, the same place holds Leave the station; held (paused, or
 * the phone refused the change of show), Rejoin live or Tap to rejoin.
 */
function LiveHero({ schedule, look }: { schedule: LiveSchedule; look: Look }) {
  const now = useStationClock(1000);
  const on = onAirAt(schedule, now);
  const slot = on && "slot" in on ? on.slot : null;
  const tuned = useLiveStore((s) => s.tuned);
  const row = useCatalogRow(slot?.fileHash ?? null);
  const hook = slot ? showHook({ fileHash: slot.fileHash, aiSummary: row?.aiSummary }) : null;
  return (
    <section
      data-testid="live-hero"
      aria-label="On the air"
      className={cn(
        "order-first w98-raised-dark bg-raised-surface flex flex-col gap-3 px-4 py-4",
        look === "night" && "rounded-xl",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <OnAirLamp lit={!!slot} tuned={tuned} size="sm" />
        <HeroCount />
      </div>
      {slot ? <NowPlaying slot={slot} now={now} hook={hook} phone /> : <StationBreak until={on?.endsAt ?? now} now={now} />}
      <StationControls phone look={look} slot={slot} />
    </section>
  );
}

/** "12 tuned in now", from the one presence feed. */
function HeroCount() {
  const presence = useCommunityNow();
  return (
    <span
      className="flex items-center gap-1.5 text-hd-caption text-static-green tabular-nums"
      data-testid="listen-count"
      {...presenceAttrs("live", presence)}
    >
      <span className="w-2 h-2 rounded-full bg-static-green animate-on-air" aria-hidden="true" />
      {presence.live} tuned in now
    </span>
  );
}

/**
 * The latest calls, on the first screen of a phone: the room is visible
 * without opening anything, and the whole card is the way into the call box
 * (the sheet, sized to what the iOS keyboard leaves). Not the chat itself:
 * no Report, no names to change; those are in the sheet.
 */
function LinesPreview({ chat, look, onOpen }: { chat: Chat; look: Look; onOpen: () => void }) {
  const calls = chat.messages.slice(-PREVIEW_CALLS);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="phone-lines-preview"
      aria-label="Open the phone lines: every call, and the call box"
      className={cn(
        "-mt-3 w98-raised-dark bg-raised-surface flex flex-col gap-2 px-3 pt-2 pb-3 text-left cursor-pointer",
        look === "night" && "rounded-b-xl",
      )}
    >
      <ol className={cn("flex flex-col gap-1.5 w-full", look === "win98" && "w98-inset-dark bg-inset-well p-1")} aria-hidden="true">
        {calls.length === 0 ? (
          <li className="text-hd-caption text-bevel-dark">The lines are open. Be the first caller tonight.</li>
        ) : (
          calls.map((m) => {
            const mine = isOwnCall(m, chat.mine, chat.you);
            return (
              <li
                key={m.id}
                data-testid="preview-call"
                data-mine={mine || undefined}
                className={cn(
                  "flex flex-col min-w-0 px-1.5 py-1 border-l-2",
                  mine ? "border-l-signal-blue bg-signal-blue/10" : "border-l-transparent",
                  look === "win98" ? "w98-font" : "rounded-md",
                )}
              >
                {/* The same head as a call in the lines: name bold, place and line quieter, time dimmer. */}
                <span className="flex flex-wrap items-baseline gap-x-2 min-w-0 text-hd-caption">
                  <span className="min-w-0 break-words">
                    <span className="font-bold text-desktop-gray" data-testid="caller-name">{m.name}</span>
                    <span className="italic text-bevel-dark" data-testid="caller-meta">
                      {m.place ? `, calling from ${m.place}` : `\u00A0\u00B7 ${m.line}`}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 text-hd-micro text-bevel-dark/85">{logTime(m.at)}</span>
                </span>
                <span className="text-hd-body text-desktop-gray line-clamp-2 break-words" data-testid="message-body">
                  {m.body}
                </span>
              </li>
            );
          })
        )}
      </ol>
      <span
        className={cn(
          "w-full min-h-touch flex items-center px-3 text-hd-title text-bevel-dark",
          look === "win98" ? "w98-inset-dark bg-inset-well w98-font" : "rounded-xl bg-inset-well/85",
        )}
        data-testid="live-call-box-open"
      >
        Call in…
      </span>
    </button>
  );
}

/** The desktop console. Re-renders once a second: it is the clock. A phone has the hero and `PhoneStudio` instead. */
function Console({ schedule }: { schedule: LiveSchedule }) {
  const now = useStationClock(1000);
  const tuned = useLiveStore((s) => s.tuned);
  const on = onAirAt(schedule, now);
  const slot = on && "slot" in on ? on.slot : null;
  const next = upcoming(knownSlots(schedule), now)[0] ?? null;
  const row = useCatalogRow(slot?.fileHash ?? null);
  const hook = slot ? showHook({ fileHash: slot.fileHash, aiSummary: row?.aiSummary }) : null;

  return (
    <div className="flex flex-col min-h-0 flex-1 md:h-full">
      {/* Top of the console: the sign, the wall clock, who is listening. */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 bg-inset-well border-b border-bevel-dark/20">
        <OnAirLamp lit={!!slot} tuned={tuned} size="lg" />
        <div className="flex flex-col items-end">
          <span data-testid="live-clock" className="w98-font text-phosphor-amber tabular-nums leading-none text-hd-h2">
            {formatStationTime(now)}
          </span>
          <span className="text-hd-micro text-bevel-dark uppercase tracking-[0.2em]">Pacific · Station time</span>
        </div>
        <Listeners />
      </div>

      <OutageNote schedule={schedule} />
      <TonightsRequestNote schedule={schedule} now={now} />

      <div className="px-3 py-3 flex flex-col gap-3">
        {slot ? <NowPlaying slot={slot} now={now} hook={hook} /> : <StationBreak until={on?.endsAt ?? now} now={now} />}
        <StationControls />
        {next && <UpNext slot={next} />}
      </div>

      <TonightsLog schedule={schedule} now={now} />
    </div>
  );
}

/**
 * A phone's studio, under the hero (2026-10-12): one row with the station
 * clock and what is next, then Tonight's log. The hero is the only place for
 * ON AIR, the show on the air and Listen live. This was a Studio window with
 * its own ON AIR lamp, and a log whose on-air row carried another lamp and the
 * title again, so the show was announced twice on one screen.
 */
function PhoneStudio({ schedule, look }: { schedule: LiveSchedule; look: Look }) {
  const now = useStationClock(1000);
  const next = upcoming(knownSlots(schedule), now)[0] ?? null;
  return (
    <>
      <div
        data-testid="live-strip"
        className={cn(
          "w98-inset-dark bg-inset-well min-h-touch px-3 py-1.5 flex items-center gap-3 min-w-0",
          look === "night" && "rounded-xl",
        )}
      >
        <span className="shrink-0 flex items-baseline gap-1">
          <span data-testid="live-clock" className="w98-font text-hd-title text-phosphor-amber tabular-nums leading-none">
            {formatStationTime(now)}
          </span>
          <span className="text-hd-micro text-bevel-dark uppercase tracking-[0.18em]">PT</span>
        </span>
        <span className="self-stretch w-px bg-bevel-dark/30" aria-hidden="true" />
        {next ? (
          <span data-testid="live-up-next" className="flex-1 min-w-0 flex items-baseline gap-2">
            <span className="shrink-0 text-hd-micro uppercase tracking-[0.18em] text-bevel-dark">
              Up next {formatStationTime(next.start)}
            </span>
            <ShowEpisode title={next.title} className="text-hd-caption text-desktop-gray" />
          </span>
        ) : (
          <span className="flex-1 min-w-0 text-hd-caption text-bevel-dark">The last show of the day</span>
        )}
      </div>
      <OutageNote schedule={schedule} />
      <TonightsLog schedule={schedule} now={now} phone look={look} />
    </>
  );
}

function OutageNote({ schedule }: { schedule: LiveSchedule }) {
  if (!schedule.outage) return null;
  return (
    <p className="px-3 py-1.5 text-hd-caption text-desert-amber bg-inset-well border-b border-bevel-dark/20">
      archive.org is down. The station is playing from the High Desert mirror.
    </p>
  );
}

/**
 * The day's program as a scrolling region a keyboard can reach: focusable, and
 * named by its heading. On a phone it stands on its own under the strip, and
 * its on-air row is a marker (the hero above has the show).
 */
function TonightsLog({ schedule, now, phone = false, look = "night" }: { schedule: LiveSchedule; now: number; phone?: boolean; look?: Look }) {
  const Heading = phone ? "h2" : "h3";
  return (
    <div
      data-testid="live-log"
      role="region"
      aria-labelledby="live-log-heading"
      tabIndex={0}
      className={cn(
        "flex-1 min-h-[160px] overflow-auto bg-card-surface focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal-blue",
        phone ? "w98-raised-dark" : "border-t border-bevel-dark/20",
        phone && look === "night" && "rounded-xl",
      )}
    >
      <Heading id="live-log-heading" className="sticky top-0 z-10 px-3 py-1.5 bg-raised-surface w98-font text-hd-caption uppercase tracking-[0.2em] text-bevel-dark">
        Tonight&apos;s log · {schedule.day}
      </Heading>
      <ProgramGuide slots={schedule.guide} now={now} marker={phone} />
    </div>
  );
}

/**
 * Tune in, rejoin, leave, and what the station is doing for you: the desktop
 * console's row, and on a phone the hero's one big button (Listen live, or
 * Rejoin) with Leave beneath it.
 */
function StationControls({ phone = false, look = "night", slot = null }: { phone?: boolean; look?: Look; slot?: ProgramSlot | null }) {
  const tuned = useLiveStore((s) => s.tuned);
  const phase = useLiveStore((s) => s.phase);
  const held = useLiveStore((s) => s.tuned && s.paused);
  const rejoin = useLiveStore((s) => s.tuned && s.paused && s.rejoin);
  const playing = usePlayerStore((s) => s.playing);
  // The big button: amber and round in Night, a large raised Win98 button in Win98.
  const big = cn(
    "w-full min-h-[56px] px-5 flex items-center justify-center gap-3 cursor-pointer w98-font text-hd-h3",
    look === "win98"
      ? "w98-raised-dark bg-raised-surface text-desktop-gray"
      : "rounded-full bg-desert-amber text-midnight font-bold shadow-[0_6px_20px_color-mix(in_srgb,var(--hd-amber)_35%,transparent)] active:scale-[0.98]",
  );
  const small = phone
    ? "w-full min-h-touch px-4 w98-raised-dark bg-raised-surface text-desktop-gray w98-font text-hd-body cursor-pointer"
    : "w98-raised-dark bg-raised-surface text-desktop-gray w98-font text-hd-body px-4 min-h-touch md:min-h-0 md:py-1.5 cursor-pointer";
  const { episode } = slot ? splitShowTitle(slot.title) : { episode: null };

  return (
    <div className={cn("flex flex-wrap items-center gap-3", phone && "flex-col items-stretch gap-2")}>
      {tuned ? (
        <>
          {held && (
            // Tuning in again is exactly "rejoin": the play path starts the
            // show that is on at the station's second, and the hold clears.
            <button
              type="button"
              onClick={() => tuneIn()}
              data-testid="live-rejoin"
              className={phone ? big : "w98-raised-dark bg-raised-surface text-desert-amber w98-font text-hd-title px-5 min-h-touch md:min-h-0 md:py-1.5 cursor-pointer"}
            >
              {rejoin ? "Tap to rejoin" : "Rejoin live"}
            </button>
          )}
          {phone && !held && <ListeningNow live={playing || phase === "station-id"} />}
          <button type="button" onClick={() => leaveStation()} className={small}>
            Leave the station
          </button>
        </>
      ) : (
        // On a phone, the hero's one way in; on a desktop, the console's.
        <button
          type="button"
          onClick={() => tuneIn()}
          data-testid="live-tune-in"
          aria-label={phone ? (episode ? `Listen live: ${episode}` : "Listen live") : undefined}
          className={phone ? big : "w98-raised-dark bg-raised-surface text-desert-amber w98-font text-hd-title px-5 min-h-touch md:min-h-0 md:py-1.5 cursor-pointer"}
        >
          {phone ? (
            <>
              <span aria-hidden="true" className={look === "win98" ? "text-desert-amber" : undefined}>
                {"▶"}
              </span>
              Listen live
            </>
          ) : (
            "Tune in"
          )}
        </button>
      )}
      <div className={cn("flex items-center gap-3", phone && "justify-center text-center")}>
        {!phone && <VuMeter live={tuned && !held && (playing || phase === "station-id")} />}
        <span className="text-hd-caption text-bevel-dark" data-testid="live-status">
          {tuned
            ? rejoin
              ? "Your phone stopped the station at the change of show. Tap to rejoin, or press play on the lock screen."
              : held
              ? "Paused. The station carries on; rejoin to hear where it is now."
              : phase === "station-id"
              ? "Station identification…"
              : "You're listening live, with everyone else."
            : "Everyone tuned in hears the same second."}
        </span>
      </div>
    </div>
  );
}

/** Tuned in on a phone: where the Listen button was, the station in your ears. */
function ListeningNow({ live }: { live: boolean }) {
  return (
    <div className="min-h-[56px] flex items-center justify-center gap-3 w98-inset-dark bg-inset-well" data-testid="live-listening">
      <VuMeter live={live} />
      <span className="w98-font text-hd-title text-static-green">On the air with you</span>
    </div>
  );
}

function NowPlaying({ slot, now, hook = null, phone = false }: { slot: ProgramSlot; now: number; hook?: string | null; phone?: boolean }) {
  const elapsed = Math.max(0, (now - slot.start) / 1000);
  const length = (slot.end - slot.start) / 1000;
  const left = Math.max(0, (slot.end - now) / 1000);
  const pct = length > 0 ? Math.min(100, (elapsed / length) * 100) : 0;
  const { show, episode } = splitShowTitle(slot.title);
  const guest = shownGuest(slot);
  // On a phone: the guest and the year, short. On a desktop, the full date.
  const meta = phone
    ? [guest ? `with ${guest}` : null, airYear(slot.airDate)].filter(Boolean).join(" · ")
    : [guest, slot.airDate ? `Originally aired ${formatAirDate(slot.airDate)}` : null].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-1.5" data-testid="live-now">
      <span className="text-hd-micro uppercase tracking-[0.2em] text-static-green" data-testid="live-now-show">
        Now playing · {show ?? KIND_LABEL[slot.kind]}
      </span>
      <h2 data-testid="live-now-title" className={cn("text-desktop-gray leading-tight", phone ? "text-hd-h2" : "text-hd-h3 md:text-hd-h2")}>
        {episode}
      </h2>
      {meta && (
        <span className={cn(phone ? "text-hd-title" : "text-hd-body", "text-bevel-dark")} data-testid="live-now-meta">
          {meta}
        </span>
      )}
      {hook && (
        <p className="text-hd-body text-desktop-gray line-clamp-2" data-testid="live-hook">
          {hook}
        </p>
      )}
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
      <h2 data-testid="live-now-title" className="text-hd-h3 text-desktop-gray">
        You&apos;re listening to High Desert
      </h2>
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
      <ShowTitle title={slot.title} className="text-hd-body text-desktop-gray" />
      {(shownGuest(slot) || slot.airDate) && (
        <span className="text-hd-micro text-bevel-dark truncate">
          {[shownGuest(slot), slot.airDate ? formatAirDate(slot.airDate) : null].filter(Boolean).join(" · ")}
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
