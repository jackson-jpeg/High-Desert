/**
 * Every threshold the phone lines run on, in one place. docs/live-chat.md
 * quotes these; change them here and there together.
 */

/** Longest message, in code points after normalisation (NFKC, trimmed, collapsed). */
export const MAX_MESSAGE_CHARS = 280;
/** Longest caller name, in code points. */
export const MAX_NAME_CHARS = 32;
export const MIN_NAME_CHARS = 2;

/** One message per client per this long, always. */
export const POST_INTERVAL_MS = 3_000;
/** ...and per this long while slow mode is on. */
export const SLOW_INTERVAL_MS = 10_000;

/** The same message from the same client inside this window is a duplicate. */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;
/** How many of a client's recent bodies are remembered for the duplicate check. */
export const DUPLICATE_MEMORY = 8;
/**
 * Flood: the same body from this many *different* clients inside the window
 * blocks further copies. Short bodies ("lol", "hi art") are exempt — a room
 * saying the same short thing is a room, not a flood.
 */
export const FLOOD_CLIENTS = 3;
export const FLOOD_WINDOW_MS = 60_000;
export const FLOOD_MIN_CHARS = 12;

/** Automatic slow mode: more than BUSY_MESSAGES in BUSY_WINDOW_MS turns it on for SLOW_MODE_MS. */
export const BUSY_MESSAGES = 20;
export const BUSY_WINDOW_MS = 30_000;
export const SLOW_MODE_MS = 2 * 60_000;

/** Reports from this many distinct clients hide a message and mute its sender. */
export const REPORTS_TO_HIDE = 3;
export const REPORT_MUTE_MS = 10 * 60_000;
/** Reports a client may file per minute. */
export const REPORTS_PER_MINUTE = 10;

/** A caller name can be changed at most once per this long. */
export const NAME_CHANGE_MS = 10 * 60_000;
/** A name is held by a caller who is connected or was seen inside this window. */
export const NAME_ACTIVE_MS = 30 * 60_000;

/** Messages (and their reports) are deleted after this long. */
export const RETENTION_MS = 7 * 24 * 60 * 60_000;
export const RETENTION_SWEEP_MS = 60 * 60_000;

/** SSE */
export const HEARTBEAT_MS = 25_000;
export const RETRY_HINT_MS = 5_000;
export const RECENT_ON_HELLO = 50;
/** hide events are re-sent in hello for messages hidden this recently, for reconnecting clients. */
export const HIDDEN_REPLAY_MS = 10 * 60_000;
/** Streams one caller (one browser) may hold open. */
export const STREAMS_PER_CALLER = 8;
export const MAX_STREAMS = 3_000;
/** A client this far behind on writes is dropped rather than buffered for. */
export const MAX_BUFFERED_BYTES = 256 * 1024;

/** Admin sessions (the cookie) and the one-time sign-in link. */
export const ADMIN_SESSION_MS = 30 * 24 * 60 * 60_000;
export const SIGNIN_NONCE_MS = 24 * 60 * 60_000;
export const SIGNIN_ATTEMPTS_PER_MINUTE = 5;
export const ADMIN_COOKIE = "hd_live_admin";

/** Request bodies are tiny; anything bigger is refused before it is parsed. */
export const MAX_BODY_BYTES = 4 * 1024;

/**
 * Who is calling. A caller is one browser: a random id the service signs and
 * sets as an HttpOnly cookie. Names, lines, the rename limit, reports, mutes
 * and bans key on it (docs/live-chat.md, "Who is calling").
 */
export const CALLER_COOKIE = "hd_live_caller";
/** 400 days: the longest expiry Chromium honours. */
export const CALLER_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/**
 * The address (an IPv4 address or IPv6 /64, as an HMAC) is only a secondary
 * abuse limit. Mobile carriers put thousands of people behind one address, so
 * every cap here is generous: a whole NAT must never pay for one person.
 */
/** New browsers (caller ids minted) per address per hour. */
export const NEW_CALLERS_PER_ADDRESS_HOUR = 300;
/** Callers per address per hour who start talking (a first call or a first rename). */
export const FIRST_CALLS_PER_ADDRESS_HOUR = 30;
/** Messages per address per minute, across every caller behind it. */
export const MESSAGES_PER_ADDRESS_MINUTE = 60;
/** Reports per address per minute, across every caller behind it. */
export const REPORTS_PER_ADDRESS_MINUTE = 60;
/** Open streams per address, across every caller behind it. */
export const STREAMS_PER_ADDRESS = 200;
/**
 * A ban also holds the banned caller's address, so clearing cookies is not a
 * free reset: for BAN_HOLD_MS, a new caller from that address may start
 * talking at most once per BAN_HOLD_INTERVAL_MS, the first an interval after
 * the ban. Callers already talking from that address are untouched.
 */
export const BAN_HOLD_MS = 24 * 60 * 60_000;
export const BAN_HOLD_INTERVAL_MS = 60 * 60_000;
/** A legacy (address-keyed) caller is adopted by the first browser from its address only if seen this recently. */
export const LEGACY_ADOPT_MS = 30 * 24 * 60 * 60_000;
