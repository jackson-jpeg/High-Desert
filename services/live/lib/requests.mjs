/**
 * The Request Line (2026-10-14, docs/request-line.md): listeners pick one show
 * for the station's 10 PM Pacific slot, Art's original airtime.
 *
 *   - A listener (one browser, the caller cookie) nominates at most one show a
 *     day. A show already nominated that day is a vote for it, not a second
 *     nomination, and does not use up the listener's own.
 *   - Anyone votes with one tap: one vote per listener per show. Behind one
 *     address at most VOTES_PER_ADDRESS votes count for a show, so a script
 *     minting cookies cannot take the night (a household or a carrier's NAT
 *     still can vote many times over).
 *   - A show the station played in the last 30 days (or has on today's
 *     program) cannot be nominated, nor one whose file is known broken.
 *   - Voting closes at 6 PM Pacific: `live_request_night()` (schema.sql) locks
 *     the winner the first time anyone asks after that, from votes cast
 *     before 6 PM. Nominating after 6 PM is for tomorrow.
 *   - A note with a nomination goes through the same filter as a call.
 *   - An admin can veto a nomination. Before 10 PM a veto of the locked
 *     winner unlocks the night, and the next read locks the runner-up.
 *   - When the request comes on the air, the station says so in the lines
 *     ("Tonight's request, from Night Owl, calling from Pahrump."), once:
 *     `announced_at` in the database, so a restart never says it twice.
 *
 * Nothing here knows HTTP; app.mjs routes to it and turns a refusal
 * (`RequestRefusal`) into a status.
 */

import { pacificDay, requestCloseAt, requestDayAt, requestStartAt } from "./shared/pacific.ts";

/** Days back the station's own plays keep a show off the Request Line. */
export const REQUEST_REPEAT_DAYS = 30;
/** Nominations are deleted after this many days (their votes with them). */
export const REQUEST_RETENTION_DAYS = 35;
/** Votes for one show counted from one address. */
export const VOTES_PER_ADDRESS = 10;
/** Nominations one address may make per hour, across every caller behind it. */
export const NOMINATIONS_PER_ADDRESS_HOUR = 20;
/** Longest note with a nomination, in characters after the filter. */
export const MAX_NOTE_CHARS = 140;
/** How often the herald looks at what is on the air. */
export const HERALD_CHECK_MS = 30_000;
/** Where the catalog is read from: the app's own seed, over loopback. */
export const CATALOG_URL = "http://127.0.0.1:3003/seed/library.json";
const CATALOG_TTL_MS = 6 * 60 * 60_000;

export class RequestRefusal extends Error {
  constructor(status, error, message, extra = {}) {
    super(error);
    this.status = status;
    this.error = error;
    this.publicMessage = message;
    this.extra = extra;
  }
}

/** The words the station posts when the request comes on. */
export function heraldText(by, place) {
  const who = by || "a listener";
  return place ? `Tonight's request, from ${who}, calling from ${place}.` : `Tonight's request, from ${who}.`;
}

/**
 * The catalog by fileHash, fetched from the app and kept for hours; the last
 * good copy is kept when a fetch fails. Rows: {title, airDate, guestName, duration}.
 */
export function catalogReader(url = CATALOG_URL, { fetchImpl = fetch, now = Date.now, timeoutMs = 10_000 } = {}) {
  let cached = null;
  let at = -Infinity;
  return async () => {
    if (cached && now() - at < CATALOG_TTL_MS) return cached;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`catalog ${res.status}`);
      const rows = await res.json();
      const map = new Map();
      for (const r of rows) {
        if (r && typeof r.fileHash === "string") {
          map.set(r.fileHash, { title: r.title ?? r.fileName ?? "", airDate: r.airDate ?? null, guestName: r.guestName ?? null, duration: Number(r.duration) || 0 });
        }
      }
      cached = map;
      at = now();
    } catch (err) {
      if (!cached) throw err;
    }
    return cached;
  };
}

const MISSING = new Set(["42P01", "42883"]);

/**
 * @param {object} o
 * @param {import("pg").Pool} o.pool
 * @param {() => number} o.now
 * @param {() => Promise<Map<string, {title: string, airDate: string|null, guestName: string|null, duration: number}>>} o.catalog
 * @param {(text: string) => void} o.announce   post a station line in the lines
 * @param {() => Promise<any>} [o.onAir]        the slot on the air (archive.mjs scheduleReader)
 * @param {number|false} [o.heraldMs]           false: no herald timer (tests call `herald()`)
 */
