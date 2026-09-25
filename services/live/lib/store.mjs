/**
 * Every statement the phone lines run against Postgres (services/live/schema.sql).
 * Nothing here ever sees an address: callers are `client_ref`, an HMAC.
 */

import { NAME_ACTIVE_MS, NAME_CHANGE_MS, RETENTION_MS } from "./config.mjs";
import { nameKey } from "./names.mjs";

// `id` goes out as text (a bigint must not round through a JS number), so the
// sort key is carried separately as `seq`: ordering by the text alias put
// "999" after "1923", and hello served the wrong fifty once ids passed 999.
const MESSAGE_COLUMNS = `id::text AS id, id AS seq, at, caller_name AS name, line, body`;

/** The public shape of a message: no client ref, ever. */
export function publicMessage(row) {
  return {
    id: Number(row.id),
    at: new Date(row.at).toISOString(),
    name: row.name,
    line: row.line,
    body: row.body,
  };
}

export function createStore(pool, { settingsKey = "slow_mode" } = {}) {
  const q = (text, params) => pool.query(text, params);

  return {
    async insertMessage({ clientRef, name, line, body }) {
      const { rows } = await q(
        `INSERT INTO live_messages (client_ref, caller_name, line, body)
         VALUES ($1, $2, $3, $4) RETURNING ${MESSAGE_COLUMNS}`,
        [clientRef, name, line, body],
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

    /** Server-side view of one message, including whose it is. */
    async getMessage(id) {
      const { rows } = await q(
        `SELECT id::text AS id, client_ref, hidden_at FROM live_messages WHERE id = $1`,
        [id],
      );
      return rows[0] ? { id: Number(rows[0].id), clientRef: rows[0].client_ref, hidden: !!rows[0].hidden_at } : null;
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
     * distinct clients have now reported the message.
     */
    async addReport(messageId, clientRef) {
      const { rows } = await q(
        `WITH ins AS (
           INSERT INTO live_reports (message_id, client_ref) VALUES ($1, $2)
           ON CONFLICT DO NOTHING RETURNING client_ref
         )
         SELECT (SELECT count(*) FROM live_reports WHERE message_id = $1)
              + (SELECT count(*) FROM ins) AS n`,
        [messageId, clientRef],
      );
      return Number(rows[0].n);
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

    async getName(clientRef) {
      const { rows } = await q(`SELECT name, changed_at FROM live_names WHERE client_ref = $1`, [clientRef]);
      return rows[0]
        ? { name: rows[0].name, changedAt: rows[0].changed_at ? new Date(rows[0].changed_at).getTime() : null }
        : null;
    },

    async touch(clientRef) {
      await q(
        `INSERT INTO live_names (client_ref) VALUES ($1)
         ON CONFLICT (client_ref) DO UPDATE SET seen_at = now()`,
        [clientRef],
      );
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
      await q(`DELETE FROM live_admin_nonces WHERE expires_at < now() - interval '1 day'`);
      await q(`DELETE FROM live_names WHERE seen_at < now() - interval '30 days'`);
      return rowCount;
    },
  };
}
