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
}

export interface LiveHello {
  you: LiveYou;
  slowMode: SlowMode;
  recent: LiveMessage[];
  resumed: boolean;
  hidden: number[];
}

export type LiveStatus = "connecting" | "live" | "reconnecting";

export interface LiveHandlers {
  hello(h: LiveHello): void;
  message(m: LiveMessage): void;
  hide(ids: number[]): void;
  rename(ids: number[], name: string): void;
  slow(s: SlowMode): void;
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
    on<{ ids: number[]; name: string }>("rename", (d) => handlers.rename(d.ids, d.name));
    on<SlowMode>("slow", handlers.slow);
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
  rate: "Hold the line — one call at a time.",
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
  if (status === 429 && typeof json.retryAfter === "number") {
    return { ok: false, reason: "rate", message: `Hold the line — you can call again in ${json.retryAfter} s.`, retryAfter: json.retryAfter };
  }
  return failure(json);
}

export async function changeName(name: string): Promise<{ ok: true; name: string } | { ok: false; reason: string; message: string; retryAfter?: number }> {
  const { status, json } = await postJson("/name", { name });
  if (status === 200) return { ok: true, name: String(json.name) };
  if (status === 429 && typeof json.retryAfter === "number") {
    const minutes = Math.ceil(json.retryAfter / 60);
    return { ok: false, reason: "rate", message: `Names can change once every 10 minutes — ${minutes} min to go.`, retryAfter: json.retryAfter };
  }
  return failure(json);
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
