"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  adminAction,
  changeName,
  connectLive,
  reportMessage,
  sendMessage,
  type AdminAction,
  type LiveMessage,
  type LiveStatus,
  type LiveYou,
  type SlowMode,
} from "@/services/live/client";

/** How many messages the lines keep on screen. */
export const KEEP_MESSAGES = 200;

export interface LiveChatState {
  status: LiveStatus;
  you: LiveYou | null;
  slowMode: SlowMode | null;
  messages: LiveMessage[];
  /** Ids this browser posted: no Report button on your own call. */
  mine: number[];
  reported: number[];
}

type Action =
  | { type: "status"; status: LiveStatus }
  | { type: "hello"; you: LiveYou; slowMode: SlowMode; recent: LiveMessage[]; resumed: boolean; hidden: number[] }
  | { type: "message"; message: LiveMessage; mine?: boolean }
  | { type: "hide"; ids: number[] }
  | { type: "rename"; ids: number[]; name: string }
  | { type: "slow"; slowMode: SlowMode }
  | { type: "you"; name: string }
  | { type: "reported"; id: number };

export const INITIAL_LIVE: LiveChatState = { status: "connecting", you: null, slowMode: null, messages: [], mine: [], reported: [] };

function merge(list: LiveMessage[], add: LiveMessage[]): LiveMessage[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of add) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-KEEP_MESSAGES);
}

export function liveReducer(state: LiveChatState, a: Action): LiveChatState {
  switch (a.type) {
    case "status":
      return { ...state, status: a.status };
    case "hello": {
      const hidden = new Set(a.hidden);
      // A fresh hello is the truth about the recent window: anything we hold
      // inside it that it does not list has been taken off the air meanwhile.
      const floor = a.recent.length ? a.recent[0].id : Infinity;
      const recentIds = new Set(a.recent.map((m) => m.id));
      const kept = state.messages.filter(
        (m) => !hidden.has(m.id) && (a.resumed || m.id < floor || recentIds.has(m.id)),
      );
      return { ...state, you: a.you, slowMode: a.slowMode, messages: merge(kept, a.recent.filter((m) => !hidden.has(m.id))) };
    }
    case "message":
      return {
        ...state,
        messages: merge(state.messages, [a.message]),
        mine: a.mine ? [...state.mine, a.message.id].slice(-KEEP_MESSAGES) : state.mine,
      };
    case "hide": {
      const ids = new Set(a.ids);
      return { ...state, messages: state.messages.filter((m) => !ids.has(m.id)) };
    }
    case "rename": {
      const ids = new Set(a.ids);
      return { ...state, messages: state.messages.map((m) => (ids.has(m.id) ? { ...m, name: a.name } : m)) };
    }
    case "slow":
      return { ...state, slowMode: a.slowMode };
    case "you":
      return state.you ? { ...state, you: { ...state.you, name: a.name } } : state;
    case "reported":
      return { ...state, reported: [...state.reported, a.id] };
  }
}

/** The phone lines: one stream per mounted chat, and the actions a caller has. */
export function useLiveChat() {
  const [state, dispatch] = useReducer(liveReducer, INITIAL_LIVE);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const conn = connectLive({
      hello: (h) => dispatch({ type: "hello", ...h }),
      message: (message) => dispatch({ type: "message", message }),
      hide: (ids) => dispatch({ type: "hide", ids }),
      rename: (ids, name) => dispatch({ type: "rename", ids, name }),
      slow: (slowMode) => dispatch({ type: "slow", slowMode }),
      status: (status) => dispatch({ type: "status", status }),
    });
    return () => {
      mounted.current = false;
      conn.close();
    };
  }, []);

  const send = useCallback(async (body: string) => {
    const r = await sendMessage(body);
    if (r.ok && mounted.current) dispatch({ type: "message", message: r.message, mine: true });
    return r;
  }, []);

  const rename = useCallback(async (name: string) => {
    const r = await changeName(name);
    if (r.ok && mounted.current) dispatch({ type: "you", name: r.name });
    return r;
  }, []);

  const report = useCallback(async (id: number) => {
    const ok = await reportMessage(id);
    if (ok && mounted.current) dispatch({ type: "reported", id });
    return ok;
  }, []);

  const admin = useCallback((action: AdminAction, body: Record<string, unknown>) => adminAction(action, body), []);

  return { ...state, send, rename, report, admin };
}
