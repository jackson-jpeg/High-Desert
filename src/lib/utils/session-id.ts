/**
 * One anonymous id per page load, shared by the playback reporter and the
 * presence heartbeat so the two describe the same session.
 *
 * Deliberately not persisted: it exists to count concurrent sessions, not to
 * recognise anyone across visits. It is random, carries nothing about the
 * visitor, and is discarded on reload.
 *
 * Must satisfy the API's format check: 8-64 of [A-Za-z0-9_-].
 */
export const SESSION_ID: string =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `ssr-${Math.random().toString(36).slice(2, 12)}`;
