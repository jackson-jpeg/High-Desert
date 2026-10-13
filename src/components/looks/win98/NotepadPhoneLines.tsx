"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { cn } from "@/lib/utils/cn";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useCommunityNow } from "@/hooks/useCommunityNow";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useLiveChat } from "@/hooks/useLiveChat";
import { placeProblem, useCallBox, useHideTuneins } from "@/hooks/useCallBox";
import { nameProblem } from "@/components/live/LiveChat";
import { chatRows, isOwnCall, type ChatRow } from "@/lib/live/chat-rows";
import { followKeys, useFollowLog } from "@/hooks/useFollowLog";
import { charCount, MAX_CHARS, suggestedPlace } from "@/services/live/client";
import { presenceAttrs } from "@/services/stats/now-feed";
import { useContextMenuStore, type ContextMenuItem } from "@/stores/context-menu-store";
import { useOpenLibraryIntent } from "@/hooks/useOpenLibraryIntent";
import { Dialog } from "@/components/win98/Dialog";
import { Button } from "@/components/win98/Button";
import { archiveLabel, archiveText, logTime, tuneinLine } from "./notepad-log";
import { Win98MenuBar, type Win98Menu } from "./Win98MenuBar";
import { Win98Icon } from "./Win98Icon";

type Chat = ReturnType<typeof useLiveChat>;
type Presence = ReturnType<typeof useCommunityNow> & { live?: number };
const MAX_NAME = 32;
const MAX_PLACE = 32;

/**
 * The phone lines in the Win98 look: "Phone Lines - Notepad". Same chat as
 * LiveChat (useLiveChat for the stream and the actions, useCallBox for the
 * call box), drawn as a plain-text log, each call its own block:
 *
 *   Skeptic, calling from Reno · Line 3 · [10:42 PM]
 *   message
 *
 * The name is bold, the place and line quieter, the time dimmer; your own
 * calls are tinted. A tune-in is one small gray line, and a run of them folds
 * into one; an archive moment is an indented, framed block (notepad-log.ts,
 * src/lib/live/chat-rows.ts). Scrolled up, new calls wait behind a "New calls
 * below" button.
 * A line is chosen by click or arrow keys; Report, the admin's actions and
 * the archive's "find the show" are on its right-click menu and in Edit,
 * which also holds Change Name and Calling From. Format holds Word Wrap and
 * the tune-in toggle.
 */
export function NotepadPhoneLines({ onClose, chat }: { onClose?: () => void; chat?: Chat }) {
  return chat ? <Notepad chat={chat} onClose={onClose} /> : <OwnNotepad onClose={onClose} />;
}

/** No stream handed in (the desktop): open one. The phone's Live screen hands in its own (LiveChat's `chat`). */
function OwnNotepad({ onClose }: { onClose?: () => void }) {
  return <Notepad chat={useLiveChat()} onClose={onClose} />;
}

