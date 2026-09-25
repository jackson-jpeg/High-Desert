/**
 * The mirror's playable set, read server side for the outage swap.
 *
 * `LIVE_MIRROR_MANIFEST_URL` names it (default: the public
 * `https://highdesert.space/mirror/manifest`, which nginx serves whether the
 * mirror is the webtorrent gateway or a static file). Only fetched while
 * archive.org is down — the swap is the only reader — and memoised for 60 s.
 *
 * Fails soft: an unreadable manifest keeps the last good one, and with none at
 * all the schedule is published unswapped (the client's own outage gate then
 * decides what it can play). It never throws into the route.
 */

import type { ManifestSet } from "@/lib/live/schedule";

export const DEFAULT_MANIFEST_URL = "https://highdesert.space/mirror/manifest";
export const MANIFEST_MEMO_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

interface State {
  memo: { at: number; manifest: ManifestSet | null } | null;
  lastGood: ManifestSet | null;
  inFlight: Promise<ManifestSet | null> | null;
}
const KEY = Symbol.for("high-desert.live-manifest");
function state(): State {
  const g = globalThis as unknown as Record<symbol, State | undefined>;
  return (g[KEY] ??= { memo: null, lastGood: null, inFlight: null });
}

function manifestUrl(): string {
  return process.env.LIVE_MIRROR_MANIFEST_URL || DEFAULT_MANIFEST_URL;
}

async function fetchManifest(): Promise<ManifestSet | null> {
  const s = state();
  try {
    const res = await fetch(manifestUrl(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return s.lastGood;
    const body = (await res.json()) as { version?: unknown; fileHashes?: unknown };
    if (
      typeof body?.version !== "string" ||
      !Array.isArray(body.fileHashes) ||
      !body.fileHashes.every((f) => typeof f === "string")
    ) {
      return s.lastGood;
    }
    s.lastGood = { version: body.version, fileHashes: new Set(body.fileHashes as string[]) };
    return s.lastGood;
  } catch {
    return s.lastGood;
  }
}

/** The manifest, memoised. `null` = never readable. Never throws. */
export async function mirrorManifest(): Promise<ManifestSet | null> {
  const s = state();
  if (s.memo && Date.now() - s.memo.at < MANIFEST_MEMO_MS) return s.memo.manifest;
  s.inFlight ??= fetchManifest().then((m) => {
    s.memo = { at: Date.now(), manifest: m };
    s.inFlight = null;
    return m;
  });
  return s.inFlight;
}

export function resetManifestForTests(): void {
  const s = state();
  s.memo = null;
  s.lastGood = null;
  s.inFlight = null;
}
