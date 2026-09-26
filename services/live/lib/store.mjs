/**
 * Every statement the phone lines run against Postgres (services/live/schema.sql).
 * Nothing here ever sees an address: a caller is `client_ref` and where they
 * came from is `addr_ref`, both HMACs (lib/caller.mjs).
 */

import { NAME_ACTIVE_MS, NAME_CHANGE_MS, RETENTION_MS } from "./config.mjs";
import { LINES, lineFor, nameKey } from "./names.mjs";

// `id` goes out as text (a bigint must not round through a JS number), so the
// sort key is carried separately as `seq`: ordering by the text alias put
// "999" after "1923", and hello served the wrong fifty once ids passed 999.
const MESSAGE_COLUMNS = `id::text AS id, id AS seq, at, caller_name AS name, line, body`;

/**
 * The public shape of a message: no client ref, ever, and the line as its
 * label. The row stores the line's index; the live broadcast used to be the
 * only path that turned it into a label, so a reload replayed a caller's own
 * messages as "5" under a header that said "Line 6".
 */
export function publicMessage(row) {
  return {
    id: Number(row.id),
    at: new Date(row.at).toISOString(),
    name: row.name,
    line: LINES[row.line] ?? LINES[0],
    body: row.body,
  };
}

export function createStore(pool, { settingsKey = "slow_mode" } = {}) {
  const q = (text, params) => pool.query(text, params);

  return {
    async insertMessage({ clientRef, addrRef, name, line, body }) {
      const { rows } = await q(
        `INSERT INTO live_messages (client_ref, addr_ref, caller_name, line, body)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${MESSAGE_COLUMNS}`,
        [clientRef, addrRef ?? null, name, line, body],
      );
      return publicMessage(rows[0]);
    },

    /** The newest `limit` visible messages, oldest first. */
    async recentVisible(limit) {
      const { rows } = await q(
        `SELECT * FROM (
           SELECT ${MESSAGE_COLUMNS} FROM live_messages
           WHERE hidden_at IS NULL ORDER BY seq DESC LIMIT $1
         ) m ORDER BY seq`,
        [limit],
      );
      return rows.map(publicMessage);
    },

    /** Visible messages after `afterId`, oldest first — a reconnecting stream's catch-up. */
    async visibleAfter(afterId, limit) {
      const { rows } = await q(
        `SELECT * FROM (
           SELECT ${MESSAGE_COLUMNS} FROM live_messages
           WHERE hidden_at IS NULL AND id > $1 ORDER BY seq DESC LIMIT $2
         ) m ORDER BY seq`,
        [afterId, limit],
      );
      return rows.map(publicMessage);
    },

    async recentlyHidden(withinMs) {
      const { rows } = await q(
        `SELECT id::text AS id FROM live_messages WHERE hidden_at >= now() - make_interval(secs => $1)`,
        [withinMs / 1000],
      );
      return rows.map((r) => Number(r.id));
    },

    /**
     * Server-side view of one message, including whose it is and where from.
     * A legacy message (before per-browser callers) has no addr_ref, and its
     * client_ref was the address, so that is where it came from.
     */
    async getMessage(id) {
      const { rows } = await q(
        `SELECT id::text AS id, client_ref, addr_ref, hidden_at FROM live_messages WHERE id = $1`,
        [id],
      );
      const r = rows[0];
      return r
        ? { id: Number(r.id), clientRef: r.client_ref, addrRef: r.addr_ref ?? r.client_ref, hidden: !!r.hidden_at }
        : null;
    },

    /** Hide one message. True only if it was visible (so the caller broadcasts once). */
    async hideMessage(id, by) {
      const { rowCount } = await q(
        `UPDATE live_messages SET hidden_at = now(), hidden_by = $2 WHERE id = $1 AND hidden_at IS NULL`,
        [id, by],
      );
      return rowCount === 1;
    },

    /** Hide everything a caller said in the last `withinMs`. Returns the ids hidden. */
    async hideFrom(clientRef, withinMs, by) {
      const { rows } = await q(
        `UPDATE live_messages SET hidden_at = now(), hidden_by = $3
         WHERE client_ref = $1 AND hidden_at IS NULL AND at >= now() - make_interval(secs => $2)
         RETURNING id::text AS id`,
        [clientRef, withinMs / 1000, by],
      );
      return rows.map((r) => Number(r.id));
    },

    /**
     * File a report. Idempotent per (message, reporter). Returns how many
     * distinct *addresses* have now reported the message: one person with many
     * cookies is one reporter. (A legacy report's client_ref was its address.)
     */
    async addReport(messageId, clientRef, addrRef) {
      await q(
        `INSERT INTO live_reports (message_id, client_ref, addr_ref) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [messageId, clientRef, addrRef ?? null],
      );
      const { rows } = await q(
        `SELECT count(DISTINCT COALESCE(addr_ref, client_ref))::int AS n FROM live_reports WHERE message_id = $1`,
        [messageId],
      );
      return rows[0].n;
    },

    /** Mute until `untilMs` — never shortens an existing, longer mute. */
    async mute(clientRef, untilMs, reason) {
      await q(
        `INSERT INTO live_mutes (client_ref, until, reason) VALUES ($1, to_timestamp($2 / 1000.0), $3)
         ON CONFLICT (client_ref) DO UPDATE SET
           until = GREATEST(live_mutes.until, EXCLUDED.until),
           reason = CASE WHEN EXCLUDED.until >= live_mutes.until THEN EXCLUDED.reason ELSE live_mutes.reason END`,
        [clientRef, untilMs, reason],
      );
    },

    async activeMute(clientRef) {
      const { rows } = await q(
        `SELECT until, reason FROM live_mutes WHERE client_ref = $1 AND until > now()`,
        [clientRef],
      );
      return rows[0] ? { until: new Date(rows[0].until).getTime(), reason: rows[0].reason } : null;
    },

    async ban(clientRef) {
      await q(`INSERT INTO live_bans (client_ref) VALUES ($1) ON CONFLICT DO NOTHING`, [clientRef]);
    },

    async allBans() {
      const { rows } = await q(`SELECT client_ref FROM live_bans`);
      return rows.map((r) => r.client_ref);
    },

    /** A caller's name and line (the line's index; null until assigned). */
    async getName(clientRef) {
      const { rows } = await q(`SELECT name, changed_at, line FROM live_names WHERE client_ref = $1`, [clientRef]);
      return rows[0]
        ? {
            name: rows[0].name,
            line: rows[0].line,
            changedAt: rows[0].changed_at ? new Date(rows[0].changed_at).getTime() : null,
          }
        : null;
    },

    async touch(clientRef, addrRef) {
      await q(
        `INSERT INTO live_names (client_ref, addr_ref) VALUES ($1, $2)
         ON CONFLICT (client_ref) DO UPDATE SET seen_at = now(), addr_ref = COALESCE(EXCLUDED.addr_ref, live_names.addr_ref)`,
        [clientRef, addrRef ?? null],
      );
    },

    /**
     * Give a caller a line, once. `preferred` (a stable function of the ref)
     * unless another caller from the same address in the last 30 days has it,
     * in which case the next free one: two browsers in one household are on
     * two lines. Returns the line index the caller ends up with.
     */
    async assignLine(clientRef, addrRef, preferred) {
      let line = preferred;
      if (addrRef) {
        const { rows } = await q(
          `SELECT DISTINCT line FROM live_names
           WHERE addr_ref = $1 AND client_ref <> $2 AND line IS NOT NULL AND seen_at >= now() - interval '30 days'`,
          [addrRef, clientRef],
        );
        const used = new Set(rows.map((r) => r.line));
        for (let i = 0; i < LINES.length; i++) {
          const candidate = (preferred + i) % LINES.length;
          if (!used.has(candidate)) {
            line = candidate;
            break;
          }
        }
      }
      const { rows } = await q(
        `INSERT INTO live_names (client_ref, addr_ref, line) VALUES ($1, $2, $3)
         ON CONFLICT (client_ref) DO UPDATE SET line = COALESCE(live_names.line, EXCLUDED.line)
         RETURNING line`,
        [clientRef, addrRef ?? null, line],
      );
      return rows[0].line;
    },

    /** Has this caller ever talked: a message still retained, or a name they chose? */
    async hasSpoken(clientRef) {
      const { rows } = await q(
        `SELECT EXISTS (SELECT 1 FROM live_messages WHERE client_ref = $1)
             OR EXISTS (SELECT 1 FROM live_names WHERE client_ref = $1 AND changed_at IS NOT NULL) AS spoken`,
        [clientRef],
      );
      return rows[0].spoken;
    },

    /**
     * Hand a legacy caller (keyed by its address, before per-browser callers)
     * to `clientRef`, a browser arriving from that address with no cookie:
     * name, line, rename clock, messages, reports, mute and ban. Only the first
     * such browser gets it (the row moves), and only if the legacy caller was
     * seen inside `withinMs`. Returns { name, banned } or null.
     */
    async adoptLegacy(addrRef, clientRef, withinMs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `UPDATE live_names SET client_ref = $2, addr_ref = $1, line = COALESCE(line, $3)
           WHERE client_ref = $1 AND seen_at >= now() - make_interval(secs => $4)
             AND NOT EXISTS (SELECT 1 FROM live_names WHERE client_ref = $2)
           RETURNING name`,
          [addrRef, clientRef, lineFor(addrRef), withinMs / 1000],
        );
        if (!rows.length) {
          await client.query("ROLLBACK");
          return null;
        }
        await client.query(
          `UPDATE live_messages SET client_ref = $2, addr_ref = COALESCE(addr_ref, $1) WHERE client_ref = $1`,
          [addrRef, clientRef],
        );
        await client.query(
          `UPDATE live_reports SET client_ref = $2, addr_ref = COALESCE(addr_ref, $1) WHERE client_ref = $1`,
          [addrRef, clientRef],
        );
        await client.query(`UPDATE live_mutes SET client_ref = $2 WHERE client_ref = $1`, [addrRef, clientRef]);
        const ban = await client.query(`UPDATE live_bans SET client_ref = $2 WHERE client_ref = $1`, [addrRef, clientRef]);
        await client.query("COMMIT");
        return { name: rows[0].name, banned: ban.rowCount > 0 };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    /** Hold an address after a ban (never shortens an existing hold). */
    async holdAddress(addrRef, untilMs, nextAtMs) {
      await q(
        `INSERT INTO live_address_holds (addr_ref, until, next_at)
         VALUES ($1, to_timestamp($2 / 1000.0), to_timestamp($3 / 1000.0))
         ON CONFLICT (addr_ref) DO UPDATE SET
           until = GREATEST(live_address_holds.until, EXCLUDED.until),
           next_at = GREATEST(live_address_holds.next_at, EXCLUDED.next_at)`,
        [addrRef, untilMs, nextAtMs],
      );
    },

    /**
     * May a new caller from this address start talking? Outside a hold, yes.
     * Inside one, only if the hold's slot is open, which this takes (the next
     * opens `intervalMs` later). Returns { ok } or { ok: false, retryAfterMs }.
     */
    async takeHoldSlot(addrRef, intervalMs) {
      const took = await q(
        `UPDATE live_address_holds SET next_at = now() + make_interval(secs => $2)
         WHERE addr_ref = $1 AND until > now() AND next_at <= now()`,
        [addrRef, intervalMs / 1000],
      );
      if (took.rowCount === 1) return { ok: true };
      const { rows } = await q(
        `SELECT GREATEST(0, EXTRACT(EPOCH FROM (next_at - now())) * 1000)::bigint AS wait
         FROM live_address_holds WHERE addr_ref = $1 AND until > now()`,
        [addrRef],
      );
      return rows[0] ? { ok: false, retryAfterMs: Number(rows[0].wait) } : { ok: true };
    },

    /**
     * Give `clientRef` the name `name`, if nobody active holds it.
     *
     * `isConnected(ref)` is the hub's in-memory answer; a holder who is neither
     * connected nor seen inside NAME_ACTIVE_MS loses the name (theirs is
     * cleared, and they are given a fresh one when they come back). The unique
     * index on name_key settles any race: a violation is "taken".
     *
     * @returns {"ok" | "taken"}
     */
    async claimName(clientRef, name, { isConnected, markChanged }) {
      const key = nameKey(name);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `SELECT client_ref, seen_at >= now() - make_interval(secs => $2) AS recent
           FROM live_names WHERE name_key = $1 FOR UPDATE`,
          [key, NAME_ACTIVE_MS / 1000],
        );
        const holder = rows[0];
        if (holder && holder.client_ref !== clientRef) {
          if (holder.recent || isConnected(holder.client_ref)) {
            await client.query("ROLLBACK");
            return "taken";
          }
          await client.query(`UPDATE live_names SET name = NULL, name_key = NULL WHERE client_ref = $1`, [
            holder.client_ref,
          ]);
        }
        await client.query(
          `INSERT INTO live_names (client_ref, name, name_key, changed_at, seen_at)
           VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END, now())
           ON CONFLICT (client_ref) DO UPDATE SET
             name = EXCLUDED.name, name_key = EXCLUDED.name_key, seen_at = now(),
             changed_at = CASE WHEN $4 THEN now() ELSE live_names.changed_at END`,
          [clientRef, name, key, !!markChanged],
        );
        await client.query("COMMIT");
        return "ok";
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        if (err && err.code === "23505") return "taken";
        throw err;
      } finally {
        client.release();
      }
    },

    /** How long until this caller may rename, in ms (0 = now). */
    async renameWaitMs(clientRef) {
      const { rows } = await q(
        `SELECT GREATEST(0, EXTRACT(EPOCH FROM (changed_at + make_interval(secs => $2) - now())) * 1000)::bigint AS wait
         FROM live_names WHERE client_ref = $1 AND changed_at IS NOT NULL`,
        [clientRef, NAME_CHANGE_MS / 1000],
      );
      return rows[0] ? Number(rows[0].wait) : 0;
    },

    /** Rewrite the caller name on a caller's retained messages (admin clear-name). */
    async renameMessages(clientRef, name) {
      const { rows } = await q(
        `UPDATE live_messages SET caller_name = $2 WHERE client_ref = $1 RETURNING id::text AS id`,
        [clientRef, name],
      );
      return rows.map((r) => Number(r.id));
    },

    async getForcedSlow() {
      const { rows } = await q(`SELECT value FROM live_settings WHERE key = $1`, [settingsKey]);
      const until = rows[0]?.value?.until;
      return typeof until === "number" ? until : null;
    },

    async setForcedSlow(untilMs) {
      await q(
        `INSERT INTO live_settings (key, value, at) VALUES ($2, $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()`,
        [JSON.stringify({ until: untilMs }), settingsKey],
      );
    },

    /** Spend a one-time sign-in nonce (by its SHA-256). True exactly once, and only before expiry. */
    async consumeNonce(hash) {
      const { rowCount } = await q(
        `UPDATE live_admin_nonces SET used_at = now()
         WHERE hash = $1 AND used_at IS NULL AND expires_at > now()`,
        [hash],
      );
      return rowCount === 1;
    },

    async addNonce(hash, expiresAtMs) {
      await q(`INSERT INTO live_admin_nonces (hash, expires_at) VALUES ($1, to_timestamp($2 / 1000.0))`, [
        hash,
        expiresAtMs,
      ]);
    },

    /** Insert a hidden row, read it back, delete it. Returns the id it used. */
    async verifyRoundTrip() {
      const ref = "0".repeat(64);
      const { rows } = await q(
        `INSERT INTO live_messages (client_ref, caller_name, line, body, hidden_at, hidden_by)
         VALUES ($1, 'deploy verify', 0, 'deploy verify', now(), 'admin') RETURNING id::text AS id`,
        [ref],
      );
      const id = Number(rows[0].id);
      const back = await q(`SELECT body FROM live_messages WHERE id = $1`, [id]);
      const del = await q(`DELETE FROM live_messages WHERE id = $1`, [id]);
      if (back.rows[0]?.body !== "deploy verify" || del.rowCount !== 1) throw new Error("verify round trip failed");
      return id;
    },

    async messagesSince(ms) {
      const { rows } = await q(
        `SELECT count(*)::int AS n FROM live_messages WHERE at >= now() - make_interval(secs => $1)`,
        [ms / 1000],
      );
      return rows[0].n;
    },

    /**
     * Retention. Messages (and, by cascade, their reports) past RETENTION_MS;
     * expired mutes; spent or expired nonces; names nobody has used in 30 days.
     */
    async sweep(retentionMs = RETENTION_MS) {
      const { rowCount } = await q(
        `DELETE FROM live_messages WHERE at < now() - make_interval(secs => $1)`,
        [retentionMs / 1000],
      );
      await q(`DELETE FROM live_mutes WHERE until < now()`);
      await q(`DELETE FROM live_address_holds WHERE until < now()`);
      await q(`DELETE FROM live_admin_nonces WHERE expires_at < now() - interval '1 day'`);
      await q(`DELETE FROM live_names WHERE seen_at < now() - interval '30 days'`);
      return rowCount;
    },
  };
}
