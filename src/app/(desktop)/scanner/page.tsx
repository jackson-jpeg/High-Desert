"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAdminStore } from "@/stores/admin-store";
import { useFileScanner } from "@/hooks/useFileScanner";
import { useScannerStore } from "@/stores/scanner-store";
import { FolderPicker } from "@/components/scanner/FolderPicker";
import { ScanProgress } from "@/components/scanner/ScanProgress";
import { ScanResults } from "@/components/scanner/ScanResults";
import { CatalogScraper } from "@/components/scraper/CatalogScraper";
import { CollectionImport } from "@/components/scraper/CollectionImport";

export default function ScannerPage() {
  const router = useRouter();
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const { startScan, startScanFallback, cancelScan, supportsNativePicker } =
    useFileScanner();
  const status = useScannerStore((s) => s.status);

  useEffect(() => {
    if (!isAdmin) router.replace("/library");
  }, [isAdmin, router]);

  if (!isAdmin) return null;

  const isScanning = status === "scanning";
  const hasResults =
    status === "completed" || status === "cancelled" || status === "error";

  return (
    <div className="h-full overflow-auto overscroll-contain p-4 flex flex-col gap-5 max-w-2xl mx-auto">
      {/* Section header */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] text-desert-amber font-bold uppercase tracking-wider">Import Sources</span>
        <div className="flex-1 h-[1px] bg-gradient-to-r from-desert-amber/30 to-transparent" />
      </div>

      {/* Featured collection import — one-click for the Ultimate Art Bell Collection */}
      <CollectionImport />

      {/* Divider */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex-1 h-[1px] bg-bevel-dark/20" />
        <span className="text-[9px] text-bevel-dark/50 uppercase tracking-widest">or search the full catalog</span>
        <div className="flex-1 h-[1px] bg-bevel-dark/20" />
      </div>

      {/* Archive.org catalog search/import */}
      <CatalogScraper />

      {/* Divider */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex-1 h-[1px] bg-bevel-dark/20" />
        <span className="text-[9px] text-bevel-dark/50 uppercase tracking-widest">or import local files</span>
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
