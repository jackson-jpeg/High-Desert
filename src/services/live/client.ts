/**
 * The browser's half of the phone lines (services/live, highdesert-live).
 *
 * Same-origin: everything is under /live-api/ on highdesert.space, proxied by
 * nginx to 127.0.0.1:3005, so the CSP's `connect-src 'self'` already covers it.
 *
 * Downstream is one EventSource. The browser reconnects it by itself (with
 * Last-Event-ID) after a dropped connection; when it gives up — a non-200, say
 * a 502 while the service restarts — `connectLive` reopens it with exponential
 * backoff and passes the last id it saw as `?lastEventId=`, because a new
 * EventSource cannot set the header.
 *
 * Upstream is plain JSON POSTs. The service checks Origin and Content-Type
 * (CSRF), which a same-origin fetch satisfies without doing anything.
 */

export const LIVE_API = "/live-api";

export interface LiveMessage {
  id: number;
  /** ISO 8601 */
  at: string;
  name: string;
  /** Line label: "Line 3", "West of the Rockies", … */
  line: string;
  body: string;
  /** Where the caller said they were calling from when they sent it. */
  place?: string | null;
}

/** "A listener just tuned in from Ohio": one batched line (services/live, TUNEIN_*). */
export interface TuneinNotice {
  /** ISO 8601 */
  at: string;
  /** Listeners announced in this line. */
  count: number;
  /** The places of those who set one, at most a few. */
  places: string[];
}

export interface SlowMode {
  on: boolean;
  until: number | null;
  intervalMs: number;
  forced: boolean;
}

export interface LiveYou {
  name: string;
  line: string;
  admin: boolean;
  /** "Calling from": theirs, or null. */
  place?: string | null;
  /** This caller has never called (nor renamed): the call box offers "Calling from" and a hint. */
  firstCall?: boolean;
}

export interface LiveHello {
  you: LiveYou;
  slowMode: SlowMode;
  recent: LiveMessage[];
  resumed: boolean;
  hidden: number[];
  /** The last few tune-in notices, oldest first. */
  tuneins?: TuneinNotice[];
}

export type LiveStatus = "connecting" | "live" | "reconnecting";

export interface LiveHandlers {
  hello(h: LiveHello): void;
  message(m: LiveMessage): void;
  hide(ids: number[]): void;
  /** `place` is present (null) when the rename also cleared the place (admin clear-name). */
  rename(ids: number[], name: string, place?: string | null): void;
  slow(s: SlowMode): void;
  tunein(n: TuneinNotice): void;
  status(s: LiveStatus): void;
}

/** Backoff after the browser gives up: 1 s, 2 s, 4 s … capped at 30 s, with jitter. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** attempt);
  return Math.round(base * (0.5 + random() / 2));
}

export function connectLive(
  handlers: LiveHandlers,
  { url = `${LIVE_API}/stream`, random = Math.random }: { url?: string; random?: () => number } = {},
): { close(): void } {
  let es: EventSource | null = null;
  let lastId: string | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const track = (e: MessageEvent) => {
    if (e.lastEventId) lastId = e.lastEventId;
  };
  const on = <T>(name: string, fn: (data: T) => void) => {
    es!.addEventListener(name, (e) => {
      const ev = e as MessageEvent;
      track(ev);
      try {
        fn(JSON.parse(ev.data) as T);
      } catch {
        // A malformed frame is dropped, not fatal.
      }
    });
  };

  function open() {
    if (closed) return;
    handlers.status(attempt === 0 && !lastId ? "connecting" : "reconnecting");
    es = new EventSource(lastId ? `${url}?lastEventId=${encodeURIComponent(lastId)}` : url);
    on<LiveHello>("hello", (h) => {
      attempt = 0;
      handlers.status("live");
      handlers.hello(h);
    });
    on<LiveMessage>("message", handlers.message);
    on<{ ids: number[] }>("hide", (d) => handlers.hide(d.ids));
    on<{ ids: number[]; name: string; place?: string | null }>("rename", (d) => handlers.rename(d.ids, d.name, d.place));
    on<SlowMode>("slow", handlers.slow);
    on<TuneinNotice>("tunein", handlers.tunein);
    es.onerror = () => {
      if (closed || !es) return;
      if (es.readyState === EventSource.CLOSED) {
        // The browser has given up on this one; we take over.
        es.close();
        es = null;
        handlers.status("reconnecting");
        timer = setTimeout(open, backoffMs(attempt++, random));
      } else {
        // The browser is retrying by itself, with Last-Event-ID.
        handlers.status("reconnecting");
      }
    };
  }

  open();
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      es?.close();
      es = null;
    },
  };
}

export type PostResult =
  | { ok: true; message: LiveMessage }
  | { ok: false; reason: string; message: string; retryAfter?: number };

/** Fallback wording when the server's own sentence is missing. */
const REASONS: Record<string, string> = {
  rate: "Hold the line. One call at a time.",
  duplicate: "You just said that.",
  muted: "You're on hold for a few minutes.",
  banned: "This line has been disconnected.",
  taken: "Someone on the lines already has that name.",
  offline: "The phone lines are down. Try again in a moment.",
};