function Notepad({ onClose, chat }: { onClose?: () => void; chat: Chat }) {
  const isMobile = useIsMobile();
  const now = useCommunityNow() as Presence;
  const live = typeof now.live === "number" ? now.live : undefined;
  const [hideTuneins, toggleTuneins] = useHideTuneins();
  const [wrap, setWrap] = useState(true);
  const [dialog, setDialog] = useState<"name" | "place" | "about" | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const openLibrary = useOpenLibraryIntent();
  const focusCallBox = () => rootRef.current?.querySelector<HTMLInputElement>('input[aria-label="Your call"]')?.focus();

  const rows = chatRows(chat.messages, hideTuneins ? [] : chat.notices, chat.archive);
  const selectedMessage = selected === null ? null : chat.messages.find((m) => m.id === selected) ?? null;
  const isMine = (id: number, name: string) => isOwnCall({ id, name }, chat.mine, chat.you);

  /** What a call's menu offers: Report for someone else's call; the admin's actions when admin. */
  const callActions = (id: number): ContextMenuItem[] => {
    const m = chat.messages.find((x) => x.id === id);
    if (!m) return [];
    const out: ContextMenuItem[] = [];
    if (!isMine(m.id, m.name)) {
      out.push({
        label: chat.reported.includes(m.id) ? "Reported" : `Report call from ${m.name}`,
        disabled: chat.reported.includes(m.id),
        onClick: () => void chat.report(m.id),
      });
    }
    if (chat.you?.admin) {
      out.push(
        { label: "Hide call", onClick: () => void chat.admin("hide", { messageId: m.id }), separator: out.length > 0 },
        { label: "Mute caller 10 min", onClick: () => void chat.admin("mute", { messageId: m.id, minutes: 10 }) },
        { label: "Clear name", onClick: () => void chat.admin("clear-name", { messageId: m.id }) },
        {
          label: "Ban caller...",
          danger: true,
          onClick: () => {
            if (window.confirm(`Disconnect ${m.name} for good?`)) void chat.admin("ban", { messageId: m.id });
          },
        },
      );
    }
    return out;
  };

  const menus: Win98Menu[] = [
    {
      label: "File",
      accel: "F",
      items: [
        { label: "New Call", onClick: focusCallBox, testId: "notepad-new-call" },
        ...(onClose ? [{ label: "Exit", onClick: onClose, separatorBefore: true }] : []),
      ],
    },
    {
      label: "Edit",
      accel: "E",
      items: [
        {
          label: selectedMessage ? `Report Call from ${selectedMessage.name}` : "Report Call",
          disabled: !selectedMessage || isMine(selectedMessage.id, selectedMessage.name) || chat.reported.includes(selectedMessage.id),
          onClick: () => selectedMessage && void chat.report(selectedMessage.id),
          testId: "notepad-report",
        },
        { label: "Change Name...", onClick: () => setDialog("name"), disabled: !chat.you, separatorBefore: true, testId: "notepad-change-name" },
        {
          label: chat.you?.place ? "Calling From..." : "Add Calling From...",
          onClick: () => setDialog("place"),
          disabled: !chat.you,
          testId: "notepad-change-place",
        },
        ...(chat.you?.admin
          ? [
              { label: "Hide Call", disabled: !selectedMessage, onClick: () => selectedMessage && void chat.admin("hide", { messageId: selectedMessage.id }), separatorBefore: true, testId: "notepad-admin-hide" },
              { label: "Mute Caller 10 min", disabled: !selectedMessage, onClick: () => selectedMessage && void chat.admin("mute", { messageId: selectedMessage.id, minutes: 10 }) },
              { label: "Clear Name", disabled: !selectedMessage, onClick: () => selectedMessage && void chat.admin("clear-name", { messageId: selectedMessage.id }) },
              {
                label: "Ban Caller...",
                disabled: !selectedMessage,
                onClick: () => {
                  if (selectedMessage && window.confirm(`Disconnect ${selectedMessage.name} for good?`)) void chat.admin("ban", { messageId: selectedMessage.id });
                },
              },
            ]
          : []),
      ],
    },
    {
      label: "Format",
      accel: "O",
      items: [
        { label: "Word Wrap", checked: wrap, onClick: () => setWrap((w) => !w), testId: "notepad-wrap" },
        { label: "Hide Tune-ins", checked: hideTuneins, onClick: toggleTuneins, testId: "toggle-tuneins" },
        ...(chat.you?.admin
          ? [
              {
                label: chat.slowMode?.forced ? "End Slow Mode" : "Slow Mode (30 min)",
                onClick: () => void chat.admin("slow", { on: !chat.slowMode?.forced, minutes: 30 }),
                separatorBefore: true,
                testId: "admin-slow",
              },
            ]
          : []),
      ],
    },
    {
      label: "Help",
      accel: "H",
      items: [{ label: "About Phone Lines", onClick: () => setDialog("about") }],
    },
  ];

  const status = chat.status === "live" ? "On the air" : chat.status === "connecting" ? "Dialing in..." : "Reconnecting...";

  return (
    <div
      ref={rootRef}
      className="hd-w98-notepad w98-raised-dark bg-raised-surface flex flex-col h-full min-h-0"
      data-testid="phone-lines"
      data-variant="notepad"
    >
      <div className="w98-titlebar-gradient flex items-center gap-1 px-1 py-[2px] flex-shrink-0">
        <Win98Icon name="notepad" size={16} />
        <h2 className="w98-font text-hd-12 font-bold text-white truncate flex-1">Phone Lines - Notepad</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close phone lines"
            className="w98-button !min-w-0 !p-0 w-[44px] h-[36px] flex items-center justify-center font-bold"
          >
            {"✕"}
          </button>
        )}
      </div>
      <Win98MenuBar menus={menus} large={isMobile} />
      <NotepadLog
        chat={chat}
        rows={rows}
        wrap={wrap}
        selected={selected}
        onSelect={setSelected}
        actionsFor={callActions}
        onFindShow={(title) => openLibrary({ q: title })}
      />
      <CallBox chat={chat} large={isMobile} />
      <div className="hd-w98-notepad-status flex items-center gap-[2px] text-hd-11 flex-shrink-0" role="status">
        <span className="w98-statusbar-panel-dark flex-1 min-w-0 truncate" data-testid="live-status">
          {selectedMessage ? `Call from ${selectedMessage.name} selected. Edit menu or right-click to report.` : status}
          {chat.slowMode?.on && (
            <span data-testid="slow-mode">
              {`. Slow mode: one call every ${Math.round((chat.slowMode?.intervalMs ?? 10_000) / 1000)} s`}
            </span>
          )}
        </span>
        {chat.you && (
          <span className="w98-statusbar-panel-dark min-w-0 hidden sm:block" data-testid="you-name">
            {chat.you.name}
            {chat.you.place ? `, calling from ${chat.you.place}` : ""}, {chat.you.line}
          </span>
        )}
        {live !== undefined && (
          <span className="w98-statusbar-panel-dark tabular-nums" data-testid="live-listeners" data-live={live}>
            {live} tuned in live
          </span>
        )}
      </div>

      {dialog === "name" && chat.you && <NameDialog chat={chat} onClose={() => setDialog(null)} />}
      {dialog === "place" && chat.you && <PlaceDialog chat={chat} onClose={() => setDialog(null)} />}
      {dialog === "about" && (
        <Dialog open onClose={() => setDialog(null)} title="About Phone Lines" width="360px">
          <div className="p-3 flex flex-col gap-2 text-hd-12">
            <p>The phone lines are the station&apos;s chat. Everyone tuned in reads every call.</p>
            <p>One call every 3 seconds, 280 characters each. No links, emails or phone numbers.</p>
            <p>Three reports from different callers hide a call.</p>
            <div className="flex justify-end">
              <Button variant="dark" onClick={() => setDialog(null)}>
                OK
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

type Row = ChatRow;

function NotepadLog({
  chat,
  rows,
  wrap,
  selected,
  onSelect,
  actionsFor,
  onFindShow,
}: {
  chat: Chat;
  rows: Row[];
  wrap: boolean;
  selected: number | null;
  onSelect: (id: number | null) => void;
  actionsFor: (id: number) => ContextMenuItem[];
  onFindShow: (title: string) => void;
}) {
  const keys = followKeys(rows);
  const lastCall = chat.messages[chat.messages.length - 1];
  const lastIsMine = !!lastCall && isOwnCall(lastCall, chat.mine, chat.you) && keys.alert === `c${lastCall.id}`;
  // Follow new lines only while the reader is at the bottom; scrolled up, new
  // calls wait behind "New calls below".
  const { ref: listRef, onScroll, unseen, jump } = useFollowLog<HTMLOListElement>(keys.follow, keys.alert, lastIsMine);

  const callIds = rows.flatMap((r) => (r.kind === "call" ? [r.m.id] : []));

  const openMenu = (id: number, x: number, y: number) => {
    const items = actionsFor(id);
    if (items.length) useContextMenuStore.getState().show(x, y, items);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLOListElement>) => {
    if (!callIds.length) return;
    const i = selected === null ? -1 : callIds.indexOf(selected);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const next = e.key === "ArrowDown" ? Math.min(callIds.length - 1, i + 1) : Math.max(0, i < 0 ? callIds.length - 1 : i - 1);
      onSelect(callIds[next]);
      document.getElementById(`notepad-line-${callIds[next]}`)?.scrollIntoView?.({ block: "nearest" });
    } else if ((e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) && selected !== null) {
      e.preventDefault();
      const r = document.getElementById(`notepad-line-${selected}`)?.getBoundingClientRect();
      openMenu(selected, r ? r.left + 24 : 24, r ? r.bottom : 24);
    } else if (e.key === "Escape" && selected !== null) {
      e.stopPropagation();
      onSelect(null);
    }
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <ol
        ref={listRef}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
        aria-live="polite"
        aria-label="Calls"
        data-testid="live-messages"
        className={cn(
          "hd-w98-notepad-log w98-inset-dark bg-inset-well flex-1 min-h-0 overflow-auto overscroll-contain",
          wrap ? "hd-w98-notepad-wrap" : "hd-w98-notepad-nowrap",
        )}
      >
        {rows.length === 0 && <li className="hd-w98-notepad-line">The lines are open. Be the first caller tonight.</li>}
        {rows.map((r) => {
          if (r.kind === "tunein") {
            return (
              <li
                key={`t-${r.key}`}
                className="hd-w98-notepad-line hd-w98-notepad-tunein"
                data-testid="tunein-notice"
                data-merged={r.merged}
                title={tuneinLine(r.n)}
              >
                {tuneinLine(r.n)}
              </li>
            );
          }
          if (r.kind === "archive") {
            const a = r.a;
            return (
              <li
                key={`a-${r.at}-${a.id}`}
                className="hd-w98-notepad-line hd-w98-notepad-archive"
                data-testid="archive-line"
                data-form={a.form}
                data-reason={a.reason}
                onContextMenu={(e: MouseEvent) => {
                  if (!a.episode) return;
                  e.preventDefault();
                  useContextMenuStore.getState().show(e.clientX, e.clientY, [
                    { label: "Find the show in the Library", onClick: () => onFindShow(a.episode!.title) },
                  ]);
                }}
              >
                <div className="hd-w98-notepad-head">
                  <span className="hd-w98-notepad-archive-label" data-testid="archive-label">
                    {archiveLabel(a)}
                  </span>{" "}
                  <time className="hd-w98-notepad-time" dateTime={a.at}>
                    {logTime(a.at)}
                  </time>
                </div>
                <div className="hd-w98-notepad-body" data-testid="archive-text">
                  {archiveText(a)}
                </div>
                {a.episode && (
                  <button type="button" className="hd-w98-notepad-link" onClick={() => onFindShow(a.episode!.title)} data-testid="archive-episode">
                    [find the show]
                  </button>
                )}
              </li>
            );
          }
          const m = r.m;
          const mine = isOwnCall(m, chat.mine, chat.you);
          return (
            <li
              key={m.id}
              id={`notepad-line-${m.id}`}
              data-selected={selected === m.id || undefined}
              data-testid="live-message"
              data-id={m.id}
              data-mine={mine || undefined}
              onClick={() => onSelect(m.id)}
              onContextMenu={(e: MouseEvent) => {
                e.preventDefault();
                onSelect(m.id);
                openMenu(m.id, e.clientX, e.clientY);
              }}
              className="hd-w98-notepad-line hd-w98-notepad-call"
            >
              {/* callLine(m) as a block, in parts the chat specs can find, the
                  same parts LiveChat names (caller-name, line-label, message-body). */}
              {/* The time stays on the first line with the name (2026-10-13):
                  name and meta wrap inside their own part, and the time sits
                  at the end of the first line. */}
              <div className="hd-w98-notepad-head" data-testid="call-head">
                <span className="hd-w98-notepad-who" data-testid="call-who">
                  <span className="hd-w98-notepad-name" data-testid="caller-name">
                    {m.name}
                  </span>
                  <span className="hd-w98-notepad-meta">
                    {m.place && <span data-testid="caller-place">, calling from {m.place}</span>}
                    {"\u00A0\u00B7 "}
                    <span data-testid="line-label">{m.line}</span>
                  </span>
                  {mine && <span className="sr-only"> (your call)</span>}
                </span>{" "}
                <span className="hd-w98-notepad-when">
                  <time className="hd-w98-notepad-time" dateTime={m.at} data-testid="call-time">
                    {logTime(m.at)}
                  </time>
                  {chat.reported.includes(m.id) && (
                    <span className="hd-w98-notepad-time" data-testid="reported">
                      {" "}
                      [reported]
                    </span>
                  )}
                </span>
              </div>
              <div className="hd-w98-notepad-body" data-testid="message-body">
                {m.body}
              </div>
            </li>
          );
        })}
      </ol>
      {unseen && (
        <button type="button" onClick={jump} data-testid="new-calls" className="w98-button hd-w98-notepad-new-calls min-h-touch md:min-h-0">
          New calls below {"\u2193"}
        </button>
      )}
    </div>
  );
}

function CallBox({ chat, large }: { chat: Chat; large: boolean }) {
  const { hint, offerPlace, place, setPlace, text, setText, error, setError, sending, wait, inputRef, n, over, banned, submit } =
    useCallBox(chat);
  const inset = useKeyboardInset(large);
  const formRef = useRef<HTMLFormElement>(null);

  // On a phone the keyboard covers the bottom of the sheet: keep the call box above it.
  useEffect(() => {
    const form = formRef.current;
    if (!inset || !form || !form.contains(document.activeElement)) return;
    form.scrollIntoView?.({ block: "nearest" });
  }, [inset]);

  return (
    <form ref={formRef} onSubmit={submit} data-keyboard-inset={inset} className="flex flex-col gap-1 px-1 pt-1 flex-shrink-0" data-testid="composer">
      {hint && (
        <p className="text-hd-12" data-testid="first-call-hint">
          First call? Say hello. Everyone tuned in hears it.
        </p>
      )}
      {offerPlace && (
        <label className="flex items-center gap-2 text-hd-12">
          <span className="shrink-0">Calling from:</span>
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
            className="hd-w98-field flex-1 min-w-0"
          />
        </label>
      )}
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (!wait) setError(null);
          }}
          placeholder="Call in..."
          aria-label="Your call"
          aria-invalid={over || undefined}
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="on"
          disabled={banned}
          className={cn("hd-w98-field flex-1 min-w-0", large && "min-h-touch")}
        />
        <Button
          type="submit"
          variant="dark"
          disabled={!n || over || sending || wait > 0 || banned}
          data-testid="send"
        >
          {wait > 0 ? `${wait}s` : "Call in"}
        </Button>
      </div>
      <div className="flex items-center justify-between text-hd-11">
        <span data-testid="char-count" className={cn(over && "text-desert-amber font-bold")}>
          {n}/{MAX_CHARS}
        </span>
        <CallBoxListeners />
      </div>
      {error && (
        <p role="alert" className="text-hd-12 text-red-400" data-testid="live-rejection">
          {error}
        </p>
      )}
      <span className="sr-only">{chat.you ? `You are ${chat.you.name} on ${chat.you.line}` : ""}</span>
    </form>
  );
}

