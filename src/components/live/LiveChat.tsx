"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/win98/Button";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useCommunityNow } from "@/hooks/useCommunityNow";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useLiveChat } from "@/hooks/useLiveChat";
import {
  charCount,
  MAX_CHARS,
  suggestedPlace,
  tuneinText,
  type ArchiveLine,
  type LiveMessage,
} from "@/services/live/client";
import { chatRows, isOwnCall, listRows } from "@/lib/live/chat-rows";
import { followKeys, useFollowLog } from "@/hooks/useFollowLog";
import { useOpenLibraryIntent } from "@/hooks/useOpenLibraryIntent";
import { formatAirDate } from "@/lib/utils/format";
import { presenceAttrs } from "@/services/stats/now-feed";
import { HIDE_TUNEINS_KEY, FIRST_CALL_HINT_KEY, placeProblem, useCallBox, useHideTuneins } from "@/hooks/useCallBox";

// The call box's logic lives in useCallBox (shared with the Win98 look's Notepad).
export { HIDE_TUNEINS_KEY, FIRST_CALL_HINT_KEY, placeProblem };

/**
 * The phone lines: the live broadcast's chat (services/live, docs/live-chat.md).
 *
 * Every message is a call, its own block: the caller's name in bold, then
 * ", calling from Ghent" and the line ("Line 3", "West of the Rockies") in a
 * quieter gray, then the time, dimmer; the message below in normal weight.
 * Your own calls are tinted. Tune-ins are one small gray line each, and a run
 * of them folds into one ("3 new listeners tuned in", chatRows). Scrolled up,
 * new calls wait behind a "New calls below" button (useFollowLog).
 *
 * No props, and no chrome of its own: the Live screen (LiveStation) puts it
 * in the "Phone Lines" Win98 window beside the player on desktop, and in
 * LiveChatSheet on mobile, which sizes itself to the visual viewport. This
 * fills whatever box it is given — Win98 insets on desktop, glass on mobile —
 * and owns keeping its own input in view when the iOS keyboard comes up.
 *
 * The listener count is the site's one presence number (`useCommunityNow`,
 * `/api/stats/now`'s `live` field), never a count of chat connections. It is
 * shown twice: in the header, and right beside the call box, where someone
 * decides whether to speak.
 *
 * A caller can say where they are calling from ("Night Owl, calling from
 * Ghent"). The call box offers it on a first call, suggested from the
 * browser's time zone and nothing else; the header changes or clears it.
 * Tune-ins are quiet lines among the calls ("A listener just tuned in from
 * Ohio"), batched by the service, and a listener can hide them.
 *
 * Archive lines (2026-10-11) are moments from the show's history the service
 * posts into a quiet room, at most one an hour (services/live/lib/archive.mjs).
 * They are drawn as a card marked "From the archive", never as a call: no
 * line label, no caller name, no Report. One from a show in the catalog links
 * to it in the library.
 */

type Chat = ReturnType<typeof useLiveChat>;
type Variant = "w98" | "glass";
type Presence = ReturnType<typeof useCommunityNow> & { live?: number };
const MAX_NAME = 32;
const MAX_PLACE = 32;

/**
 * `chat`: a stream the caller already holds. The phone's Live screen opens
 * one for its preview of the latest calls and hands the same one to the
 * sheet, so the room is joined once (one stream per mounted chat). Without
 * it, the chat opens its own.
 */
export function LiveChat({ chat }: { chat?: Chat } = {}) {
  return chat ? <LiveChatView chat={chat} /> : <OwnLiveChat />;
}

function OwnLiveChat() {
  return <LiveChatView chat={useLiveChat()} />;
}