export function createRequestLine({ pool, now, catalog, announce, onAir, heraldMs = HERALD_CHECK_MS, log = () => {} }) {
  const q = (sql, params) => pool.query(sql, params);

  async function lockNight(day, t = now()) {
    const { rows } = await q(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, nomination_id, file_hash, caller_name, caller_place, votes
         FROM live_request_night($1::date, to_timestamp($2::double precision / 1000))`,
      [day, t],
    );
    const r = rows[0];
    return r
      ? { day: r.day, nominationId: r.nomination_id === null ? null : Number(r.nomination_id), fileHash: r.file_hash, by: r.caller_name, place: r.caller_place, votes: Number(r.votes) }
      : null;
  }

  /** Whether the station played (or has on its program for) `fileHash` within the repeat window before `day`. */
  async function playedRecently(fileHash, day) {
    try {
      const { rows } = await q(
        `SELECT 1 FROM live_days d, jsonb_array_elements(d.program->'slots') s
          WHERE d.day BETWEEN $2::date - $3::int AND $2::date AND s->>'fileHash' = $1
          LIMIT 1`,
        [fileHash, day, REQUEST_REPEAT_DAYS],
      );
      if (rows.length) return true;
    } catch (err) {
      if (!MISSING.has(err.code)) throw err;
    }
    const { rows } = await q(
      `SELECT 1 FROM live_request_nights WHERE file_hash = $1 AND day BETWEEN $2::date - $3::int AND $2::date LIMIT 1`,
      [fileHash, day, REQUEST_REPEAT_DAYS],
    );
    return rows.length > 0;
  }

  async function knownBroken(fileHash) {
    try {
      const { rows } = await q(`SELECT ok FROM audio_checks WHERE file_hash = $1`, [fileHash]);
      return rows[0]?.ok === false;
    } catch (err) {
      if (MISSING.has(err.code)) return false;
      throw err;
    }
  }

  async function nominations(day, ref) {
    const { rows } = await q(
      `SELECT n.id, n.file_hash, n.title, n.air_date, n.guest, n.caller_name, n.caller_place, n.note,
              n.client_ref = $2 AS mine,
              count(v.client_ref)::int AS votes,
              bool_or(v.client_ref = $2) AS voted
         FROM live_request_nominations n
         LEFT JOIN live_request_votes v ON v.nomination_id = n.id
        WHERE n.day = $1::date AND n.vetoed_at IS NULL
        GROUP BY n.id
        ORDER BY count(v.client_ref) DESC, n.created_at, n.id`,
      [day, ref],
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
      votes: r.votes,
      mine: r.mine,
      voted: !!r.voted,
    }));
  }

  /** What the Request Line page and the Live note show this caller. */
  async function state(ref, t = now()) {
    const day = requestDayAt(t);
    const today = pacificDay(t);
    const [list, mineRows, tonight] = await Promise.all([
      nominations(day, ref),
      q(`SELECT 1 FROM live_request_nominations WHERE day = $1::date AND client_ref = $2`, [day, ref]),
      lockNight(today, t),
    ]);
    return {
      day,
      closesAt: requestCloseAt(day),
      startsAt: requestStartAt(day),
      nominations: list,
      nominated: mineRows.rows.length > 0,
      tonight: tonight && { day: tonight.day, fileHash: tonight.fileHash, by: tonight.by, place: tonight.place, votes: tonight.votes, startsAt: requestStartAt(today) },
    };
  }

  async function voteOn(nominationId, caller) {
    const { rows: cap } = await q(
      `SELECT count(*)::int AS n FROM live_request_votes WHERE nomination_id = $1 AND addr_ref = $2`,
      [nominationId, caller.addr],
    );
    if (cap[0].n >= VOTES_PER_ADDRESS) {
      throw new RequestRefusal(429, "address-votes", "Plenty of votes for this show from your network already.");
    }
    const { rowCount } = await q(
      `INSERT INTO live_request_votes (nomination_id, client_ref, addr_ref, at)
       VALUES ($1, $2, $3, to_timestamp($4::double precision / 1000))
       ON CONFLICT DO NOTHING`,
      [nominationId, caller.ref, caller.addr, now()],
    );
    return rowCount > 0;
  }

  async function votesFor(id) {
    const { rows } = await q(`SELECT count(*)::int AS n FROM live_request_votes WHERE nomination_id = $1`, [id]);
    return rows[0].n;
  }

  /**
   * Nominate `fileHash` for today's request (tomorrow's after 6 PM).
   * `note` has already been through the filter (or is null). `who` is the
   * caller's name and place now.
   */
  async function nominate(caller, { fileHash, note }, who) {
    const t = now();
    const day = requestDayAt(t);
    const row = typeof fileHash === "string" ? (await catalog()).get(fileHash) : undefined;
    if (!row || !(row.duration > 0)) throw new RequestRefusal(404, "not-a-show", "That show is not in the catalog.");
    const existing = await q(
      `SELECT id, vetoed_at FROM live_request_nominations WHERE day = $1::date AND file_hash = $2`,
      [day, fileHash],
    );
    if (existing.rows.length) {
      // Someone asked for it first: this is a vote.
      const n = existing.rows[0];
      if (n.vetoed_at) throw new RequestRefusal(410, "vetoed", "That show was taken off tonight's Request Line.");
      const counted = await voteOn(Number(n.id), caller);
      return { joined: true, id: Number(n.id), counted, votes: await votesFor(Number(n.id)), day };
    }
    const mine = await q(`SELECT 1 FROM live_request_nominations WHERE day = $1::date AND client_ref = $2`, [day, caller.ref]);
    if (mine.rows.length) {
      throw new RequestRefusal(409, "already-nominated", "You already picked a show today. Vote for others with one tap.");
    }
    if (await playedRecently(fileHash, day)) {
      throw new RequestRefusal(409, "played-recently", "The station played that one in the last 30 days. Pick another.");
    }
    if (await knownBroken(fileHash)) {
      throw new RequestRefusal(409, "broken-file", "That recording does not play all the way through. Pick another.");
    }
    let id;
    try {
      const { rows } = await q(
        `INSERT INTO live_request_nominations
           (day, file_hash, client_ref, addr_ref, caller_name, caller_place, note, title, air_date, guest, created_at)
         VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11::double precision / 1000))
         RETURNING id`,
        [day, fileHash, caller.ref, caller.addr, who.name, who.place, note, row.title, row.airDate, row.guestName, t],
      );
      id = Number(rows[0].id);
    } catch (err) {
      if (err.code !== "23505") throw err;
      // A race: the same show nominated, or this caller nominating, a moment ago.
      throw new RequestRefusal(409, "already-nominated", "That changed a moment ago. Have another look.");
    }
    await voteOn(id, caller);
    return { joined: false, id, counted: true, votes: await votesFor(id), day };
  }

  async function vote(caller, nominationId) {
    const { rows } = await q(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, vetoed_at FROM live_request_nominations WHERE id = $1`,
      [nominationId],
    );
    const n = rows[0];
    if (!n) throw new RequestRefusal(404, "no-such-nomination", "That pick is not on the Request Line.");
    if (n.vetoed_at) throw new RequestRefusal(410, "vetoed", "That show was taken off tonight's Request Line.");
    if (now() >= requestCloseAt(n.day)) throw new RequestRefusal(409, "closed", "Voting closed at 6 PM Pacific.");
    const counted = await voteOn(nominationId, caller);
    return { ok: true, counted, votes: await votesFor(nominationId) };
  }

  /** Admin. Before 10 PM, a vetoed winner unlocks the night so the runner-up takes it. */
  async function veto(nominationId) {
    const { rows } = await q(
      `UPDATE live_request_nominations SET vetoed_at = coalesce(vetoed_at, now()) WHERE id = $1
       RETURNING to_char(day, 'YYYY-MM-DD') AS day`,
      [nominationId],
    );
    if (!rows.length) throw new RequestRefusal(404, "no-such-nomination", "No such nomination.");
    const day = rows[0].day;
    let relocked = false;
    if (now() < requestStartAt(day)) {
      const del = await q(`DELETE FROM live_request_nights WHERE day = $1::date AND nomination_id = $2`, [day, nominationId]);
      relocked = del.rowCount > 0;
      if (relocked) await lockNight(day);
    }
    log(`[live] request ${nominationId} vetoed${relocked ? ", night relocked" : ""}`);
    return { ok: true, day, relocked };
  }

  /** Once the request is on the air: say so, once (announced_at). */
  async function herald() {
    if (!onAir) return false;
    const slot = await onAir().catch(() => null);
    if (!slot || slot.kind !== "request" || !slot.request?.day) return false;
    const { rows } = await q(
      `UPDATE live_request_nights SET announced_at = now()
        WHERE day = $1::date AND file_hash = $2 AND announced_at IS NULL
        RETURNING caller_name, caller_place`,
      [slot.request.day, slot.fileHash],
    );
    if (!rows.length) return false;
    announce(heraldText(rows[0].caller_name, rows[0].caller_place));
    log(`[live] request heralded for ${slot.request.day}`);
    return true;
  }

  async function sweep() {
    await q(`DELETE FROM live_request_nominations WHERE day < current_date - $1::int`, [REQUEST_RETENTION_DAYS]);
  }

  const timer = heraldMs === false ? null : setInterval(() => herald().catch((err) => log(`[live] herald: ${err.message}`)), heraldMs);
  timer?.unref?.();

  return { state, nominate, vote, veto, herald, lockNight, sweep, close: () => clearInterval(timer) };
}
