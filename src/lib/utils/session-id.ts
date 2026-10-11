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

/**
 * A second random id per page load, sent only with failure reports
 * (`/api/playback-event`). It lets the release line count one tab pressing
 * Try Again many times as one lost start (`LOST_START_GAP_MINUTES`,
 * src/services/stats/db/failures.ts). Separate from SESSION_ID on purpose:
 * a failure row must not be joinable to a play or to presence.
 */
export const FAILURE_TAB_ID: string =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2, 12)}`;
