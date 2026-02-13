"use client";

import { useState, useMemo, useEffect } from "react";
import { Window, Button, ProgressBar } from "@/components/win98";
import { useCatalogScraper } from "@/hooks/useCatalogScraper";

const PHASE_LABELS: Record<string, string> = {
  idle: "Ready",
  scraping: "Phase 1/3 — Discovering episodes",
  importing: "Phase 2/3 — Importing metadata",
  categorizing: "Phase 3/3 — AI categorization",
  done: "Import complete",
  error: "Import failed",
  cancelled: "Import cancelled",
};

const PHASE_DESCRIPTIONS: Record<string, string> = {
  scraping: "Searching the archive.org catalog for Art Bell episodes across multiple collections and metadata fields. Expected: ~5,000+ episodes.",
  importing: "Fetching detailed metadata for each episode and saving to your local library. Duplicate episodes are automatically skipped.",
  categorizing: "Using Gemini AI to determine broadcast dates, identify guests, generate summaries, and tag topics for each episode.",
};

const PHASE_STEPS = ["scraping", "importing", "categorizing"] as const;

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatRate(count: number, elapsedMs: number): string {
  if (elapsedMs < 1000 || count === 0) return "—";
  const perSec = count / (elapsedMs / 1000);
  if (perSec >= 1) return `${perSec.toFixed(1)}/s`;
  const perMin = perSec * 60;
  return `${perMin.toFixed(1)}/min`;
}

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
    startedAt,
    phaseTimes,
    currentItem,
    startScrape,
    cancelScrape,
    categorizeOnly,
    recategorizeAll,
  } = useCatalogScraper();

  const [showErrors, setShowErrors] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isRunning = phase === "scraping" || phase === "importing" || phase === "categorizing";
  const isDone = phase === "done" || phase === "error" || phase === "cancelled";

  // Tick every second while running for elapsed time display
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (isRunning) {
      // Use a 0ms initial tick so the first update happens quickly via the interval callback
      const id = window.setInterval(() => setNow(Date.now()), 1000);
      return () => window.clearInterval(id);
    }
  }, [isRunning]);

  // Progress bar value (0-100)
  const progressPct = useMemo(() => {
    if (phase === "scraping" && total > 0) return Math.round((fetched / total) * 100);
    if (phase === "importing" && fetched > 0) return Math.round(((imported + duplicates) / fetched) * 100);
    if (phase === "categorizing" && imported > 0) return Math.round((categorized / imported) * 100);
    if (phase === "done") return 100;
    return 0;
  }, [phase, total, fetched, imported, duplicates, categorized]);

  // Elapsed time
  const elapsed = useMemo(() => {
    if (!startedAt) return null;
    return now - startedAt;
  }, [startedAt, now]);

  // Phase elapsed
  const phaseElapsed = useMemo(() => {
    const phaseStart = phaseTimes[phase];
    if (!phaseStart) return 0;
    return now - phaseStart;
  }, [phaseTimes, phase, now]);

  // Current phase rate
  const rateLabel = useMemo(() => {
    if (phase === "scraping") return formatRate(fetched, phaseElapsed);
    if (phase === "importing") return formatRate(imported + duplicates, phaseElapsed);
    if (phase === "categorizing") return formatRate(categorized, phaseElapsed);
    return null;
  }, [phase, fetched, imported, duplicates, categorized, phaseElapsed]);

  return (
    <Window title="Import Full Catalog" variant="dark">
      <div className="p-3 flex flex-col gap-3">

        {/* Idle description */}
        {phase === "idle" && (
          <div className="text-[10px] text-bevel-dark/70 leading-relaxed">
            Import the complete Art Bell archive from archive.org. Discovers episodes, imports metadata, and uses AI to categorize.
          </div>
        )}

        {/* Phase stepper */}
        {(isRunning || isDone) && (
          <div className="flex items-center gap-1">
            {PHASE_STEPS.map((step, i) => {
              const stepIdx = PHASE_STEPS.indexOf(phase as typeof PHASE_STEPS[number]);
              const isActive = step === phase;
              const isComplete = isDone || (stepIdx > -1 && i < stepIdx);
              return (
                <div key={step} className="flex items-center gap-1">
                  {i > 0 && (
                    <div className={`w-3 h-[1px] ${isComplete ? "bg-static-green/60" : "bg-bevel-dark/30"}`} />
                  )}
                  <div
                    className={`
                      w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold
                      ${isActive ? "bg-title-bar-blue text-white ring-1 ring-title-bar-blue/50" : ""}
                      ${isComplete && !isActive ? "bg-static-green/20 text-static-green" : ""}
                      ${!isActive && !isComplete ? "bg-inset-well text-bevel-dark" : ""}
                    `}
                  >
                    {isComplete && !isActive ? "\u2713" : i + 1}
                  </div>
                </div>
              );
            })}
            <div className="ml-2 text-[9px] text-desktop-gray flex-1 truncate">
              {PHASE_LABELS[phase] ?? phase}
            </div>
          </div>
        )}

        {/* Phase description */}
        {isRunning && PHASE_DESCRIPTIONS[phase] && (
          <div className="text-[9px] text-bevel-dark/50 leading-relaxed">
            {PHASE_DESCRIPTIONS[phase]}
          </div>
        )}

        {/* Progress bar */}
        {isRunning && (
          <ProgressBar value={progressPct} variant="dark" />
        )}

        {/* Current item + rate */}
        {isRunning && (
          <div className="w98-inset-dark bg-inset-well px-2 py-1 min-h-[20px] flex items-center justify-between">
            <div className="text-[9px] text-desktop-gray truncate flex-1 mr-2">
              {currentItem || "\u00A0"}
            </div>
            {rateLabel && (
              <div className="text-[9px] text-bevel-dark tabular-nums flex-shrink-0">
                {rateLabel}
              </div>
            )}
          </div>
        )}

        {/* Stat grid */}
        {(isRunning || isDone) && (
          <div className="grid grid-cols-3 gap-x-2 gap-y-1.5">
            <StatCard label="Discovered" value={fetched} color="text-desktop-gray" />
            <StatCard label="Imported" value={imported} color="text-static-green" />
            <StatCard label="Duplicates" value={duplicates} color="text-desert-amber" />
            <StatCard label="Categorized" value={categorized} color="text-desktop-gray" />
            <StatCard label="Errors" value={errors} color={errors > 0 ? "text-red-400" : "text-desktop-gray"} />
            {elapsed != null && (
              <StatCard label="Elapsed" value={formatElapsed(elapsed)} color="text-bevel-dark" />
            )}
          </div>
        )}

        {/* Completion summary */}
        {phase === "done" && imported > 0 && (
          <div className="w98-inset-dark bg-inset-well p-2 text-[10px] text-static-green/90 leading-relaxed">
            Successfully imported {imported.toLocaleString()} new episode{imported !== 1 ? "s" : ""}
            {categorized > 0 && ` and categorized ${categorized.toLocaleString()}`}.
            {duplicates > 0 && ` ${duplicates.toLocaleString()} duplicate${duplicates !== 1 ? "s" : ""} skipped.`}
          </div>
        )}

        {phase === "cancelled" && (
          <div className="w98-inset-dark bg-inset-well p-2 text-[10px] text-desert-amber/90 leading-relaxed">
            Import was cancelled. {imported > 0 ? `${imported.toLocaleString()} episodes were imported before cancellation.` : "No episodes were imported."} You can resume from where you left off.
          </div>
        )}

        {phase === "error" && (
          <div className="w98-inset-dark bg-inset-well p-2 text-[10px] text-red-400/90 leading-relaxed">
            Import encountered an error. {imported > 0 ? `${imported.toLocaleString()} episodes were imported before the error.` : "No episodes were imported."} You can retry or resume.
          </div>
        )}

        {/* Error log */}
        {errorMessages.length > 0 && (
          <div>
            <button
              onClick={() => setShowErrors(!showErrors)}
              className="text-[9px] text-red-400/70 hover:text-red-400 cursor-pointer flex items-center gap-1"
            >
              <span className="text-[8px]">{showErrors ? "\u25BC" : "\u25B6"}</span>
              {errorMessages.length} error{errorMessages.length !== 1 ? "s" : ""}
            </button>
            {showErrors && (
              <div className="w98-inset-dark bg-inset-well p-2 mt-1 max-h-[120px] overflow-auto">
                {errorMessages.map((msg, i) => (
                  <div key={i} className="text-[8px] text-red-400/70 leading-relaxed font-mono">
                    {msg}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {!isRunning ? (
            <>
              <Button
                variant="dark"
                size="sm"
                onClick={() => startScrape()}
              >
                {isDone ? "Import Again" : "Start Import"}
              </Button>

              {(phase === "cancelled" || phase === "error") && (
                <Button
                  variant="dark"
                  size="sm"
                  onClick={() => startScrape({ resume: true })}
                >
                  Resume
                </Button>
              )}

              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-[9px] text-bevel-dark hover:text-desktop-gray cursor-pointer ml-auto"
              >
                {showAdvanced ? "Less options" : "More options"}
              </button>
            </>
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

        {/* Advanced options */}
        {showAdvanced && !isRunning && (
          <div className="flex flex-col gap-2 pt-1 border-t border-bevel-dark/20">
            <Button
              variant="dark"
              size="sm"
              onClick={() => startScrape({ skipCategorize: true })}
            >
              Import Only (Skip AI)
            </Button>
            <Button
              variant="dark"
              size="sm"
              onClick={categorizeOnly}
            >
              Categorize Uncategorized
            </Button>
            <Button
              variant="dark"
              size="sm"
              onClick={recategorizeAll}
            >
              Re-categorize All Episodes
            </Button>
            <div className="text-[9px] text-bevel-dark/60 leading-relaxed">
              <strong>Import Only</strong> skips AI categorization (faster).
              <br />
              <strong>Categorize Uncategorized</strong> processes only pending/failed episodes.
              <br />
              <strong>Re-categorize All</strong> re-processes every episode to normalize titles, dates, guests, and tags for uniform sorting and filtering.
            </div>
          </div>
        )}
      </div>
    </Window>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="flex flex-col items-center p-1.5 w98-inset-dark bg-inset-well rounded-sm">
      <div className={`text-[12px] font-bold tabular-nums ${color}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-[8px] text-bevel-dark uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}
