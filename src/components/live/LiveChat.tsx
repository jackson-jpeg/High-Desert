"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/win98/Button";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useCommunityNow } from "@/hooks/useCommunityNow";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useLiveChat } from "@/hooks/useLiveChat";
import { charCount, MAX_CHARS, type LiveMessage } from "@/services/live/client";

/**
 * The phone lines: the live broadcast's chat (services/live, docs/live-chat.md).
 *
 * Every message is a call — a line label ("Line 3", "West of the Rockies") and
 * a caller name ("Night Owl in Pahrump").
 *
 * No props, and no chrome of its own: the Live screen (LiveStation) puts it
 * in the "Phone Lines" Win98 window beside the player on desktop, and in
 * LiveChatSheet on mobile, which sizes itself to the visual viewport. This
 * fills whatever box it is given — Win98 insets on desktop, glass on mobile —
 * and owns keeping its own input in view when the iOS keyboard comes up.
 *
 * The listener count is the site's one presence number (`useCommunityNow`,
 * `/api/stats/now`'s `live` field), never a count of chat connections.
 */

type Chat = ReturnType<typeof useLiveChat>;
type Variant = "w98" | "glass";
const MAX_NAME = 32;

export function LiveChat() {
  const isMobile = useIsMobile();
  const variant: Variant = isMobile ? "glass" : "w98";
  const chat = useLiveChat();
  const now = useCommunityNow() as ReturnType<typeof useCommunityNow> & { live?: number };
  const live = typeof now.live === "number" ? now.live : undefined;
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
      <LinesHeader chat={chat} live={live} variant={variant} />
      <MessageList chat={chat} variant={variant} />
      <Composer chat={chat} variant={variant} formRef={composerRef} />
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
      {live} listening live
    </span>
  );
}

function LinesHeader({ chat, live, variant }: { chat: Chat; live?: number; variant: Variant }) {
  const [editing, setEditing] = useState(false);
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
      </div>
      {chat.you && !editing && (
        <div className="flex flex-wrap items-center gap-2 text-hd-caption text-bevel-dark">
          <span>
            You&rsquo;re <span className="text-signal-blue font-bold" data-testid="you-name">{chat.you.name}</span> on{" "}
            <span className="text-phosphor-amber" data-testid="you-line">
              {chat.you.line}
            </span>
          </span>
          <InlineButton variant={variant} onClick={() => setEditing(true)} testId="change-name">
            Change name
          </InlineButton>
        </div>
      )}
      {chat.you && editing && <NameEditor chat={chat} variant={variant} onDone={() => setEditing(false)} />}
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

function MessageList({ chat, variant }: { chat: Chat; variant: Variant }) {
  const listRef = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  const count = chat.messages.length;
  const lastId = chat.messages[count - 1]?.id;

  // Follow new calls only while the listener is at the bottom: scrolling back
  // through the night must not be yanked away by the next message.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  return (
    <ol
      ref={listRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
      aria-live="polite"
      aria-label="Calls"
      data-testid="live-messages"
      className={cn(
        "flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-1",
        variant === "w98" ? "w98-inset-dark bg-inset-well p-1" : "rounded-xl bg-inset-well/85 p-2",
      )}
    >
      {count === 0 && (
        <li className="text-hd-caption text-bevel-dark p-2">The lines are open. Be the first caller tonight.</li>
      )}
      {chat.messages.map((m) => (
        <MessageRow key={m.id} m={m} chat={chat} variant={variant} />
      ))}
    </ol>
  );
}

function MessageRow({ m, chat, variant }: { m: LiveMessage; chat: Chat; variant: Variant }) {
  const mine = chat.mine.includes(m.id) || (!!chat.you && m.name === chat.you.name);
  const reported = chat.reported.includes(m.id);
  const time = new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <li
      data-testid="live-message"
      data-id={m.id}
      className={cn("flex flex-col px-1 py-0.5", variant === "glass" && "rounded-lg")}
    >
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="shrink-0 text-hd-micro uppercase tracking-wider text-phosphor-amber" data-testid="line-label">
          {m.line}
        </span>
        <span className="truncate text-hd-caption font-bold text-signal-blue" data-testid="caller-name">
          {m.name}
        </span>
        <time className="ml-auto shrink-0 text-hd-micro text-bevel-dark/85" dateTime={m.at}>
          {time}
        </time>
      </div>
      <p className="text-hd-body text-desktop-gray break-words whitespace-pre-wrap" data-testid="message-body">
        {m.body}
      </p>
      <div className="flex flex-wrap gap-2">
        {!mine &&
          (reported ? (
            <span className="text-hd-micro text-bevel-dark/85">Reported</span>
          ) : (
            <InlineButton variant={variant} onClick={() => void chat.report(m.id)} testId="report" label={`Report call from ${m.name}`}>
              Report
            </InlineButton>
          ))}
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
}: {
  chat: Chat;
  variant: Variant;
  formRef: RefObject<HTMLFormElement | null>;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /** Seconds left before the server will take another call from us (after a 429). */
  const [wait, setWait] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const n = charCount(text);
  const over = n > MAX_CHARS;

  const waiting = wait > 0;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      setWait((w) => {
        if (w <= 1) setError(null);
        return Math.max(0, w - 1);
      });
    }, 1000);
    return () => clearInterval(t);
  }, [waiting]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!n || over || sending || wait > 0) return;
    setSending(true);
    const r = await chat.send(text);
    setSending(false);
    if (r.ok) {
      setText("");
      setError(null);
    } else {
      setError(r.message);
      if (r.retryAfter) setWait(r.retryAfter);
    }
    // Keep the keyboard up on mobile: the next call is usually a reply.
    inputRef.current?.focus();
  }

  const banned = error !== null && /disconnected/i.test(error);
  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-1" data-testid="composer">
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
