"use client";

import { useState } from "react";
import { Window, Button, ProgressBar, TextField } from "@/components/win98";
import { useCollectionImport } from "@/hooks/useCollectionImport";
import { cn } from "@/lib/utils/cn";

const FEATURED_COLLECTION = {
  identifier: "ultimate-ultimate-art-bell-collection",
  title: "The Ultimate Art Bell Collection",
  description: "1,318 episodes spanning 1992\u20132013. Coast to Coast AM, Dreamland, Dark Matter, and more. Each file is individually titled with dates, guests, and topics.",
  episodeCount: "1,318",
  dateRange: "1992 \u2013 2013",
};

export function CollectionImport() {
  const { progress, loadCollection, startImport, cancelImport, reset } = useCollectionImport();
  const [customId, setCustomId] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const isRunning = progress.phase === "loading" || progress.phase === "importing" || progress.phase === "categorizing";
  const isDone = progress.phase === "done" || progress.phase === "error" || progress.phase === "cancelled";

  const progressPct = (() => {
    if (progress.phase === "importing" && progress.total > 0) {
      return Math.round(((progress.imported + progress.duplicates) / progress.total) * 100);
    }
    if (progress.phase === "categorizing" && progress.imported > 0) {
      return Math.round((progress.categorized / progress.imported) * 100);
    }
    if (progress.phase === "done") return 100;
    return 0;
  })();

  const handleFeaturedImport = async () => {
    const loaded = await loadCollection(FEATURED_COLLECTION.identifier);
    if (loaded) {
      startImport({ skipCategorize: true });
    }
  };

  const handleFeaturedImportWithAI = async () => {
    const loaded = await loadCollection(FEATURED_COLLECTION.identifier);
    if (loaded) {
      startImport();
    }
  };

  const handleCustomImport = async () => {
    const id = customId.trim();
    if (!id) return;
    // Extract identifier from full URL if pasted
    const match = id.match(/archive\.org\/details\/([^/?#]+)/);
    const identifier = match ? match[1] : id;
    const loaded = await loadCollection(identifier);
    if (loaded) {
      startImport({ skipCategorize: true });
    }
  };

  return (
    <Window title="Collection Import" variant="dark">
      <div className="p-3 flex flex-col gap-3">

        {/* Featured collection */}
        {!isRunning && !isDone && (
          <div className="w98-inset-dark bg-inset-well p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] text-desktop-gray font-bold">
                    {FEATURED_COLLECTION.title}
                  </span>
                  <span className="text-[8px] text-static-green/70 bg-static-green/10 px-1.5 py-px uppercase tracking-wider">
                    Featured
                  </span>
                </div>
                <div className="text-[9px] text-bevel-dark leading-relaxed mb-2">
                  {FEATURED_COLLECTION.description}
                </div>
                <div className="flex items-center gap-3 text-[9px]">
                  <span className="text-desert-amber tabular-nums">{FEATURED_COLLECTION.episodeCount} episodes</span>
                  <span className="text-bevel-dark/60">{FEATURED_COLLECTION.dateRange}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Button variant="dark" size="sm" onClick={handleFeaturedImport}>
                Import Collection
              </Button>
              <Button variant="dark" size="sm" onClick={handleFeaturedImportWithAI}>
                Import + AI Categorize
              </Button>
            </div>
          </div>
        )}

        {/* Running state */}
        {isRunning && (
          <>
            {/* Phase label */}
            <div className="flex items-center gap-2">
              {progress.phase === "loading" && (
                <span className="text-[10px] text-desktop-gray">Loading collection metadata...</span>
              )}
              {progress.phase === "importing" && (
                <span className="text-[10px] text-desktop-gray">
                  Importing episodes — {progress.imported + progress.duplicates} / {progress.total}
                </span>
              )}
              {progress.phase === "categorizing" && (
                <span className="text-[10px] text-desktop-gray">
                  AI categorization — {progress.categorized} / {progress.imported}
                </span>
              )}
            </div>

            {/* Progress bar */}
            {progress.phase !== "loading" && (
              <ProgressBar value={progressPct} variant="dark" />
            )}
            {progress.phase === "loading" && (
              <div className="h-[20px] w98-inset-dark bg-inset-well overflow-hidden">
                <div className="h-full w-1/3 bg-title-bar-blue/40 animate-pulse" />
              </div>
            )}

            {/* Current file */}
            <div className="w98-inset-dark bg-inset-well px-2 py-1 min-h-[20px]">
              <div className="text-[9px] text-desktop-gray truncate">
                {progress.currentFile || "\u00A0"}
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-4 gap-2">
              <MiniStat label="Imported" value={progress.imported} color="text-static-green" />
              <MiniStat label="Duplicates" value={progress.duplicates} color="text-desert-amber" />
              <MiniStat label="Categorized" value={progress.categorized} color="text-desktop-gray" />
              <MiniStat label="Errors" value={progress.errors} color={progress.errors > 0 ? "text-red-400" : "text-desktop-gray"} />
            </div>

            <Button variant="dark" size="sm" onClick={cancelImport}>
              Cancel
            </Button>
          </>
        )}

        {/* Done state */}
        {isDone && (
          <>
            {progress.phase === "done" && progress.imported > 0 && (
              <div className="w98-inset-dark bg-inset-well p-2 text-[10px] text-static-green/90 leading-relaxed">
                Imported {progress.imported.toLocaleString()} episode{progress.imported !== 1 ? "s" : ""}
                {progress.categorized > 0 && ` and categorized ${progress.categorized.toLocaleString()}`}.
                {progress.duplicates > 0 && ` ${progress.duplicates.toLocaleString()} duplicate${progress.duplicates !== 1 ? "s" : ""} skipped.`}
              </div>
            )}
            {progress.phase === "done" && progress.imported === 0 && progress.duplicates > 0 && (
              <div className="w98-inset-dark bg-inset-well p-2 text-[10px] text-desert-amber/90 leading-relaxed">
                All {progress.duplicates.toLocaleString()} episodes already in your library.
              </div>
            )}
            {progress.phase === "cancelled" && (
              <div className="w98-inset-dark bg-inset-well p-2 text-[10px] text-desert-amber/90 leading-relaxed">
                Import cancelled. {progress.imported > 0 ? `${progress.imported.toLocaleString()} episodes were imported.` : "No episodes imported."}
              </div>
            )}
            {progress.phase === "error" && (
              <div className="w98-inset-dark bg-inset-well p-2 text-[10px] text-red-400/90 leading-relaxed">
                Import encountered an error.
                {progress.imported > 0 && ` ${progress.imported.toLocaleString()} episodes were imported before the error.`}
              </div>
            )}

            {/* Stats */}
            {(progress.imported > 0 || progress.duplicates > 0) && (
              <div className="grid grid-cols-4 gap-2">
                <MiniStat label="Imported" value={progress.imported} color="text-static-green" />
                <MiniStat label="Duplicates" value={progress.duplicates} color="text-desert-amber" />
                <MiniStat label="Categorized" value={progress.categorized} color="text-desktop-gray" />
                <MiniStat label="Errors" value={progress.errors} color={progress.errors > 0 ? "text-red-400" : "text-desktop-gray"} />
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button variant="dark" size="sm" onClick={reset}>
                Done
              </Button>
            </div>
          </>
        )}

        {/* Error log */}
        {progress.errorMessages.length > 0 && (
          <div>
            <button
              onClick={() => setShowErrors(!showErrors)}
              className="text-[9px] text-red-400/70 hover:text-red-400 cursor-pointer flex items-center gap-1"
            >
              <span className="text-[8px]">{showErrors ? "\u25BC" : "\u25B6"}</span>
              {progress.errorMessages.length} error{progress.errorMessages.length !== 1 ? "s" : ""}
            </button>
            {showErrors && (
              <div className="w98-inset-dark bg-inset-well p-2 mt-1 max-h-[120px] overflow-auto">
                {progress.errorMessages.map((msg, i) => (
                  <div key={i} className="text-[8px] text-red-400/70 leading-relaxed font-mono">
                    {msg}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Custom collection input */}
        {!isRunning && !isDone && (
          <div className="border-t border-bevel-dark/20 pt-2">
            <button
              onClick={() => setShowCustom(!showCustom)}
              className="text-[9px] text-bevel-dark hover:text-desktop-gray cursor-pointer"
            >
              {showCustom ? "Hide custom import" : "Import from other collection..."}
            </button>
            {showCustom && (
              <div className="flex items-center gap-2 mt-2">
                <TextField
                  value={customId}
                  onChange={(e) => setCustomId(e.target.value)}
                  placeholder="archive.org identifier or URL"
                  variant="dark"
                  className="flex-1 text-[10px]"
                />
                <Button
                  variant="dark"
                  size="sm"
                  onClick={handleCustomImport}
                  disabled={!customId.trim()}
                >
                  Import
                </Button>
              </div>
            )}
          </div>
        )}

      </div>
    </Window>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={cn("flex flex-col items-center p-1.5 w98-inset-dark bg-inset-well")}>
      <div className={cn("text-[12px] font-bold tabular-nums", color)}>
        {value.toLocaleString()}
      </div>
      <div className="text-[8px] text-bevel-dark uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}