/** Who would hear the call: the one presence feed's live figure. */
function CallBoxListeners() {
  const presence = useCommunityNow() as Presence;
  if (typeof presence.live !== "number") return null;
  return (
    <span data-testid="call-box-listeners" {...presenceAttrs("live", presence)}>
      {presence.live} tuned in now
    </span>
  );
}

function NameDialog({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const [value, setValue] = useState(chat.you?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const local = nameProblem(value, chat.you?.name ?? "");
    if (local === "unchanged") return onClose();
    if (local) return setError(local);
    setBusy(true);
    const r = await chat.rename(value);
    setBusy(false);
    if (r.ok) onClose();
    else setError(r.message);
  }

  return (
    <Dialog open onClose={onClose} title="Change Name" width="340px">
      <form onSubmit={submit} className="flex flex-col gap-2 p-3" data-testid="name-editor">
        <label className="flex flex-col gap-1 text-hd-12">
          Caller name:
          <input
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            maxLength={MAX_NAME * 2}
            aria-label="Caller name"
            autoComplete="off"
            className="hd-w98-field min-h-touch md:min-h-0"
          />
        </label>
        <p className="text-hd-11">
          {charCount(value)}/{MAX_NAME}. Once every 10 minutes.
        </p>
        {error && (
          <p role="alert" className="text-hd-12 text-red-400" data-testid="name-error">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="submit" variant="dark" disabled={busy} data-testid="save-name">
            OK
          </Button>
          <Button type="button" variant="dark" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PlaceDialog({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const current = chat.you?.place ?? null;
  const [value, setValue] = useState(() => current ?? suggestedPlace() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: string) {
    if (busy) return;
    if (next.trim() === (current ?? "")) return onClose();
    const local = placeProblem(next);
    if (local) return setError(local);
    setBusy(true);
    const r = await chat.setPlace(next);
    setBusy(false);
    if (r.ok) onClose();
    else setError(r.message);
  }

  return (
    <Dialog open onClose={onClose} title="Calling From" width="340px">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(value);
        }}
        className="flex flex-col gap-2 p-3"
        data-testid="place-editor"
      >
        <label className="flex flex-col gap-1 text-hd-12">
          Where you&apos;re calling from:
          <input
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            maxLength={MAX_PLACE * 2}
            aria-label="Calling from"
            placeholder="Your town"
            autoComplete="off"
            className="hd-w98-field min-h-touch md:min-h-0"
          />
        </label>
        <p className="text-hd-11">Optional. Shown after your name. Changes once every 10 minutes; clear it any time.</p>
        {error && (
          <p role="alert" className="text-hd-12 text-red-400" data-testid="place-error">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="submit" variant="dark" disabled={busy} data-testid="save-place">
            OK
          </Button>
          {current && (
            <Button type="button" variant="dark" disabled={busy} onClick={() => void save("")} data-testid="clear-place">
              Clear
            </Button>
          )}
          <Button type="button" variant="dark" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
