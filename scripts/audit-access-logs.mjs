#!/usr/bin/env node
/**
 * What nginx's access logs can say about visitors (docs/visitors.md, "What
 * we had before"). Read-only: it writes nothing, anywhere.
 *
 *   node scripts/audit-access-logs.mjs                       # /var/log/nginx/highdesert.access.log*
 *   node scripts/audit-access-logs.mjs --geo                 # and where, by country and US state
 *   node scripts/audit-access-logs.mjs path/to/access.log.3.gz ...
 *
 * Counts page loads (a GET of a page that answered 200, not an asset, an API
 * call or the mirror) from user agents that do not announce a robot, and the
 * distinct clients behind them per UTC day. A client is the address's bucket
 * (an IPv4 address, an IPv6 /64: src/lib/utils/client-key.ts) under an HMAC
 * whose key exists only in this process, so nothing printed or kept can be
 * turned back into an address.
 *
 * Why this is an audit and not a backfill: an address is not a browser. A
 * household is one address and many browsers; a phone moves between many
 * addresses in a day. The logs say roughly how many clients came on a day
 * and from where, inside the window logrotate kept (14 days by default on
 * Ubuntu). They cannot say which of them are the same browser as a funnel
 * arrival or a visitors row, so they are reported beside the count, never
 * added to it.
 */

import { createReadStream, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import path from "node:path";
import { clientKey, hashClientKey } from "../src/lib/utils/client-key.ts";

const LOG_DIR = "/var/log/nginx";
const LOG_PREFIX = "highdesert.access.log";

// combined: $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"
const LINE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) \S+ "[^"]*" "([^"]*)"/;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const NOT_A_PAGE = /^\/(_next|api|mirror|live-api|audio|seed|icons?|fonts?)\b|\.(js|css|map|png|jpe?g|gif|svg|ico|webp|avif|mp3|json|xml|txt|woff2?|webmanifest)(\?|$)/i;
const BOT = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|monitor|uptime|curl\/|wget\/|python-|node-fetch|axios\/|go-http|okhttp|^$/i;

/** `19/Oct/2026:02:10:11 +0000` → its UTC day. */
export function utcDay(timeLocal) {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(timeLocal);
  if (!m) return null;
  const off = (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
  const t = Date.UTC(Number(m[3]), MONTHS[m[2]], Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])) - off * 60_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** One log line → {day, ip, ua} for a page load by a person, else null. */
export function pageLoad(line) {
  const m = LINE.exec(line);
  if (!m) return null;
  const [, ip, time, method, url, status, ua] = m;
  if (method !== "GET" || status !== "200" || NOT_A_PAGE.test(url) || BOT.test(ua)) return null;
  const day = utcDay(time);
  return day ? { day, ip, ua } : null;
}

export async function audit(files, { geo = null } = {}) {
  const salt = randomBytes(32).toString("hex");
  const days = new Map(); // day -> Set(ref)
  const all = new Set();
  const places = new Map(); // ref -> "CC|Region"
  let loads = 0;
  for (const file of files) {
    const input = createReadStream(file);
    const lines = createInterface({ input: file.endsWith(".gz") ? input.pipe(createGunzip()) : input, crlfDelay: Infinity });
    for await (const line of lines) {
      const p = pageLoad(line);
      if (!p) continue;
      loads++;
      const ref = hashClientKey(clientKey(p.ip), salt);
      if (!days.has(p.day)) days.set(p.day, new Set());
      days.get(p.day).add(ref);
      all.add(ref);
      if (geo && !places.has(ref)) {
        const g = geo(p.ip);
        places.set(ref, `${g.country ?? "??"}|${g.region ?? ""}`);
      }
    }
  }
  const perDay = [...days].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, s]) => ({ day, clients: s.size }));
  const tally = (pick) => {
    const m = new Map();
    for (const v of places.values()) {
      const k = pick(v);
      if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  return {
    files: files.length,
    pageLoads: loads,
    earliest: perDay[0]?.day ?? null,
    latest: perDay.at(-1)?.day ?? null,
    distinctClients: all.size,
    perDay,
    countries: geo ? tally((v) => v.split("|")[0]) : null,
    states: geo ? tally((v) => (v.startsWith("US|") ? v.slice(3) || "(unknown)" : null)) : null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const wantGeo = args.includes("--geo");
  let files = args.filter((a) => !a.startsWith("--"));
  if (files.length === 0) {
    files = readdirSync(LOG_DIR)
      .filter((f) => f.startsWith(LOG_PREFIX))
      .map((f) => path.join(LOG_DIR, f));
  }
  const geo = wantGeo ? (await import("../src/lib/geo/geoip.ts")).lookup : null;
  const r = await audit(files, { geo });
  console.log(`files ${r.files}, page loads by people ${r.pageLoads}`);
  console.log(`window ${r.earliest} .. ${r.latest} (UTC), distinct clients over it ${r.distinctClients}`);
  for (const d of r.perDay) console.log(`  ${d.day}  ${d.clients}`);
  if (r.countries) {
    console.log("countries:", r.countries.slice(0, 25).map(([k, n]) => `${k} ${n}`).join(", "));
    console.log("US states:", r.states.slice(0, 60).map(([k, n]) => `${k} ${n}`).join(", "));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