function LiveChatView({ chat }: { chat: Chat }) {
  const isMobile = useIsMobile();
  const variant: Variant = isMobile ? "glass" : "w98";
  const now = useCommunityNow() as Presence;
  const live = typeof now.live === "number" ? now.live : undefined;
  const [hideTuneins, toggleTuneins] = useHideTuneins();
  const inset = useKeyboardInset(isMobile);
  const composerRef = useRef<HTMLFormElement>(null);

  // The sheet lifts itself above the keyboard; within it, the composer must
  // be scrolled into what is left when the keyboard arrives or grows (Safari
  // also scrolls the visual viewport, which can leave the input under it).
  useEffect(() => {
    const form = composerRef.current;
    if (!inset || !form || !form.contains(document.activeElement)) return;
    form.scrollIntoView?.({ block: "nearest" });
  }, [inset]);

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col", variant === "w98" ? "gap-1" : "gap-2 px-3 pb-2")}
      data-testid="phone-lines"
      data-variant={variant}
      data-keyboard-inset={inset}
    >
      <LinesHeader chat={chat} live={live} variant={variant} hideTuneins={hideTuneins} onToggleTuneins={toggleTuneins} />
      <MessageList chat={chat} variant={variant} hideTuneins={hideTuneins} />
      <Composer chat={chat} variant={variant} formRef={composerRef} presence={now} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function ListenerCount({ live }: { live?: number }) {
  if (live === undefined) return null;
  return (
    <span className="flex items-center gap-1 text-hd-caption text-static-green" data-testid="live-listeners" data-live={live}>
      <span className="inline-block h-[8px] w-[8px] rounded-full bg-static-green animate-on-air" aria-hidden="true" />
      {live} tuned in live
    </span>
  );
}

function LinesHeader({
  chat,
  live,
  variant,
  hideTuneins,
  onToggleTuneins,
}: {
  chat: Chat;
  live?: number;
  variant: Variant;
  hideTuneins: boolean;
  onToggleTuneins: () => void;
}) {
  const [editing, setEditing] = useState<"name" | "place" | null>(null);
  const slow = chat.slowMode?.on;
  return (
    <div className={cn("flex flex-col gap-1", variant === "w98" ? "px-1" : "")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-hd-caption">
        <ListenerCount live={live} />
        <span className="text-bevel-dark" data-testid="live-status">
          {chat.status === "live" ? "On the air" : chat.status === "connecting" ? "Dialing in…" : "Reconnecting…"}
        </span>
        {slow && (
          <span className="text-desert-amber" data-testid="slow-mode">
            Slow mode: one call every {Math.round((chat.slowMode?.intervalMs ?? 10_000) / 1000)} s
          </span>
        )}
        {chat.you?.admin && <AdminSlowToggle chat={chat} />}
        <button
          type="button"
          onClick={onToggleTuneins}
          aria-pressed={hideTuneins}
          data-testid="toggle-tuneins"
          className="ml-auto text-hd-caption text-bevel-dark underline min-h-touch md:min-h-0 cursor-pointer"
        >
          {hideTuneins ? "Show tune-ins" : "Hide tune-ins"}
        </button>
      </div>
      {chat.you && !editing && (
        <p className="text-hd-caption text-bevel-dark" data-testid="you-row">
          <span>
            You&rsquo;re <span className="text-signal-blue font-bold" data-testid="you-name">{chat.you.name}</span> on{" "}
            <span className="text-phosphor-amber" data-testid="you-line">
              {chat.you.line}
            </span>
            {chat.you.place && (
              <>
                , calling from{" "}
                <span className="text-desktop-gray" data-testid="you-place">
                  {chat.you.place}
                </span>
              </>
            )}
          </span>{" "}
          {/* Two small words on one line, not two big buttons that wrap
              (2026-10-13). Each keeps a 44 px tap target (TextAction). */}
          <span className="inline-flex items-baseline gap-2 whitespace-nowrap" data-testid="you-actions">
            <TextAction onClick={() => setEditing("name")} testId="change-name">
              Change name
            </TextAction>
            <span aria-hidden="true">{"\u00B7"}</span>
            <TextAction onClick={() => setEditing("place")} testId="change-place">
              {chat.you.place ? "Change place" : "Add where you're calling from"}
            </TextAction>
          </span>
        </p>
      )}
      {chat.you && editing === "name" && <NameEditor chat={chat} variant={variant} onDone={() => setEditing(null)} />}
      {chat.you && editing === "place" && <PlaceEditor chat={chat} variant={variant} onDone={() => setEditing(null)} />}
    </div>
  );
}

function AdminSlowToggle({ chat }: { chat: Chat }) {
  const forced = !!chat.slowMode?.forced;
  return (
    <button
      type="button"
      className="text-hd-caption text-desert-amber underline min-h-touch md:min-h-0"
      data-testid="admin-slow"
      onClick={() => void chat.admin("slow", { on: !forced, minutes: 30 })}
    >
      {forced ? "End slow mode" : "Slow mode (30 min)"}
    </button>
  );
}

/**
 * Why a name cannot be saved, as the listener should read it — or
 * "unchanged", or null when it is worth asking the server (which has the
 * filter, uniqueness and the 10-minute rule, and says why in its own words).
 */
export function nameProblem(value: string, current: string): string | null | "unchanged" {
  const n = charCount(value);
  if (value.trim() === current.trim()) return "unchanged";
  if (n === 0) return "Type a name first.";
  if (n > MAX_NAME) return `Names can be at most ${MAX_NAME} characters.`;
  return null;
}

function NameEditor({ chat, variant, onDone }: { chat: Chat; variant: Variant; onDone: () => void }) {
  const [value, setValue] = useState(chat.you?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.select(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    // Checked here, and said, rather than by disabling Save: a disabled Save
    // with only a small "33/32" beside it was a button that did nothing.
    const local = nameProblem(value, chat.you?.name ?? "");
    if (local === "unchanged") {
      onDone();
      return;
    }
    if (local) {
      setError(local);
      return;
    }
    setBusy(true);
    const r = await chat.rename(value);
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.message);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1" aria-label="Change your caller name" data-testid="name-editor">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          maxLength={MAX_NAME * 2}
          aria-label="Caller name"
          enterKeyHint="done"
          autoComplete="off"
          className={inputClass(variant)}
        />
        <InlineButton variant={variant} type="submit" disabled={busy} testId="save-name">
          Save
        </InlineButton>
        <InlineButton variant={variant} onClick={onDone}>
          Cancel
        </InlineButton>
      </div>
      <p className="text-hd-micro text-bevel-dark/85">
        {charCount(value)}/{MAX_NAME} · once every 10 minutes
      </p>
      {error && (
        <p role="alert" className="text-hd-caption text-desert-amber" data-testid="name-error">
          {error}
        </p>
      )}
    </form>
  );
}

function PlaceEditor({ chat, variant, onDone }: { chat: Chat; variant: Variant; onDone: () => void }) {
  const current = chat.you?.place ?? null;
  const [value, setValue] = useState(() => current ?? suggestedPlace() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.select(), []);

  async function save(next: string) {
    if (busy) return;
    if (next.trim() === (current ?? "")) {
      onDone();
      return;
    }
    const local = placeProblem(next);
    if (local) {
      setError(local);
      return;
    }
    setBusy(true);
    const r = await chat.setPlace(next);
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.message);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(value);
      }}
      className="flex flex-col gap-1"
      aria-label="Where you're calling from"
      data-testid="place-editor"
    >
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          maxLength={MAX_PLACE * 2}
          aria-label="Calling from"
          placeholder="Your town"
          enterKeyHint="done"
          autoComplete="off"
          className={inputClass(variant)}
        />
        <InlineButton variant={variant} type="submit" disabled={busy} testId="save-place">
          Save
        </InlineButton>
        {current && (
          <InlineButton variant={variant} onClick={() => void save("")} disabled={busy} testId="clear-place">
            Clear
          </InlineButton>
        )}
        <InlineButton variant={variant} onClick={onDone}>
          Cancel
        </InlineButton>
      </div>
      <p className="text-hd-micro text-bevel-dark/85">
        Optional. Shown after your name. Changes once every 10 minutes; clear it any time.
      </p>
      {error && (
        <p role="alert" className="text-hd-caption text-desert-amber" data-testid="place-error">
          {error}
        </p>
      )}
    </form>
  );
}

