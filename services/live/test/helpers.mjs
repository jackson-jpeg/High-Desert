/**
 * An in-process highdesert-live on a random port, against the *_test database,
 * with simulated callers. A caller is an address: requests come from loopback
 * and carry X-Forwarded-For, exactly as nginx sends them, so every test goes
 * through the real identity path (clientKey → HMAC), not a test hook.
 */

import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { TEST_DATABASE_URL } from "../../../src/test-support/test-db.ts";
import { createLiveApp } from "../lib/app.mjs";

export { TEST_DATABASE_URL };
export const ORIGIN = "https://highdesert.space";
const SCHEMA = path.resolve(import.meta.dirname, "../schema.sql");

let schemaApplied = null;
export function testPool() {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 6 });
  if (!schemaApplied) {
    schemaApplied = readFile(SCHEMA, "utf8").then(async (sql) => {
      const c = await pool.connect();
      try {
        // Several test files may apply it at once; serialise on a lock.
        await c.query("SELECT pg_advisory_lock(hashtext('live-schema'))");
        await c.query("SET client_min_messages = warning");
        await c.query(sql);
      } finally {
        await c.query("SELECT pg_advisory_unlock(hashtext('live-schema'))").catch(() => {});
        c.release();
      }
    });
  }
  return { pool, ready: schemaApplied };
}

let callerSeq = 0;
/** A distinct documentation-range address per simulated caller. */
export function newCaller() {
  callerSeq++;
  const r = randomBytes(2);
  return `198.51.${r[0]}.${(r[1] + callerSeq) % 254 + 1}`;
}

export async function startLive(opts = {}) {
  const { pool, ready } = testPool();
  await ready;
  const adminToken = opts.adminToken ?? randomBytes(32).toString("hex");
  const logs = [];
  const app = createLiveApp({
    pool,
    clientSecret: randomBytes(32).toString("hex"),
    adminToken,
    settingsKey: `test-${randomBytes(6).toString("hex")}`,
    log: (m) => logs.push(m),
    ...opts,
  });
  await app.ready;
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function post(p, body, { ip = "198.51.100.1", origin = ORIGIN, type = "application/json", headers = {} } = {}) {
    const res = await fetch(base + p, {
      method: "POST",
      headers: {
        ...(type ? { "content-type": type } : {}),
        ...(origin ? { origin } : {}),
        "x-forwarded-for": ip,
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, headers: res.headers };
  }

  async function get(p, { ip = "198.51.100.1", headers = {} } = {}) {
    const res = await fetch(base + p, { headers: { "x-forwarded-for": ip, ...headers } });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, headers: res.headers };
  }

  /** Open an SSE stream as `ip`. Events arrive in `events`; `next(name)` awaits the next one of that name. */
  async function stream({ ip = "198.51.100.1", headers = {}, query = "" } = {}) {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/live-api/stream${query}`, {
      headers: { "x-forwarded-for": ip, accept: "text/event-stream", ...headers },
      signal: ctrl.signal,
    });
    const events = [];
    const waiters = [];
    const s = { status: res.status, headers: res.headers, events, raw: "", close: () => ctrl.abort() };
    if (res.status !== 200) {
      s.json = await res.json().catch(() => null);
      return s;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          s.raw += chunk;
          buf += chunk;
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = { event: "message", data: null, id: undefined, at: Date.now() };
            let data = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event: ")) ev.event = line.slice(7);
              else if (line.startsWith("data: ")) data += line.slice(6);
              else if (line.startsWith("id: ")) ev.id = line.slice(4);
            }
            if (!data) continue;
            ev.data = JSON.parse(data);
            events.push(ev);
            for (const w of [...waiters]) {
              if (w.test(ev)) {
                waiters.splice(waiters.indexOf(w), 1);
                w.resolve(ev);
              }
            }
          }
        }
      } catch {}
      s.ended = true;
    })();
    s.next = (name, pred = () => true, timeoutMs = 3_000) =>
      new Promise((resolve, reject) => {
        const found = events.find((e) => e.event === name && pred(e.data) && !e.claimed);
        if (found) {
          found.claimed = true;
          return resolve(found);
        }
        const w = {
          test: (e) => e.event === name && pred(e.data),
          resolve: (e) => {
            e.claimed = true;
            clearTimeout(timer);
            resolve(e);
          },
        };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          reject(new Error(`no "${name}" event within ${timeoutMs}ms`));
        }, timeoutMs);
        waiters.push(w);
      });
    return s;
  }

  return {
    app,
    base,
    pool,
    adminToken,
    logs,
    post,
    get,
    stream,
    admin: (action, body, o = {}) =>
      post(`/live-api/admin/${action}`, body, { ...o, headers: { authorization: `Bearer ${adminToken}`, ...(o.headers ?? {}) } }),
    async close() {
      app.close();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      await pool.end();
    },
  };
}

/**
 * A body nobody else in the test DB has said. Consonants only — no digits (a
 * run of seven would read as a phone number) and no vowels (no accidental words).
 */
export const token = (n = 10) => [...randomBytes(n)].map((b) => "bdghjkmnpqrxz"[b % 13]).join("");
export const unique = (label = "note") => `${label} ${token()} about the desert`;
