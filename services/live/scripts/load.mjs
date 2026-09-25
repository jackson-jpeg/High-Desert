#!/usr/bin/env node
/**
 * Load test for highdesert-live: N simulated callers, each holding an SSE
 * stream and posting every 20-60 s, plus a burst of 20 simultaneous posts
 * every 30 s. Measures delivery latency (post sent -> event received, per
 * receiver), lost deliveries, and the service's CPU.
 *
 *   # Local: spawns its own instance (nice -n 10) against a *_test database.
 *   LIVE_DATABASE_URL=$TEST_DATABASE_URL nice -n 10 node services/live/scripts/load.mjs --spawn --identity header
 *
 *   # Production, after deploy (on the VPS; talks to 127.0.0.1:3005 directly):
 *   set -a; . /root/.high-desert-live.env; set +a
 *   nice -n 10 node services/live/scripts/load.mjs --unit highdesert-live --cleanup
 *
 * Options:
 *   --clients N        simulated callers (200)
 *   --duration S       seconds of load after everyone has connected (120)
 *   --spawn            start a local instance on --port (3905) with LIVE_LOAD_TEST=1
 *   --url URL          the service (http://127.0.0.1:3005)
 *   --unit NAME        read CPU from the unit's cgroup (cpu.stat usage_usec)
 *   --pid N            read CPU from /proc/N/stat instead
 *   --identity xff|header
 *                      how callers are told apart. `xff` (default) sends a distinct
 *                      X-Forwarded-For per caller from the 198.18.0.0/15 benchmark
 *                      range: the path nginx traffic takes, and the one that works
 *                      against the production unit. `header` sends x-live-test-client,
 *                      honoured only by an instance started with LIVE_LOAD_TEST=1.
 *   --cleanup          afterwards, delete the messages this run posted and the
 *                      names it was given (needs LIVE_DATABASE_URL)
 *
 * Posts are visible to anyone on the lines while it runs: run it in a quiet hour.
 *
 * The 10% rule: highdesert-live must average at most 10% of one core over the
 * window. Exits 1 if it does not, or if any delivery was lost.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const CLIENTS = Number(opt("clients", 200));
const DURATION_S = Number(opt("duration", 120));
const SPAWN = opt("spawn", false) === true;
const PORT = Number(opt("port", 3905));
const URL_BASE = SPAWN ? `http://127.0.0.1:${PORT}` : opt("url", "http://127.0.0.1:3005");
const UNIT = opt("unit", null);
let PID = opt("pid", null);
const IDENTITY = opt("identity", "xff");
const CLEANUP = opt("cleanup", false) === true;
const ORIGIN = opt("origin", "https://highdesert.space");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const WORDS = "desert static signal midnight caller lines tonopah rachel beatty coyote mesa canyon starlight radio tower antenna".split(" ");
// Consonants only, and none of f/c/s/t/v/w: a random tag can never spell (or
// leet-spell) a word the filter would mask or refuse, which would change the body.
const ALPHA = "bdghjkmnpqrxz";
const tag = () => [...randomBytes(6)].map((b) => ALPHA[b % ALPHA.length]).join("");

// ---- CPU of the service ------------------------------------------------------

function cpuUsec() {
  if (UNIT) {
    const text = readFileSync(`/sys/fs/cgroup/system.slice/${UNIT}.service/cpu.stat`, "utf8");
    return Number(/usage_usec (\d+)/.exec(text)[1]);
  }
  if (PID) {
    // utime and stime, in clock ticks (100/s), after the parenthesised comm.
    const f = readFileSync(`/proc/${PID}/stat`, "utf8").split(") ")[1].split(" ");
    return ((Number(f[11]) + Number(f[12])) / 100) * 1e6;
  }
  return null;
}

// ---- a local instance ----------------------------------------------------------

let child = null;
async function startLocal() {
  const env = {
    ...process.env,
    LIVE_PORT: String(PORT),
    LIVE_HOST: "127.0.0.1",
    LIVE_LOAD_TEST: "1",
    CHAT_CLIENT_SECRET: process.env.CHAT_CLIENT_SECRET ?? randomBytes(32).toString("hex"),
    LIVE_ADMIN_TOKEN: process.env.LIVE_ADMIN_TOKEN ?? randomBytes(32).toString("hex"),
  };
  if (!env.LIVE_DATABASE_URL) throw new Error("--spawn needs LIVE_DATABASE_URL (a *_test database)");
  if (!new URL(env.LIVE_DATABASE_URL).pathname.endsWith("_test")) throw new Error("--spawn refuses a database not named *_test");
  // `nice` execs node, so the child's pid is the server's.
  child = spawn("nice", ["-n", "10", process.execPath, path.resolve(import.meta.dirname, "../server.mjs")], {
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  PID = child.pid;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${URL_BASE}/live-api/health`)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error("local instance did not come up");
}

// ---- callers -------------------------------------------------------------------

function identityHeaders(i) {
  if (IDENTITY === "header") return { "x-live-test-client": `load-${i}` };
  return { "x-forwarded-for": `198.18.${Math.floor(i / 250)}.${(i % 250) + 1}` };
}

const sentAt = new Map(); // body -> time sent
const latencies = [];
const myIds = new Set();
const names = new Set();
const status = new Map();
let delivered = 0;
let posted = 0;

const run = { stopAt: Infinity };
let releaseAll;
const everyoneUp = new Promise((r) => (releaseAll = r));

async function caller(i, connected) {
  const headers = identityHeaders(i);
  const ctrl = new AbortController();
  const res = await fetch(`${URL_BASE}/live-api/stream`, {
    headers: { ...headers, accept: "text/event-stream" },
    signal: ctrl.signal,
  });
  if (res.status !== 200) throw new Error(`caller ${i}: stream ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let helloSeen = false;
  const readLoop = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let k;
        while ((k = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, k);
          buf = buf.slice(k + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (!data) continue;
          if (ev === "hello") {
            names.add(JSON.parse(data).you.name);
            if (!helloSeen) connected();
            helloSeen = true;
          } else if (ev === "message") {
            const t = sentAt.get(JSON.parse(data).body);
            if (t !== undefined) {
              latencies.push(performance.now() - t);
              delivered++;
            }
          }
        }
      }
    } catch {}
  })();

  await everyoneUp;
  // Each caller posts every 20-60 s; the first lands anywhere in the first minute.
  let wait = rand(0, 60_000);
  for (;;) {
    if (wait >= run.stopAt - performance.now()) break;
    await sleep(wait);
    await post(i, headers);
    wait = rand(20_000, 60_000);
  }
  // Everyone stays on until the last post has had time to arrive.
  await sleep(Math.max(0, run.stopAt + 3_000 - performance.now()));
  ctrl.abort();
  await readLoop;
}

async function post(i, headers) {
  const body = `load ${i} ${WORDS[Math.floor(Math.random() * WORDS.length)]} ${tag()}`;
  sentAt.set(body, performance.now());
  const r = await fetch(`${URL_BASE}/live-api/messages`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ body }),
  });
  status.set(r.status, (status.get(r.status) ?? 0) + 1);
  if (r.status === 201) {
    posted++;
    myIds.add((await r.json()).id);
  } else {
    sentAt.delete(body);
    await r.text();
  }
}

async function cleanup() {
  const url = process.env.LIVE_DATABASE_URL;
  if (!url) {
    console.warn("[load] --cleanup needs LIVE_DATABASE_URL; nothing deleted");
    return;
  }
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const m = await pool.query(`DELETE FROM live_messages WHERE id = ANY($1::bigint[])`, [[...myIds]]);
  const n = await pool.query(
    `DELETE FROM live_names WHERE name = ANY($1::text[]) AND seen_at >= now() - interval '1 day'`,
    [[...names]],
  );
  await pool.end();
  console.log(`[load] cleanup: ${m.rowCount} message(s), ${n.rowCount} name(s) deleted`);
}

async function main() {
  if (SPAWN) await startLocal();
  console.log(`[load] ${CLIENTS} callers against ${URL_BASE} for ${DURATION_S}s (identity: ${IDENTITY})`);

  let up = 0;
  let allConnected;
  const allUp = new Promise((r) => (allConnected = r));
  const connected = () => {
    up++;
    if (up === CLIENTS) allConnected();
  };
  const runs = [];
  for (let i = 0; i < CLIENTS; i++) {
    await sleep(5); // a ramp, not a thundering herd
    runs.push(caller(i, connected).catch((e) => console.error(`[load] ${e.message}`)));
  }
  await Promise.race([allUp, sleep(60_000)]);
  if (up < CLIENTS) console.warn(`[load] only ${up}/${CLIENTS} connected`);

  const cpu0 = cpuUsec();
  const w0 = performance.now();
  run.stopAt = w0 + DURATION_S * 1000;
  releaseAll();
  const burst = setInterval(() => {
    if (performance.now() > run.stopAt - 1_000) return;
    for (let k = 0; k < 20; k++) {
      const i = Math.floor(Math.random() * CLIENTS);
      void post(i, identityHeaders(i));
    }
  }, 30_000);

  await Promise.all(runs);
  clearInterval(burst);
  const cpu1 = cpuUsec();
  const wall = performance.now() - w0;

  const sorted = latencies.sort((a, b) => a - b);
  const q = (p) => (sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1)) : null);
  const expected = posted * up;
  const cpuPct = cpu0 !== null && cpu1 !== null ? ((cpu1 - cpu0) / (wall * 1000)) * 100 : null;

  const report = {
    callers: CLIENTS,
    connected: up,
    windowS: Math.round(wall / 1000),
    posted,
    responses: Object.fromEntries(status),
    deliveries: { received: delivered, expected, lost: Math.max(0, expected - delivered) },
    latencyMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted.length ? Number(sorted[sorted.length - 1].toFixed(1)) : null },
    serviceCpuPctOfOneCore: cpuPct === null ? "not measured (use --spawn, --unit or --pid)" : Number(cpuPct.toFixed(2)),
    rule: "<= 10% of one core",
  };
  console.log(JSON.stringify(report, null, 2));

  if (CLEANUP) await cleanup();
  if (child) child.kill("SIGTERM");
  const ok = (cpuPct === null || cpuPct <= 10) && report.deliveries.lost === 0;
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  if (child) child.kill("SIGTERM");
  process.exit(1);
});