// The rows are shared with the Win98 Notepad and the phone's preview (src/lib/live/chat-rows.ts).
export { listRows };

function MessageList({ chat, variant, hideTuneins }: { chat: Chat; variant: Variant; hideTuneins: boolean }) {
  const rows = chatRows(chat.messages, hideTuneins ? [] : chat.notices, chat.archive);
  const keys = followKeys(rows);
  const last = chat.messages[chat.messages.length - 1];
  const lastIsMine = !!last && isOwnCall(last, chat.mine, chat.you) && keys.alert === `c${last.id}`;
  // Follow new calls only while the listener is at the bottom: scrolling back
  // through the night must not be yanked away by the next message.
  const { ref, onScroll, unseen, jump } = useFollowLog<HTMLOListElement>(keys.follow, keys.alert, lastIsMine);

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <ol
        ref={ref}
        onScroll={onScroll}
        aria-live="polite"
        aria-label="Calls"
        data-testid="live-messages"
        className={cn(
          "flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-2",
          variant === "w98" ? "w98-inset-dark bg-inset-well p-1.5" : "rounded-xl bg-inset-well/85 p-2",
        )}
      >
        {chat.messages.length === 0 && (
          <li className="text-hd-caption text-bevel-dark p-2">The lines are open. Be the first caller tonight.</li>
        )}
        {rows.map((r) =>
          r.kind === "call" ? (
            <MessageRow key={r.m.id} m={r.m} chat={chat} variant={variant} />
          ) : r.kind === "archive" ? (
            <ArchiveRow key={`a-${r.a.at}-${r.a.id}`} a={r.a} variant={variant} />
          ) : (
            <li
              key={`t-${r.key}`}
              data-testid="tunein-notice"
              data-merged={r.merged}
              title={tuneinText(r.n)}
              className="px-2 text-hd-micro text-bevel-dark truncate"
            >
              {tuneinText(r.n)}
            </li>
          ),
        )}
      </ol>
      {unseen && (
        <button
          type="button"
          onClick={jump}
          data-testid="new-calls"
          className={cn(
            "absolute bottom-2 left-1/2 -translate-x-1/2 min-h-touch md:min-h-0 px-3 py-1 text-hd-caption cursor-pointer",
            "bg-raised-surface text-desktop-gray shadow-lg",
            variant === "w98" ? "w98-raised-dark" : "rounded-full border border-signal-blue/60",
          )}
        >
          New calls below <span aria-hidden="true">{"\u2193"}</span>
        </button>
      )}
    </div>
  );
}

