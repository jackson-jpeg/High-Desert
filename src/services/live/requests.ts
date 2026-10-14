/**
 * The Request Line, as the app reads it (2026-10-14, docs/request-line.md).
 *
 * The phone lines' service owns the writes: nominations, votes and an admin's
 * veto (services/live/lib/requests.mjs), keyed on the caller's own cookie.
 * The app reads the same tables (it owns them; the service's role is granted
 * what it needs) for two things:
 *
 *   - the night's winner, for the schedule's 10 PM slot. `live_request_night()`
 *     (services/live/schema.sql) locks it the first time anyone asks after
 *     6 PM Pacific, from the votes cast before 6 PM, and returns the same row
 *     to every later caller: the app and the service agree because there is
 *     one function, in the database;
 *   - the day's nominations with their tallies, for the server-rendered
 *     /request-line page.
 *
 * A database without the tables or the function (a fresh test database, the
 * app deployed before the service) reads as "no request", never an error,
 * and so does any failure to read the night: the schedule never fails for it.
 */

import { pool } from "@/services/stats/db/pool";
import type { RequestNight } from "@/lib/live/schedule";

const MISSING = new Set(["42P01", "42883"]); // undefined table, undefined function
const TTL_MS = 15_000;
const nightCache = new Map<string, { at: number; night: RequestNight | null }>();

interface NightRow {
  day: string;
  file_hash: string | null;
  caller_name: string | null;
  caller_place: string | null;
  votes: number;
}

/**
 * The locked request for `day`, locking it if voting has closed. Null before
 * 6 PM Pacific (nothing is locked yet) and without the tables. A night nobody
 * nominated for is a row with `fileHash: null`.
 */
export async function loadRequestNight(day: string, now: number = Date.now()): Promise<RequestNight | null> {
  const hit = nightCache.get(day);
  if (hit && now - hit.at < TTL_MS) return hit.night;
  let night: RequestNight | null = null;
  try {
    const { rows } = await pool().query<NightRow>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, file_hash, caller_name, caller_place, votes
         FROM live_request_night($1::date, to_timestamp($2::double precision / 1000))`,
      [day, now],
    );
    const r = rows[0];
    night = r ? { day: r.day, fileHash: r.file_hash, by: r.caller_name, place: r.caller_place, votes: Number(r.votes) } : null;
  } catch (err) {
    // The station plays on without its request rather than not at all: any
    // other failure is logged and read as "no request", and not cached, so
    // the next read tries again.
    if (!MISSING.has((err as { code?: string }).code ?? "")) {
      console.error("[request-line] night unavailable:", (err as Error).message);
      return null;
    }
  }
  nightCache.set(day, { at: now, night });
  return night;
}

/** Tests only. */
export function forgetRequestNightsForTests(): void {
  nightCache.clear();
}

export interface NominationView {
  id: number;
  fileHash: string;
  title: string;
  airDate: string | null;
  guestName: string | null;
  name: string;
  place: string | null;
  note: string | null;
  votes: number;
  at: string;
}

/**
 * The nominations for `day` still standing (not vetoed), most votes first,
 * then the earliest: the order the lock would pick a winner in. Empty without
 * the tables.
 */
export async function loadNominations(day: string): Promise<NominationView[]> {
  try {
    const { rows } = await pool().query<{
      id: string;
      file_hash: string;
      title: string;
      air_date: string | null;
      guest: string | null;
      caller_name: string;
      caller_place: string | null;
      note: string | null;
      votes: string;
      at: string;
    }>(
      `SELECT n.id, n.file_hash, n.title, n.air_date, n.guest, n.caller_name, n.caller_place, n.note,
              count(v.client_ref) AS votes, to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
         FROM live_request_nominations n
         LEFT JOIN live_request_votes v ON v.nomination_id = n.id
        WHERE n.day = $1::date AND n.vetoed_at IS NULL
        GROUP BY n.id
        ORDER BY count(v.client_ref) DESC, n.created_at, n.id`,
      [day],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      fileHash: r.file_hash,
      title: r.title,
      airDate: r.air_date,
      guestName: r.guest,
      name: r.caller_name,
      place: r.caller_place,
      note: r.note,
      votes: Number(r.votes),
      at: r.at,
    }));
  } catch (err) {
    if (MISSING.has((err as { code?: string }).code ?? "")) return [];
    throw err;
  }
}
