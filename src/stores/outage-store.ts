import { create } from "zustand";
import type { Episode } from "@/db/schema";

/**
 * Outage mode: what the app knows about archive.org, and what the mirror can
 * play without it.
 *
 *   archiveUp   the health probe's last *verdict* (src/services/archive/health.ts)
 *               — null until one arrives. A probe that could not reach this
 *               server is not a verdict and never lands here.
 *   manifest    the mirror's playable set (`/mirror/manifest`), or null if it
 *               has never been read. Null means "unknown", not "empty": a start
 *               is then sent to the mirror to find out, rather than refused.
 *   unavailable the show a start was just refused for — it is not on the mirror
 *               and archive.org is down. `OutageDialog` renders it.
 *
 * The banner, the row marks, the "Playable now" filter and the fast fail all
 * read this one store, so they cannot disagree about whether there is an
 * outage.
 */

export interface MirrorManifest {
  version: string;
  fileHashes: ReadonlySet<string>;
}

interface OutageState {
  archiveUp: boolean | null;
  manifest: MirrorManifest | null;
  unavailable: Episode | null;
  setArchiveUp: (up: boolean) => void;
  setManifest: (manifest: MirrorManifest) => void;
  showUnavailable: (episode: Episode) => void;
  dismissUnavailable: () => void;
}

export const useOutageStore = create<OutageState>((set, get) => ({
  archiveUp: null,
  manifest: null,
  unavailable: null,

  setArchiveUp: (up) => {
    if (get().archiveUp === up) return;
    // archive.org is back: whatever the dialog was explaining no longer holds.
    set(up ? { archiveUp: up, unavailable: null } : { archiveUp: up });
  },
  setManifest: (manifest) => {
    if (get().manifest?.version === manifest.version) return;
    set({ manifest });
  },
  showUnavailable: (episode) => set({ unavailable: episode }),
  dismissUnavailable: () => set({ unavailable: null }),
}));

/** Outage mode is on: the probe has said archive.org is down. Unknown is not down. */
export const selectOutage = (s: Pick<OutageState, "archiveUp">): boolean => s.archiveUp === false;

/**
 * How a row stands during an outage:
 *   "mirror"      a catalog episode the mirror holds — it plays
 *   "unavailable" a catalog episode it does not — it cannot play until archive.org returns
 *   "normal"      no outage, an unknown manifest, or not a catalog episode at
 *                 all (a local file never needed archive.org)
 */
export type Availability = "normal" | "mirror" | "unavailable";

export function availabilityOf(
  s: Pick<OutageState, "archiveUp" | "manifest">,
  fileHash: string | undefined,
): Availability {
  if (!selectOutage(s) || !s.manifest) return "normal";
  if (!fileHash?.startsWith("archive:")) return "normal";
  return s.manifest.fileHashes.has(fileHash) ? "mirror" : "unavailable";
}
