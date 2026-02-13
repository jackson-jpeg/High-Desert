"use client";

import { useFileScanner } from "@/hooks/useFileScanner";
import { useScannerStore } from "@/stores/scanner-store";
import { FolderPicker } from "@/components/scanner/FolderPicker";
import { ScanProgress } from "@/components/scanner/ScanProgress";
import { ScanResults } from "@/components/scanner/ScanResults";
import { CatalogScraper } from "@/components/scraper/CatalogScraper";

export default function ScannerPage() {
  const { startScan, startScanFallback, cancelScan, supportsNativePicker } =
    useFileScanner();
  const status = useScannerStore((s) => s.status);

  const isScanning = status === "scanning";
  const hasResults =
    status === "completed" || status === "cancelled" || status === "error";

  return (
    <div className="p-4 flex flex-col gap-4 max-w-2xl mx-auto">
      {/* Folder picker (disabled while scanning) */}
      <FolderPicker
        onPickNative={startScan}
        onPickFallback={startScanFallback}
        supportsNativePicker={supportsNativePicker}
        disabled={isScanning}
      />

      {/* Progress display */}
      {(isScanning || hasResults) && <ScanProgress onCancel={cancelScan} />}

      {/* Results table */}
      {hasResults && <ScanResults />}

      {/* Catalog scraper */}
      <CatalogScraper />
    </div>
  );
}
