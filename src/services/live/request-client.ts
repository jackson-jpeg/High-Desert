/**
 * The browser's half of the Request Line (services/live/lib/requests.mjs,
 * docs/request-line.md). Same-origin JSON under /live-api, like the phone
 * lines: the caller cookie says who is nominating and voting.
 */

import { LIVE_API } from "@/services/live/client";

export interface Nomination {
  id: number;
  fileHash: string;
  title: string;
  airDate: string | null;
  guestName: string | null;
  name: string;
  place: string | null;
  note: string | null;
  votes: number;
  /** Nominated from this browser. */
  mine?: boolean;
  /** This browser has voted for it. */
  voted?: boolean;
}

export interface RequestLineState {
  /** The Pacific day nominations are for: today, or tomorrow after 6 PM. */
  day: string;
  closesAt: number;
  startsAt: number;
  nominations: Nomination[];
  /** This browser already nominated for `day`. */
  nominated: boolean;
  /** Tonight's locked request, once voting has closed (fileHash null: nobody nominated). */
  tonight: { day: string; fileHash: string | null; by: string | null; place: string | null; votes: number; startsAt: number } | null;
  admin: boolean;
}

export type RequestResult =
  | { ok: true; id: number; votes: number; joined: boolean; counted: boolean }
  | { ok: false; reason: string; message: string };

const OFFLINE = "The Request Line is not answering. Try again in a moment.";

async function call(path: string, init?: RequestInit): Promise<{ status: number; json: Record<string, unknown> }> {
  try {
    const res = await fetch(`${LIVE_API}${path}`, { credentials: "same-origin", ...init });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { status: 0, json: { error: "offline" } };
  }
}

const post = (path: string, body: unknown) =>
  call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function refusal(json: Record<string, unknown>): { ok: false; reason: string; message: string } {
  const reason = String(json.reason ?? json.error ?? "offline");
  return { ok: false, reason, message: typeof json.message === "string" ? json.message : OFFLINE };
}

export async function fetchRequestLine(): Promise<RequestLineState | null> {
  const { status, json } = await call("/requests");
  return status === 200 ? (json as unknown as RequestLineState) : null;
}

/** Nominate a show for tonight (tomorrow after 6 PM). Already up: a vote for it. */
export async function requestShow(fileHash: string, note?: string): Promise<RequestResult> {
  const { status, json } = await post("/requests", note ? { fileHash, note } : { fileHash });
  if (status === 200 || status === 201) {
    return { ok: true, id: Number(json.id), votes: Number(json.votes), joined: !!json.joined, counted: !!json.counted };
  }
  return refusal(json);
}

export async function voteFor(nominationId: number): Promise<{ ok: true; votes: number; counted: boolean } | { ok: false; reason: string; message: string }> {
  const { status, json } = await post("/requests/vote", { nominationId });
  if (status === 200) return { ok: true, votes: Number(json.votes), counted: !!json.counted };
  return refusal(json);
}

export async function vetoNomination(nominationId: number): Promise<boolean> {
  const { status } = await post("/admin/request-veto", { nominationId });
  return status === 200;
}

/** What a successful request says, in one line. */
export function requestedText(r: { joined: boolean; counted: boolean; votes: number }): string {
  const votes = `${r.votes} ${r.votes === 1 ? "vote" : "votes"}`;
  if (r.joined) return r.counted ? `Someone picked it already. Your vote is in (${votes}).` : `You already voted for it (${votes}).`;
  return `Requested. It is on the Request Line with ${votes}.`;
}