/** A moment from the show's history: a card, never a call. */
export function ArchiveRow({ a, variant }: { a: ArchiveLine; variant: Variant }) {
  const openLibrary = useOpenLibraryIntent();
  const time = new Date(a.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const quote = a.form === "quote";
  return (
    <li
      data-testid="archive-line"
      data-form={a.form}
      data-reason={a.reason}
      className={cn(
        "ml-4 mr-1 my-1 flex flex-col gap-1 border border-static-green/60 border-l-4 border-l-static-green bg-raised-surface px-3 py-2",
        variant === "glass" && "rounded-lg",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-hd-micro font-bold uppercase tracking-wider text-static-green" data-testid="archive-label">
          {a.reason === "on-air" ? "From the archive: this show" : "From the archive"}
        </span>
        <time className="ml-auto shrink-0 text-hd-micro text-bevel-dark/85" dateTime={a.at}>
          {time}
        </time>
      </div>
      <p className="text-hd-body italic text-desktop-gray break-words" data-testid="archive-text">
        {quote ? `\u201C${a.text}\u201D` : a.text}
        {quote && a.speaker && <span className="text-bevel-dark">{` (${a.speaker})`}</span>}
      </p>
      {a.episode && (
        <button
          type="button"
          onClick={() => openLibrary({ q: a.episode!.title })}
          className="self-start inline-flex items-center min-h-touch md:min-h-0 text-hd-micro text-signal-blue underline underline-offset-2"
          data-testid="archive-episode"
        >
          {`Find the show: ${formatAirDate(a.episode.airDate)}`}
        </button>
      )}
    </li>
  );
}

function MessageRow({ m, chat, variant }: { m: LiveMessage; chat: Chat; variant: Variant }) {
  const mine = isOwnCall(m, chat.mine, chat.you);
  const reported = chat.reported.includes(m.id);
  const time = new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <li
      data-testid="live-message"
      data-id={m.id}
      data-mine={mine || undefined}
      className={cn(
        "flex flex-col gap-0.5 px-2 py-1.5 border-l-2",
        mine ? "border-l-signal-blue bg-signal-blue/10" : "border-l-transparent",
        variant === "glass" && "rounded-lg",
      )}
    >
      {/* First line: who (bold), their line and place (quieter), when (dimmer).
          It wraps rather than truncates, so a long name never runs into a place. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0 min-w-0" data-testid="call-head">
        <span className="min-w-0 break-words text-hd-caption">
          <span className={cn("font-bold", mine ? "text-signal-blue" : "text-desktop-gray")} data-testid="caller-name">
            {m.name}
          </span>
          {m.place && (
            <span className="text-bevel-dark" data-testid="caller-place">
              , calling from {m.place}
            </span>
          )}
          <span className="text-bevel-dark">
            {"\u00A0\u00B7 "}
            <span data-testid="line-label">{m.line}</span>
          </span>
          {mine && <span className="sr-only"> (your call)</span>}
        </span>
        <span className="ml-auto flex shrink-0 items-baseline gap-2">
          <time className="text-hd-micro text-bevel-dark/85" dateTime={m.at} data-testid="call-time">
            {time}
          </time>
          {!mine &&
            (reported ? (
              <span className="text-hd-micro text-bevel-dark/85" data-testid="reported">
                Reported
              </span>
            ) : (
              <ReportLink onClick={() => void chat.report(m.id)} label={`Report call from ${m.name}`} />
            ))}
        </span>
      </div>
      <p className="text-hd-body font-normal text-desktop-gray break-words whitespace-pre-wrap" data-testid="message-body">
        {m.body}
      </p>
      <div className="flex flex-wrap gap-2 empty:hidden">
        {chat.you?.admin && (
          <span className="flex flex-wrap gap-2" data-testid="admin-controls">
            <InlineButton variant={variant} onClick={() => void chat.admin("hide", { messageId: m.id })}>
              Hide
            </InlineButton>
            <InlineButton variant={variant} onClick={() => void chat.admin("mute", { messageId: m.id, minutes: 10 })}>
              Mute 10 min
            </InlineButton>
            <InlineButton variant={variant} onClick={() => void chat.admin("clear-name", { messageId: m.id })}>
              Clear name
            </InlineButton>
            <InlineButton
              variant={variant}
              onClick={() => {
                if (window.confirm(`Disconnect ${m.name} for good?`)) void chat.admin("ban", { messageId: m.id });
              }}
            >
              Ban
            </InlineButton>
          </span>
        )}
      </div>
    </li>
  );
}

function Composer({
  chat,
  variant,
  formRef,
  presence,
}: {
  chat: Chat;
  variant: Variant;
  formRef: RefObject<HTMLFormElement | null>;
  presence: Presence;
}) {
  const { hint, offerPlace, place, setPlace, text, setText, error, setError, sending, wait, inputRef, n, over, banned, submit } =
    useCallBox(chat);
  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-1" data-testid="composer">
      {hint && (
        <p className="text-hd-caption text-phosphor-amber" data-testid="first-call-hint">
          First call? Say hello. Everyone tuned in hears it.
        </p>
      )}
      {offerPlace && (
        <label className="flex items-center gap-2 text-hd-caption text-bevel-dark">
          <span className="shrink-0">Calling from</span>
          <input
            value={place}
            onChange={(e) => {
              setPlace(e.target.value);
              setError(null);
            }}
            maxLength={MAX_PLACE * 2}
            placeholder="Optional"
            aria-label="Calling from (optional)"
            data-testid="first-call-place"
            enterKeyHint="next"
            autoComplete="off"
            className={inputClass(variant)}
          />
        </label>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (!wait) setError(null);
          }}
          // Never the caller's name: a name can be 32 characters, and "Call in
          // as Short-Wave Listener in Hawthorn" was cut off at 390 wide and on
          // desktop. The name is in the header right above.
          placeholder="Call in…"
          aria-label="Your call"
          aria-invalid={over || undefined}
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="on"
          disabled={banned}
          className={inputClass(variant)}
        />
        <InlineButton
          variant={variant}
          type="submit"
          disabled={!n || over || sending || wait > 0 || banned}
          testId="send"
          big
        >
          {wait > 0 ? `${wait}s` : "Call in"}
        </InlineButton>
      </div>
      <div className="flex items-center justify-between gap-2 text-hd-micro">
        <span
          data-testid="char-count"
          className={cn(over ? "text-desert-amber font-bold" : "text-bevel-dark/85")}
        >
          {n}/{MAX_CHARS}
        </span>
        {typeof presence.live === "number" && (
          // Where someone decides whether to speak: who would hear it. The one
          // presence feed, tagged like every other surface that shows it.
          <span
            className="flex items-center gap-1 text-static-green"
            data-testid="call-box-listeners"
            {...presenceAttrs("live", presence)}
          >
            <span className="inline-block h-[6px] w-[6px] rounded-full bg-static-green animate-on-air" aria-hidden="true" />
            {presence.live} tuned in now
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-hd-caption text-desert-amber" data-testid="live-rejection">
          {error}
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------

/** 16px or more on every input: iOS zooms the page into anything smaller. */
function inputClass(variant: Variant) {
  return cn(
    "flex-1 min-w-0 text-hd-title min-h-touch outline-none",
    variant === "w98"
      ? "w98-font w98-inset-dark bg-inset-well text-desktop-gray placeholder:text-bevel-dark px-2 py-1"
      : "rounded-xl bg-inset-well/85 text-desktop-gray placeholder:text-bevel-dark px-3 py-2",
  );
}

/**
 * Report, beside the timestamp: a quiet word, not a button under every call
 * (2026-10-01: a full 44 px button under each line made the room read as a
 * form). The tap target is still 44 x 44, from a centred ::after that adds
 * nothing to the layout; calls are taller than 44 px apart, so two targets
 * never overlap.
 */
function ReportLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="report"
      aria-label={label}
      className={cn(
        "relative shrink-0 text-hd-micro text-bevel-dark/85 cursor-pointer",
        "hover:text-desktop-gray hover:underline active:text-desktop-gray",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal-blue",
        "after:content-[''] after:absolute after:left-1/2 after:top-1/2 after:-translate-x-1/2 after:-translate-y-1/2",
        "after:w-full after:h-full after:min-w-touch after:min-h-touch",
      )}
    >
      Report
    </button>
  );
}

/**
 * A small text button inside a sentence ("Change name"), in both looks: the
 * size of the words around it, underlined, with a centred 44 px ::after tap
 * target that adds nothing to the layout (the ReportLink pattern).
 */
function TextAction({ onClick, testId, children }: { onClick: () => void; testId: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "relative text-hd-caption text-signal-blue underline underline-offset-2 cursor-pointer",
        "hover:text-desktop-gray active:text-desktop-gray",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal-blue",
        "after:content-[''] after:absolute after:left-1/2 after:top-1/2 after:-translate-x-1/2 after:-translate-y-1/2",
        "after:w-full after:h-full after:min-h-touch",
      )}
    >
      {children}
    </button>
  );
}

function InlineButton({
  variant,
  children,
  onClick,
  type = "button",
  disabled,
  testId,
  label,
  big,
}: {
  variant: Variant;
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  testId?: string;
  label?: string;
  big?: boolean;
}) {
  if (variant === "w98") {
    return (
      <Button type={type} size={big ? "md" : "sm"} variant="dark" onClick={onClick} disabled={disabled} data-testid={testId} aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-label={label}
      className={cn(
        "rounded-lg min-h-touch px-3 text-hd-caption text-desktop-gray bg-raised-surface active:scale-[0.97]",
        "disabled:text-bevel-dark disabled:active:scale-100",
        big && "text-hd-body px-4 text-desert-amber",
      )}
    >
      {children}
    </button>
  );
}
