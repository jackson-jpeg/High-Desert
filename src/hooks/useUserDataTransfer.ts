"use client";

import { useCallback, useState } from "react";
import { toast } from "@/stores/toast-store";
import type { ImportSummary, UserDataFile } from "@/services/user-data/portable";

/**
 * The shell's side of "Export / Import My Data" (HD-010): the menu actions,
 * and the state of an import awaiting confirmation. Shared by the desktop File
 * menu and the mobile menu sheet.
 *
 * The data module is imported on demand — most visits never use it, and it
 * stays out of the chunk every visitor downloads.
 */
export interface PendingImport {
  fileName: string;
  data: UserDataFile;
  summary: ImportSummary;
}

const loadPortable = () => import("@/services/user-data/portable");

/**
 * Open the browser's file picker. Must be called synchronously from the click
 * that asked for it: a picker opened after an `await` has lost the user
 * activation, and Safari silently refuses it.
 */
function pickJsonFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    const done = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => done(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => done(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export function useUserDataTransfer() {
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [importing, setImporting] = useState(false);

  const exportData = useCallback(async () => {
    try {
      const [{ buildUserDataExport, userDataFileName }, { downloadJson }] = await Promise.all([
        loadPortable(),
        import("@/lib/utils/download"),
      ]);
      const data = await buildUserDataExport();
      downloadJson(userDataFileName(), data);
      const favs = data.episodes.filter((e) => e.favoritedAt).length;
      toast.success(`Exported your data — ${favs} favourite${favs === 1 ? "" : "s"}, ${data.history.length} history entries`);
    } catch (err) {
      console.error("[user-data] export failed:", err);
      toast.error("Couldn't export your data");
    }
  }, []);

  const importData = useCallback(() => {
    // Picker first, synchronously, then everything async.
    const picked = pickJsonFile();
    void (async () => {
      const file = await picked;
      if (!file) return;
      try {
        const { parseUserData, previewUserDataImport } = await loadPortable();
        const parsed = parseUserData(await file.text());
        if (!parsed.ok) {
          toast.error(parsed.reason);
          return;
        }
        const summary = await previewUserDataImport(parsed.data);
        setPending({ fileName: file.name, data: parsed.data, summary });
      } catch (err) {
        console.error("[user-data] import preview failed:", err);
        toast.error("Couldn't read that file");
      }
    })();
  }, []);

  const confirmImport = useCallback(async () => {
    if (!pending) return;
    setImporting(true);
    try {
      const { importUserData, isEmptyImport } = await loadPortable();
      const result = await importUserData(pending.data);
      toast.success(isEmptyImport(result) ? "Nothing new to import" : "Your data was imported");
      setPending(null);
    } catch (err) {
      // One transaction: a failure here has written nothing.
      console.error("[user-data] import failed:", err);
      toast.error("Import failed — nothing was changed");
    } finally {
      setImporting(false);
    }
  }, [pending]);

  const cancelImport = useCallback(() => setPending(null), []);

  return { exportData, importData, pending, importing, confirmImport, cancelImport };
}
