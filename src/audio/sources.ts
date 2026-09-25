import type { Episode } from "@/db/schema";
import type { FailureKind } from "@/audio/playback-watchdog";

/**
 * Where an episode's audio can come from, in the order to try it.
 *
 *   archive  archive.org, the episode's `sourceUrl` — always first while
 *            archive.org is believed up
 *   mirror   `/mirror/{fileHash}` on this origin (services/mirror): a bounded
 *            cache kept warm with the most-played shows, filled by webseed and
 *            BitTorrent. Only catalog episodes (`archive:` identity) have one.
 *   cache    this browser's OPFS copy (src/audio/cache.ts), handed in as a File
 *   local    a file the admin scanner imported
 *
 * When the health probe has recently seen archive.org down, the mirror is the
 * only source offered: sending the element to a host known to be dead costs the
 * listener a twelve-second timeout before failover could even begin.
 */

export type SourceKind = "archive" | "mirror" | "cache" | "local";

export interface PlaySource {
  kind: SourceKind;
  url: string;
}

export function mirrorUrl(episode: Pick<Episode, "fileHash">): string | null {
  if (!episode.fileHash?.startsWith("archive:")) return null;
  return `/mirror/${encodeURIComponent(episode.fileHash)}`;
}

export function resolveSources(
  episode: Pick<Episode, "fileHash" | "sourceUrl">,
  { archiveDown = false }: { archiveDown?: boolean } = {},
): PlaySource[] {
  const mirror = mirrorUrl(episode);
  const archive = episode.sourceUrl ?? null;
  if (archiveDown && mirror) return [{ kind: "mirror", url: mirror }];
  const out: PlaySource[] = [];
  if (archive) out.push({ kind: "archive", url: archive });
  if (mirror) out.push({ kind: "mirror", url: mirror });
  return out;
}

/**
 * Failures that say "this host is not delivering", where another host can help.
 * Not `play-rejected` — the browser refused to start sound, and a different URL
 * changes nothing about that — nor decode or empty-media, which are about the
 * bytes, and the mirror serves the same bytes.
 */
const FAILOVER_KINDS: ReadonlySet<FailureKind> = new Set(["network-error", "stall", "timeout"]);

export function isFailoverKind(kind: FailureKind): boolean {
  return FAILOVER_KINDS.has(kind);
}

/** What is left to try after `current` — the mirror behind archive.org, else nothing. */
export function fallbacksFor(
  episode: Pick<Episode, "fileHash" | "sourceUrl">,
  current: SourceKind | null,
): PlaySource[] {
  if (current !== "archive") return [];
  return resolveSources(episode).filter((s) => s.kind === "mirror");
}

/**
 * How a start should go, decided synchronously before anything touches the
 * element or the network:
 *
 *   play         the first source to try (archive.org, or the mirror while
 *                archive.org is down)
 *   unavailable  archive.org is down and the mirror's manifest says it does not
 *                hold this show. Nothing can deliver it; trying costs the
 *                listener the gateway's 15 s first-byte budget and ends in an
 *                error anyway. Refuse at once and say why (`OutageDialog`).
 *   none         no source at all (a catalog row with no URL)
 *
 * `playable` null means the manifest is unknown — never read, or unreadable.
 * That sends the start to the mirror to find out rather than refusing a show
 * that may well be there.
 */
export type StartPlan =
  | { kind: "play"; source: PlaySource }
  | { kind: "unavailable" }
  | { kind: "none" };

export function planStart(
  episode: Pick<Episode, "fileHash" | "sourceUrl">,
  { archiveDown, playable }: { archiveDown: boolean; playable: ReadonlySet<string> | null },
): StartPlan {
  const first = resolveSources(episode, { archiveDown })[0];
  if (!first) return { kind: "none" };
  if (first.kind === "mirror" && archiveDown && playable && !playable.has(episode.fileHash!)) {
    return { kind: "unavailable" };
  }
  return { kind: "play", source: first };
}