async function postJson(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  try {
    const res = await fetch(`${LIVE_API}${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  } catch {
    return { status: 0, json: { error: "offline" } };
  }
}

function failure(json: Record<string, unknown>): { ok: false; reason: string; message: string; retryAfter?: number } {
  const reason = String(json.reason ?? json.error ?? "offline");
  const message = typeof json.message === "string" ? json.message : REASONS[reason] ?? REASONS[String(json.error)] ?? REASONS.offline;
  const retryAfter = typeof json.retryAfter === "number" ? json.retryAfter : undefined;
  return retryAfter !== undefined ? { ok: false, reason, message, retryAfter } : { ok: false, reason, message };
}

export async function sendMessage(body: string): Promise<PostResult> {
  const { status, json } = await postJson("/messages", { body });
  if (status === 201) return { ok: true, message: json as unknown as LiveMessage };
  // Only the caller's own pace reads as "wait N s". Any other 429 (a busy or
  // held network) carries its own sentence, which failure() passes through.
  if (status === 429 && json.error === "rate" && typeof json.retryAfter === "number") {
    return { ok: false, reason: "rate", message: `Hold the line. You can call again in ${json.retryAfter} s.`, retryAfter: json.retryAfter };
  }
  return failure(json);
}

export async function changeName(name: string): Promise<{ ok: true; name: string } | { ok: false; reason: string; message: string; retryAfter?: number }> {
  const { status, json } = await postJson("/name", { name });
  if (status === 200) return { ok: true, name: String(json.name) };
  if (status === 429 && json.error === "rate" && typeof json.retryAfter === "number") {
    const minutes = Math.ceil(json.retryAfter / 60);
    return { ok: false, reason: "rate", message: `Names can change once every 10 minutes: ${minutes} min to go.`, retryAfter: json.retryAfter };
  }
  return failure(json);
}

/** Set, or with "" clear, where this caller is calling from. */
export async function changePlace(place: string): Promise<{ ok: true; place: string | null } | { ok: false; reason: string; message: string; retryAfter?: number }> {
  const { status, json } = await postJson("/place", { place });
  if (status === 200) return { ok: true, place: typeof json.place === "string" ? json.place : null };
  if (status === 429 && json.error === "rate" && typeof json.retryAfter === "number") {
    const minutes = Math.ceil(json.retryAfter / 60);
    return {
      ok: false,
      reason: "rate",
      message: `Where you're calling from can change once every 10 minutes: ${minutes} min to go.`,
      retryAfter: json.retryAfter,
    };
  }
  return failure(json);
}

/** This browser tuned in to the station: the room hears it as a quiet line. Fire and forget. */
export function announceTuneIn(): void {
  void postJson("/tuned", {});
}

/** Time zone areas that name a real place; "Etc/GMT+5" and "UTC" say nothing about where anyone is. */
const PLACE_AREAS = new Set(["Africa", "America", "Antarctica", "Asia", "Atlantic", "Australia", "Europe", "Indian", "Pacific"]);

/**
 * A suggestion for "Calling from", from the browser's own time zone and
 * nothing else ("Europe/Brussels" → "Brussels"). Never an address, never a
 * lookup: it is only ever a default the caller can change or clear.
 */
export function placeFromTimeZone(tz: string | undefined): string | null {
  if (!tz) return null;
  const parts = tz.split("/");
  if (parts.length < 2 || !PLACE_AREAS.has(parts[0])) return null;
  const city = parts[parts.length - 1].replace(/_/g, " ").trim();
  return city.length >= 2 && city.length <= 32 ? city : null;
}

export function suggestedPlace(): string | null {
  try {
    return placeFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

/** The quiet line for a tune-in notice. */
export function tuneinText(n: TuneinNotice): string {
  if (n.count <= 1) return n.places[0] ? `A listener just tuned in from ${n.places[0]}` : "A new listener tuned in";
  if (n.places.length === 0) return `${n.count} new listeners tuned in`;
  const from = n.places.map((p) => `one from ${p}`);
  const list = from.length === 1 ? from[0] : `${from.slice(0, -1).join(", ")} and ${from[from.length - 1]}`;
  if (n.places.length === n.count) return `${n.count} listeners just tuned in: ${list}`;
  return `${n.count} new listeners tuned in, ${list}`;
}

export async function reportMessage(messageId: number): Promise<boolean> {
  const { status } = await postJson("/report", { messageId });
  return status === 200;
}

export type AdminAction = "hide" | "mute" | "ban" | "clear-name" | "slow";

export async function adminAction(action: AdminAction, body: Record<string, unknown>): Promise<boolean> {
  const { status } = await postJson(`/admin/${action}`, body);
  return status === 200;
}

/** Characters as the server counts them: code points, not UTF-16 units. */
export function charCount(s: string): number {
  return [...s.trim()].length;
}

export const MAX_CHARS = 280;
