import { db, getPreference, setPreference } from "@/db";
import { findDuplicateEpisode } from "@/db/deduplicate";
import { archiveFileHash } from "@/db/identity";
import type { Episode } from "@/db/schema";
import { getArchiveItem, getStreamUrl, pickBestAudioFile } from "./client";
import { scrapeArchiveCatalog, type ScrapeProgress } from "./scraper";
import type { ArchiveSearchResult } from "./types";

/**
 * The catalog scraper's work, without React (admin-only; `useCatalogScraper` is
 * the thin hook over it). Two phases: collect every item page by page, then
 * fetch each item's metadata and import it.
 *
 * ── Resume tracks IMPORT progress (HD-025) ─────────────────────────────────────
 * The saved page used to be written during *collection*. Collection is fast and
 * import is slow, so an interruption during import had already recorded the
 * last page as done; "resume" then started collecting there and pages 1…N-1 —
 * collected but never imported — were skipped for good. Now `RESUME_PREF` names
 * the first page NOT yet fully imported, and advances only once the last item
 * of a page has been through the import loop. Items of that page imported
 * before the interruption are fetched again and skipped as duplicates by their
 * exact identity, so nothing is imported twice either.
 *
 * ── Identity ───────────────────────────────────────────────────────────────────
 * `fileHash` is `archive:{identifier}:{fileName}` via `archiveFileHash`, the same
 * as the seeder and collection import. It used to be `archive:{identifier}`; the
 * Dexie v8 upgrade rewrites rows written that way (`src/db/legacy-keys.ts`).
 */
export const RESUME_PREF = "scraper-page";

export interface CatalogImportSink {
  updateProgress: (update: Partial<ScrapeProgress>) => void;
  setPhase: (phase: ScrapeProgress["phase"]) => void;
  setCurrentItem: (item: string | null) => void;
  addError: (message: string) => void;
}

export interface CatalogImportOptions {
  resume?: boolean;
  /** Test seams — production uses the defaults. */
  pageDelayMs?: number;
  itemDelayMs?: number;
}

export interface CatalogImportResult {
  outcome: "done" | "cancelled";
  imported: number;
  duplicates: number;
}

export async function runCatalogImport(
  signal: AbortSignal,
  sink: CatalogImportSink,
  options: CatalogImportOptions = {},
): Promise<CatalogImportResult> {
  const { pageDelayMs = 1000, itemDelayMs = 200 } = options;
  let imported = 0;
  let duplicates = 0;
  const cancelled = (): CatalogImportResult => {
    sink.setPhase("cancelled");
    return { outcome: "cancelled", imported, duplicates };
  };

  let startPage = 1;
  if (options.resume) {
    const saved = parseInt((await getPreference(RESUME_PREF)) ?? "", 10);
    if (saved > 0) startPage = saved;
  }

  // Phase 1: collect, remembering which page each item came from.
  const items: { item: ArchiveSearchResult; page: number }[] = [];
  let page = startPage;
  for await (const batch of scrapeArchiveCatalog(signal, sink.updateProgress, startPage, pageDelayMs)) {
    for (const item of batch) items.push({ item, page });
    page++;
  }
  if (signal.aborted) return cancelled();

  // Phase 2: import.
  sink.setPhase("importing");

  for (let i = 0; i < items.length; i++) {
    if (signal.aborted) return cancelled();
    const { item, page: itemPage } = items[i];
    sink.setCurrentItem(item.identifier);

    try {
      await importOne(item);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sink.addError(`${item.identifier}: ${msg}`);
    }

    // This page is fully imported once its last item is behind us — only then
    // may a resume start after it.
    const next = items[i + 1];
    if (!next || next.page !== itemPage) {
      await setPreference(RESUME_PREF, String(itemPage + 1)).catch((err) => {
        console.warn("[scraper] Failed to save progress:", err);
      });
    }
  }

  if (signal.aborted) return cancelled();

  await setPreference(RESUME_PREF, "").catch((err) => {
    console.warn("[scraper] Failed to clear progress:", err);
  });
  sink.setPhase("done");
  return { outcome: "done", imported, duplicates };

  async function importOne(item: ArchiveSearchResult): Promise<void> {
    // Cheap pre-check, no network: the scraper imports ONE file per archive.org
    // item, so any canonical key under this item means the item is done. The
    // trailing colon keeps "foo" from matching "foo-bar". (This is not the
    // prefix bug findDuplicateEpisode warns about — that was a prefix on a
    // collection id, in collection import, where one id holds many files.)
    const already = await db.episodes.where("fileHash").startsWith(`archive:${item.identifier}:`).first();
    if (already) {
      duplicates++;
      sink.updateProgress({ duplicates });
      return;
    }

    // Metadata next: the identity key needs the file name.
    const archiveItem = await getArchiveItem(item.identifier);
    if (signal.aborted) return;
    const bestFile = pickBestAudioFile(archiveItem.files);
    if (!bestFile) {
      sink.addError(`No audio file: ${item.identifier}`);
      return;
    }

    const fileHash = archiveFileHash(item.identifier, bestFile.name);
    const existing = await findDuplicateEpisode({
      fileHash,
      archiveIdentifier: item.identifier,
      fileName: bestFile.name,
    });
    if (existing) {
      duplicates++;
      sink.updateProgress({ duplicates });
      return;
    }

    const streamUrl = getStreamUrl(item.identifier, bestFile.name);
    const rawDate = archiveItem.metadata.date ?? item.date;
    const airDate = rawDate ? rawDate.substring(0, 10) : undefined;

    // Strip HTML from description
    const rawDesc = archiveItem.metadata.description ?? item.description;
    const description = rawDesc ? rawDesc.replace(/<[^>]*>/g, "").substring(0, 500) : undefined;

    const episode: Omit<Episode, "id"> = {
      fileHash,
      filePath: streamUrl,
      fileName: bestFile.name,
      fileSize: Number(bestFile.size ?? 0),
      title: archiveItem.metadata.title ?? item.title,
      artist: typeof archiveItem.metadata.creator === "string" ? archiveItem.metadata.creator : "Art Bell",
      airDate,
      description,
      duration: bestFile.length ? parseFloat(bestFile.length) : undefined,
      format: "mp3",
      source: "archive",
      sourceUrl: streamUrl,
      archiveIdentifier: item.identifier,
      aiStatus: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.episodes.add(episode as Episode);
    imported++;
    sink.updateProgress({ imported });

    // 200ms between fetches
    if (itemDelayMs > 0) await new Promise((r) => setTimeout(r, itemDelayMs));
  }
}
