"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { charCount, MAX_CHARS, suggestedPlace } from "@/services/live/client";
import { safeGetItem, safeSetItem } from "@/lib/utils/safe-storage";
import type { useLiveChat } from "@/hooks/useLiveChat";

/**
 * The phone lines' call box and per-viewer settings, without a view: shared
 * by the public chat (src/components/live/LiveChat.tsx) and the Win98 look's
 * Notepad (src/components/looks/win98/NotepadPhoneLines.tsx), so both send,
 * wait out a 429 and offer "Calling from" the same way.
 */

type Chat = ReturnType<typeof useLiveChat>;

const MAX_PLACE = 32;
/** Per-viewer settings (localStorage): tune-in lines hidden, and the first-call hint already shown. */
export const HIDE_TUNEINS_KEY = "hd-live-hide-tuneins";
export const FIRST_CALL_HINT_KEY = "hd-live-first-call-hint";

/** Whether this viewer hides tune-in lines, remembered per browser, and its toggle. */
export function useHideTuneins(): [boolean, () => void] {
  const [hideTuneins, setHideTuneins] = useState(() => safeGetItem("local", HIDE_TUNEINS_KEY) === "1");
  const toggleTuneins = () => {
    setHideTuneins((h) => {
      safeSetItem("local", HIDE_TUNEINS_KEY, h ? "0" : "1");
      return !h;
    });
  };
  return [hideTuneins, toggleTuneins];
}

/**
 * Why a place cannot be saved, said here; null when it is worth asking the
 * server. Empty is not a problem: it clears the place.
 */
export function placeProblem(value: string): string | null {
  if (charCount(value) > MAX_PLACE) return `Places can be at most ${MAX_PLACE} characters.`;
  return null;
}

/**
 * The first-call hint, once per browser: shown the first time this browser is
 * a first-time caller, remembered from then on, and gone once the call is made.
 */
export function useFirstCallHint(firstCall: boolean): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!firstCall || safeGetItem("local", FIRST_CALL_HINT_KEY)) return;
    safeSetItem("local", FIRST_CALL_HINT_KEY, "1");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- once, when the server says this is a first call
    setShown(true);
  }, [firstCall]);
  return shown && firstCall;
}

/** The call box: the call, the optional first-call place, and the server's answer. */
export function useCallBox(chat: Chat) {
  const firstCall = !!chat.you?.firstCall;
  const hint = useFirstCallHint(firstCall);
  // "Calling from" on a first call: optional, suggested from the time zone only.
  const offerPlace = firstCall && !chat.you?.place;
  const [place, setPlace] = useState(() => suggestedPlace() ?? "");
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

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!n || over || sending || wait > 0) return;
    setSending(true);
    if (offerPlace && place.trim()) {
      const local = placeProblem(place);
      const p = local ? { ok: false as const, message: local } : await chat.setPlace(place);
      if (!p.ok) {
        setSending(false);
        setError(p.message);
        return;
      }
    }
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
  return { firstCall, hint, offerPlace, place, setPlace, text, setText, error, setError, sending, wait, inputRef, n, over, banned, submit };
}
