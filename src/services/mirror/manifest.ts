import { useOutageStore, type MirrorManifest } from "@/stores/outage-store";
import { safeSetItem } from "@/lib/utils/safe-storage";

/**
 * The mirror's playable set (`GET /mirror/manifest`, services/mirror), cached.
 *
 * Read when outage mode starts, and kept in localStorage so a page opened
 * during an outage can mark rows and refuse an unplayable start before its own
 * fetch returns. The server's `version` is a digest of the list; the client
 * sends the one it holds as `If-None-Match` and a 304 costs nothing.
 *
 * Nothing here ever throws or blocks a start: a manifest that cannot be read
 * leaves the store's `manifest` as it was — null means unknown, and an unknown
 * set sends a start to the mirror to find out rather than refusing it.
 */

export const MANIFEST_URL = "/mirror/manifest";
export const MANIFEST_STORAGE_KEY = "hd-mirror-manifest";
/** Re-read no more often than this while outage mode lasts. */
export const MANIFEST_TTL_MS = 5 * 60 * 1000;

let lastFetchedAt = 0;

interface WireManifest {
  version: string;
  fileHashes: string[];
}

function isWireManifest(v: unknown): v is WireManifest {
  const m = v as WireManifest;
  return (
    !!m &&
    typeof m.version === "string" &&
    Array.isArray(m.fileHashes) &&
    m.fileHashes.every((f) => typeof f === "string")
  );
}

function toManifest(w: WireManifest): MirrorManifest {
  return { version: w.version, fileHashes: new Set(w.fileHashes) };
}

/** Put the last manifest this browser saw into the store, if there is one. */
export function hydrateManifest(): void {
  if (useOutageStore.getState().manifest) return;
  try {
    const raw = localStorage.getItem(MANIFEST_STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (isWireManifest(parsed)) useOutageStore.getState().setManifest(toManifest(parsed));
  } catch {
    /* blocked or corrupt storage: fetch it instead */
  }
}

/** Fetch the manifest unless one was fetched within the TTL. Never throws. */
export async function loadManifest({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (!force && Date.now() - lastFetchedAt < MANIFEST_TTL_MS) return;
  lastFetchedAt = Date.now();
  const held = useOutageStore.getState().manifest;
  try {
    const res = await fetch(MANIFEST_URL, {
      headers: held ? { "If-None-Match": `"${held.version}"` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 304) return;
    if (!res.ok) {
      lastFetchedAt = 0; // not a manifest: allow the next attempt
      return;
    }
    const body: unknown = await res.json();
    if (!isWireManifest(body)) return;
    useOutageStore.getState().setManifest(toManifest(body));
    // Quota or blocked storage: the in-memory copy still serves this page.
    safeSetItem("local", MANIFEST_STORAGE_KEY, JSON.stringify({ version: body.version, fileHashes: body.fileHashes }));
  } catch {
    lastFetchedAt = 0;
  }
}

export const __testing = {
  reset() {
    lastFetchedAt = 0;
  },
};
