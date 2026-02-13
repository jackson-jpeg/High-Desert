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
      {/* Archive.org catalog import — primary action */}
      <CatalogScraper />

      {/* Divider */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex-1 h-[1px] bg-bevel-dark/20" />
        <span className="text-[9px] text-bevel-dark/60 uppercase tracking-widest">or import local files</span>
        <div className="flex-1 h-[1px] bg-bevel-dark/20" />
      </div>

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
    </div>
  );
}
