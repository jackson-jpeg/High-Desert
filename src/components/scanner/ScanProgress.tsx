"use client";

import { ProgressBar, Button, Window } from "@/components/win98";
import { useScannerStore } from "@/stores/scanner-store";

interface ScanProgressProps {
  onCancel: () => void;
}

export function ScanProgress({ onCancel }: ScanProgressProps) {
  const {
    status,
    totalFiles,
    processedFiles,
    currentFile,
    newEpisodes,
    duplicates,
    errors,
    errorMessages,
  } = useScannerStore();

  const percent =
    totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;

  const isScanning = status === "scanning";

  return (
    <Window
      title={isScanning ? "Scanning..." : "Scan Complete"}
      variant="dark"
    >
      <div className="p-4 flex flex-col gap-3">
        {/* Progress bar */}
        <ProgressBar value={percent} variant="dark" />

        {/* Current file */}
        <div className="w98-inset-dark bg-inset-well px-2 py-1 min-h-[20px]">
          <div className="text-[10px] text-desktop-gray truncate">
            {isScanning && currentFile
              ? currentFile
              : status === "completed"
                ? "Done!"
                : status === "cancelled"
                  ? "Cancelled"
                  : status === "error"
                    ? "Error occurred"
                    : "\u00A0"}
          </div>
        </div>

        {/* Counts */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <div className="text-bevel-dark">Progress:</div>
          <div className="text-desktop-gray">
            {processedFiles} / {totalFiles} files ({percent}%)
          </div>
          <div className="text-bevel-dark">New episodes:</div>
          <div className="text-static-green">{newEpisodes}</div>
          <div className="text-bevel-dark">Duplicates:</div>
          <div className="text-desktop-gray">{duplicates}</div>
          {errors > 0 && (
            <>
              <div className="text-bevel-dark">Errors:</div>
              <div className="text-red-400">{errors}</div>
            </>
          )}
        </div>

        {/* Empty results message */}
        {status === "completed" && newEpisodes === 0 && duplicates === 0 && errors === 0 && (
          <div className="text-center text-[11px] text-desktop-gray">
            No new episodes or duplicates found.
          </div>
        )}

        {/* Loading state */}
        {status === "loading" && (
          <div className="text-center text-[11px] text-desktop-gray">
            Preparing scan...
          </div>
        )}

        {/* Error messages */}
        {status === "error" && errorMessages.length > 0 && (
          <div className="w98-inset-dark bg-inset-well p-2 max-h-32 overflow-y-auto">
            <div className="text-[10px] text-red-400 font-bold mb-1">Errors:</div>
            {errorMessages.map((msg, idx) => (
              <div key={idx} className="text-[10px] text-red-400 break-words">
                • {msg}
              </div>
            ))}
          </div>
        )}

        {/* Cancel / Close button */}
        {isScanning ? (
          <div className="flex justify-end">
            <Button variant="dark" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button variant="dark" onClick={onCancel}>
              Close
            </Button>
          </div>
        )}
      </div>
    </Window>
  );
}
