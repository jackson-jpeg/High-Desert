/**
 * Where a request came from, from a self-hosted geo database (docs/visitors.md).
 *
 * The database is an MMDB file on this server — DB-IP's free "IP to City
 * Lite" by default, or MaxMind's GeoLite2 City, which has the same layout —
 * refreshed monthly by `highdesert-geoip.timer` (scripts/update-geoip.sh).
 * No request leaves the box, and nothing here writes the address anywhere:
 * the caller gets a country, a region and (rarely) a city, and the address
 * is dropped with the request.
 *
 * **A city only when the database vouches for it.** GeoLite2 reports an
 * accuracy radius per network; a city is returned only when it is at most
 * CITY_MAX_RADIUS_KM. DB-IP Lite reports no radius at all, so with it no
 * city is ever returned: mobile carriers and VPNs land whole states on one
 * city, and a "tuning in from" line naming the wrong town is worse than one
 * naming the state.
 *
 * Every failure is "unknown", never a thrown error: a missing or corrupt file,
 * an address the file lacks, a private address. Location is a nicety; the
 * heartbeat and the visitor count must not depend on it.
 *
 * Imported by scripts under Node's native type stripping
 * (scripts/audit-access-logs.mjs), so: no `@/` imports, erasable syntax only.
 */

import { readFileSync, statSync } from "node:fs";
import { Reader, type Response } from "mmdb-lib";

export const DEFAULT_GEOIP_DB = "/var/lib/highdesert-geoip/city.mmdb";
export const CITY_MAX_RADIUS_KM = 50;
/** How often the file's mtime is checked, so a monthly refresh is picked up without a restart. */
export const RELOAD_CHECK_MS = 10 * 60 * 1000;

export interface GeoResult {
  /** ISO 3166-1 alpha-2, upper case. */
  country: string | null;
  /** The first-level subdivision's English name ("California", "Ontario"). */
  region: string | null;
  /** Only when the database reports an accuracy radius within CITY_MAX_RADIUS_KM. */
  city: string | null;
}

export const UNKNOWN: GeoResult = Object.freeze({ country: null, region: null, city: null }) as GeoResult;

interface Names {
  names?: Record<string, string>;
}
export interface CityRecord {
  country?: { iso_code?: string } & Names;
  registered_country?: { iso_code?: string } & Names;
  subdivisions?: ({ iso_code?: string } & Names)[];
  city?: Names;
  location?: { accuracy_radius?: number; latitude?: number; longitude?: number };
}

const MAX_NAME = 80;

function clean(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const s = name.trim();
  return s && s.length <= MAX_NAME ? s : null;
}

/** A database record, reduced to what is stored. Pure; exported for tests. */
export function fromRecord(rec: CityRecord | null | undefined): GeoResult {
  if (!rec) return UNKNOWN;
  const iso = rec.country?.iso_code ?? rec.registered_country?.iso_code;
  const country = typeof iso === "string" && /^[A-Za-z]{2}$/.test(iso) ? iso.toUpperCase() : null;
  if (!country) return UNKNOWN;
  const region = clean(rec.subdivisions?.[0]?.names?.en);
  const radius = rec.location?.accuracy_radius;
  const city =
    region && typeof radius === "number" && radius > 0 && radius <= CITY_MAX_RADIUS_KM
      ? clean(rec.city?.names?.en)
      : null;
  return { country, region, city };
}

/**
 * The bare address out of what nginx sends: brackets, a port and a zone
 * dropped, and IPv4-mapped IPv6 unwrapped. Null for anything else.
 */
export function bareAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.split(",")[0].trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracketed) s = bracketed[1];
  const v4port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(s);
  if (v4port) s = v4port[1];
  const pct = s.indexOf("%");
  if (pct > 0 && s.includes(":")) s = s.slice(0, pct);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  if (mapped) s = mapped[1];
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(s)) return s.split(".").every((o) => Number(o) <= 255) ? s : null;
  return /^[0-9a-f:]+$/i.test(s) && s.includes(":") ? s.toLowerCase() : null;
}

interface Loaded {
  path: string;
  mtimeMs: number;
  reader: Reader<Response> | null;
  checkedAt: number;
}

let loaded: Loaded | null = null;

function dbPath(): string {
  return process.env.GEOIP_DB || DEFAULT_GEOIP_DB;
}

function open(path: string, now: number): Loaded {
  try {
    const mtimeMs = statSync(path).mtimeMs;
    if (loaded && loaded.path === path && loaded.mtimeMs === mtimeMs) {
      return { ...loaded, checkedAt: now };
    }
    const reader = new Reader<Response>(readFileSync(path));
    return { path, mtimeMs, reader, checkedAt: now };
  } catch {
    // Missing or unreadable: keep a reader we already had (a refresh mid-rename
    // must not blank the lookups), else none.
    if (loaded && loaded.path === path && loaded.reader) return { ...loaded, checkedAt: now };
    return { path, mtimeMs: 0, reader: null, checkedAt: now };
  }
}

function reader(now = Date.now()): Reader<Response> | null {
  const path = dbPath();
  if (!loaded || loaded.path !== path || now - loaded.checkedAt >= RELOAD_CHECK_MS) loaded = open(path, now);
  return loaded.reader;
}

/** Look an address up. Never throws; unknown on anything it cannot answer. */
export function lookup(rawAddress: string | null | undefined): GeoResult {
  const ip = bareAddress(rawAddress);
  if (!ip) return UNKNOWN;
  try {
    const r = reader();
    return r ? fromRecord(r.get(ip) as CityRecord | null) : UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

/** Which database is loaded, for the API's attribution and status. */
export function geoDatabase(): { loaded: boolean; type: string | null; builtAt: string | null } {
  const r = reader();
  if (!r) return { loaded: false, type: null, builtAt: null };
  const m = r.metadata;
  return {
    loaded: true,
    type: m.databaseType ?? null,
    builtAt: m.buildEpoch instanceof Date ? m.buildEpoch.toISOString() : null,
  };
}

/** Tests only: forget the loaded file. */
export function resetGeoForTests(): void {
  loaded = null;
}
