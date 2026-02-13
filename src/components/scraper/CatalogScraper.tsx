"use client";

import { Window, Button, ProgressBar } from "@/components/win98";
import { useCatalogScraper } from "@/hooks/useCatalogScraper";

const PHASE_LABELS: Record<string, string> = {
  idle: "Ready to import",
  scraping: "Discovering episodes...",
  importing: "Importing episodes...",
  categorizing: "AI categorizing...",
  done: "Import complete",
  error: "Import failed",
  cancelled: "Import cancelled",
};

export function CatalogScraper() {
  const {
    phase,
    fetched,
    total,
    imported,
    duplicates,
    categorized,
    errors,
    errorMessages,
    startScrape,
    cancelScrape,
  } = useCatalogScraper();

  const isRunning = phase === "scraping" || phase === "importing" || phase === "categorizing";
  const isDone = phase === "done" || phase === "error" || phase === "cancelled";

  // Progress bar value (0-100)
  let progressPct = 0;
  if (phase === "scraping" && total > 0) {
    progressPct = Math.round((fetched / total) * 100);
  } else if (phase === "importing" && fetched > 0) {
    progressPct = Math.round(((imported + duplicates) / fetched) * 100);
  } else if (phase === "categorizing" && imported > 0) {
    progressPct = Math.round((categorized / imported) * 100);
  } else if (phase === "done") {
    progressPct = 100;
  }

  return (
    <Window title="Import Full Catalog" variant="dark">
      <div className="p-3 flex flex-col gap-3">
        <div className="text-[10px] text-bevel-dark leading-relaxed">
          Import the full Art Bell archive from archive.org using the Scraping API.
          This discovers all episodes (no 10K limit), imports metadata, and runs AI categorization.
        </div>

        {/* Progress bar */}
        {isRunning && (
          <ProgressBar value={progressPct} variant="dark" />
        )}

        {/* Phase label */}
        <div className="text-[10px] text-desktop-gray">
          {PHASE_LABELS[phase] ?? phase}
        </div>

        {/* Stat grid */}
        {(isRunning || isDone) && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
            <div className="text-bevel-dark">Discovered</div>
            <div className="text-desktop-gray tabular-nums">{fetched.toLocaleString()}</div>
            <div className="text-bevel-dark">Imported</div>
            <div className="text-static-green tabular-nums">{imported.toLocaleString()}</div>
            <div className="text-bevel-dark">Duplicates</div>
            <div className="text-desert-amber tabular-nums">{duplicates.toLocaleString()}</div>
            <div className="text-bevel-dark">Categorized</div>
            <div className="text-desktop-gray tabular-nums">{categorized.toLocaleString()}</div>
            {errors > 0 && (
              <>
                <div className="text-bevel-dark">Errors</div>
                <div className="text-red-400 tabular-nums">{errors.toLocaleString()}</div>
              </>
            )}
          </div>
        )}

        {/* Error messages */}
        {errorMessages.length > 0 && isDone && (
          <div className="w98-inset-dark bg-inset-well p-2 max-h-[100px] overflow-auto">
            {errorMessages.slice(0, 10).map((msg, i) => (
              <div key={i} className="text-[9px] text-red-400/80 leading-relaxed">
                {msg}
              </div>
            ))}
            {errorMessages.length > 10 && (
              <div className="text-[9px] text-bevel-dark mt-1">
                +{errorMessages.length - 10} more errors
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {!isRunning ? (
            <Button
              variant="dark"
              size="sm"
              onClick={startScrape}
            >
              {isDone ? "Import Again" : "Start Import"}
            </Button>
          ) : (
            <Button
              variant="dark"
              size="sm"
              onClick={cancelScrape}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
    </Window>
  );
}
