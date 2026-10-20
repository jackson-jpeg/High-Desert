#!/usr/bin/env node
/**
 * Refresh the self-hosted geo database (docs/visitors.md, "Location").
 *
 * Run monthly by highdesert-geoip.timer, and once by hand on setup:
 *
 *   node scripts/update-geoip.mjs            # download, check, install
 *   node scripts/update-geoip.mjs --check    # check the installed file only
 *
 * Source, by default: DB-IP's free "IP to City Lite" MMDB (CC BY 4.0, no
 * account), https://download.db-ip.com/free/dbip-city-lite-YYYY-MM.mmdb.gz,
 * this month's or else last month's. With GEOIP_MAXMIND_LICENSE_KEY set
 * (a free MaxMind account), GeoLite2 City instead, which also reports an
 * accuracy radius, the only thing that lets a city be shown (geoip.ts).
 *
 * The file is checked before it replaces anything: it must open, be a City
 * database, be built within 75 days, and resolve 8.8.8.8 to the US and
 * 1.1.1.1 to a country. Then it is renamed into place atomically
 * (GEOIP_DB, default /var/lib/highdesert-geoip/city.mmdb); the app notices the
 * new mtime within 10 minutes, no restart. A failed refresh leaves the old
 * file serving and exits 1. Writes `status.json` beside it for status
 * (highdesert-status's `geoip` line); after a failure it still names the
 * installed file's build date (`installed`, failedStatus).
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Reader } from "mmdb-lib";

export const DEFAULT_GEOIP_DB = "/var/lib/highdesert-geoip/city.mmdb";
export const MAX_AGE_DAYS = 75;

const month = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** This month's DB-IP URL first, then last month's (the new one appears in the first days of a month). */
export function dbipUrls(now = new Date()) {
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [now, prev].map((d) => `https://download.db-ip.com/free/dbip-city-lite-${month(d)}.mmdb.gz`);
}

/** Throws unless `buf` is a usable City database. Returns its metadata summary. */
export function checkDatabase(buf, now = Date.now()) {
  const reader = new Reader(buf);
  const { databaseType, buildEpoch } = reader.metadata;
  if (!/city/i.test(databaseType ?? "")) throw new Error(`not a City database: ${databaseType}`);
  const ageDays = (now - buildEpoch.getTime()) / 86_400_000;
  if (!(ageDays < MAX_AGE_DAYS)) throw new Error(`built ${buildEpoch.toISOString()}, over ${MAX_AGE_DAYS} days ago`);
  const google = reader.get("8.8.8.8");
  if (google?.country?.iso_code !== "US") throw new Error("8.8.8.8 does not resolve to US");
  if (!reader.get("1.1.1.1")?.country?.iso_code) throw new Error("1.1.1.1 resolves to no country");
  return { type: databaseType, builtAt: buildEpoch.toISOString() };
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchDatabase() {
  const key = process.env.GEOIP_MAXMIND_LICENSE_KEY;
  if (key) {
    const tgz = await download(
      `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${encodeURIComponent(key)}&suffix=tar.gz`,
    );
    return { buf: untarMmdb(gunzipSync(tgz)), source: "GeoLite2-City" };
  }
  let last;
  for (const url of dbipUrls()) {
    try {
      return { buf: gunzipSync(await download(url)), source: url };
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

/** The one .mmdb inside a GeoLite2 tarball (ustar: 512-byte headers). */
export function untarMmdb(tar) {
  for (let off = 0; off + 512 <= tar.length; ) {
    const name = tar.subarray(off, off + 100).toString("utf8").replace(/\0.*$/s, "");
    if (!name) break;
    const size = parseInt(tar.subarray(off + 124, off + 136).toString("utf8").replace(/\0.*$/s, "").trim() || "0", 8);
    const body = off + 512;
    if (name.endsWith(".mmdb")) return tar.subarray(body, body + size);
    off = body + Math.ceil(size / 512) * 512;
  }
  throw new Error("no .mmdb in the archive");
}

/**
 * status.json after a failed refresh. The old file is still serving, so what
 * it is (type, build date) is carried forward as `installed`: highdesert-status
 * judges the file's age from it, and a failure must not hide how old it is.
 */
export function failedStatus(prev, err, at = new Date().toISOString()) {
  const keep = ({ type, builtAt, source, size, at: installedAt }) => ({ type, builtAt, source, size, at: installedAt });
  const installed = prev?.ok === true ? keep(prev) : (prev?.installed ?? null);
  return { ok: false, at, error: String(err?.message ?? err), installed };
}

async function readStatus(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const target = process.env.GEOIP_DB || DEFAULT_GEOIP_DB;
  const statusFile = join(dirname(target), "status.json");
  if (process.argv.includes("--check")) {
    const info = checkDatabase(await readFile(target));
    console.log(`OK ${target}: ${info.type}, built ${info.builtAt}`);
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  try {
    const { buf, source } = await fetchDatabase();
    const info = checkDatabase(buf);
    await writeFile(tmp, buf, { mode: 0o644 });
    await rename(tmp, target);
    const { size } = await stat(target);
    await writeFile(statusFile, JSON.stringify({ ok: true, at: new Date().toISOString(), source, size, ...info }, null, 2) + "\n");
    console.log(`installed ${target} (${(size / 1e6).toFixed(1)} MB) from ${source}: ${info.type}, built ${info.builtAt}`);
  } catch (err) {
    await rm(tmp, { force: true });
    await writeFile(statusFile, JSON.stringify(failedStatus(await readStatus(statusFile), err), null, 2) + "\n").catch(() => {});
    console.error(`geoip refresh failed, the installed file is unchanged: ${err?.message ?? err}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
