import { db } from "@/db";
import { findDuplicateEpisode } from "@/db/deduplicate";
import { archiveFileHash } from "@/db/identity";
import type { Episode } from "@/db/schema";
import { getStreamUrl } from "./client";
import { parseArtBellFilename, isArtBellFilename } from "./filename-parser";
import type { ArchiveFile } from "./types";

/**
 * Collection import's work, without React (admin-only; `useCollectionImport` is
 * the thin hook over it). One archive.org *item* holds many audio files here and
 * each becomes an episode — that is what makes it a different path from the
 * catalog scraper (`catalog-import.ts`), which takes one file per item.
 *
 * Lifted out of the hook so the loop is testable against a real database
 * (HD-015). The three properties worth holding are all about what *survives* a
 * run: rows carry the canonical identity key, a file already in the library is
 * left exactly as the listener has it, and one bad file does not cost the
 * listener the rest of the collection.
 *
 * ── Identity ───────────────────────────────────────────────────────────────────
 * `fileHash` is `archive:{identifier}:{fileName}` via `archiveFileHash`, the same
 * as the seeder and the catalog scraper. `archiveIdentifier` is the *collection*
 * id, which every file in the collection shares — never an identity on its own
 * (see "Data safety" in CLAUDE.md, and the v8 upgrade in `src/db/legacy-keys.ts`).
 */

export interface CollectionInfo {
  identifier: string;
  title: string;
  description: string;
  creator: string;
  audioFiles: ArchiveFile[];
}

export interface CollectionImportSink {
  updateProgress: (update: { imported?: number; duplicates?: number }) => void;
  setPhase: (phase: "importing" | "done" | "cancelled") => void;
  setCurrentFile: (file: string | null) => void;
  addError: (message: string) => void;
}

export interface CollectionImportResult {
  outcome: "done" | "cancelled";
  imported: number;
  duplicates: number;
}

export async function runCollectionImport(
  signal: AbortSignal,
  info: CollectionInfo,
  sink: CollectionImportSink,
): Promise<CollectionImportResult> {
  let imported = 0;
  let duplicates = 0;
  const cancelled = (): CollectionImportResult => {
    sink.setPhase("cancelled");
    return { outcome: "cancelled", imported, duplicates };
  };

  sink.setPhase("importing");

  for (const file of info.audioFiles) {
    if (signal.aborted) return cancelled();
    sink.setCurrentFile(file.name);

    try {
      const fileHash = archiveFileHash(info.identifier, file.name);

      // The fallback arm of findDuplicateEpisode reads a composite; give it the
      // `{collection}/{file}` shape it splits, so a row written before the
      // canonical key existed is still recognised.
      const existing = await findDuplicateEpisode({
        fileHash,
        archiveIdentifier: `${info.identifier}/${file.name}`,
        fileName: file.name,
      });

      if (existing) {
        duplicates++;
        sink.updateProgress({ duplicates });
        continue;
      }

      const parsed = isArtBellFilename(file.name) ? parseArtBellFilename(file.name) : null;
      const streamUrl = getStreamUrl(info.identifier, file.name);

      const episode: Omit<Episode, "id"> = {
        fileHash,
        filePath: streamUrl,
        fileName: file.name,
        fileSize: Number(file.size ?? 0),
        title: parsed?.title ?? file.name.replace(/\.\w+$/, ""),
        artist: "Art Bell",
        airDate: parsed?.airDate,
        guestName: parsed?.guestName,
        topic: parsed?.topic,
        showType: parsed?.showType,
        description: undefined,
        duration: file.length ? parseFloat(file.length) : undefined,
        format: file.format?.includes("MP3") ? "mp3" : (file.format?.toLowerCase() ?? "mp3"),
        source: "archive",
        sourceUrl: streamUrl,
        archiveIdentifier: info.identifier,
        aiStatus: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await db.episodes.add(episode as Episode);
      imported++;
      sink.updateProgress({ imported });
    } catch (err) {
      // One unreadable file must not cost the listener the rest of the
      // collection: record it and carry on.
      const msg = err instanceof Error ? err.message : String(err);
      sink.addError(`${file.name}: ${msg}`);
    }
  }

  if (signal.aborted) return cancelled();

  // Episodes import uncategorised — AI categorisation runs offline via
  // scripts/categorize-library.py and ships in the seed catalog.
  sink.setCurrentFile(null);
  sink.setPhase("done");
  return { outcome: "done", imported, duplicates };
}
