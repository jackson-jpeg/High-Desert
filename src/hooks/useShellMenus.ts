"use client";

import { sortLabel } from "@/lib/library/sort-keys";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Menu } from "@/components/win98";
import { useAdminStore } from "@/stores/admin-store";
import { toast } from "@/stores/toast-store";
import { exportLibrarySeed } from "@/db/catalog-export";
import { TEXT_SCALE_OPTIONS, type TextScaleValue } from "@/hooks/useTextScalePreference";
import { useOpenLibraryIntent } from "@/hooks/useOpenLibraryIntent";
import type { SortMode } from "@/lib/library/filter-episodes";

/**
 * What the menus open or toggle. The state behind these stays in the shell,
 * because the mobile menu sheet and the dialogs read the same values.
 */
export interface ShellMenuActions {
  onAbout: () => void;
  onShortcuts: () => void;
  onClearLibrary: () => void;
  onClearCache: () => void;
  startupSoundOn: boolean;
  onToggleStartupSound: () => void;
  textScale: TextScaleValue;
  onSetTextScale: (value: TextScaleValue) => void;
  /** Present only once the browser has offered a PWA install. */
  onInstall?: () => void;
  /** Download the listener's own data (src/services/user-data/portable.ts). */
  onExportData: () => void;
  /** Pick a file, preview what it adds, and merge it in on confirm. */
  onImportData: () => void;
}

async function deduplicateLibrary() {
  // Two-step: preview, confirm, then execute. This deletes episodes
  // irreversibly and there is no server backup.
  // Admin-only: load the dedup module on demand so it stays out
  // of the bundle every visitor downloads.
  const { previewDeduplication, validatePlan, deduplicateEpisodes } =
    await import("@/db/deduplicate");
  const plan = await previewDeduplication();
  if (plan.duplicatesToRemove === 0) {
    toast.info("No duplicates found");
    return;
  }
  const check = validatePlan(plan);
  if (!check.ok) {
    toast.error(check.reason);
    return;
  }
  const ok = window.confirm(
    `Delete ${plan.duplicatesToRemove} duplicate episode${plan.duplicatesToRemove !== 1 ? "s" : ""} ` +
    `from ${plan.groups.length} group${plan.groups.length !== 1 ? "s" : ""}?\n\n` +
    `${plan.totalBefore} episodes before, ${plan.totalBefore - plan.duplicatesToRemove} after.\n` +
    `This cannot be undone.`,
  );
  if (!ok) return;

  const result = await deduplicateEpisodes();
  if (result.aborted) {
    toast.error(result.reason ?? "Deduplication aborted");
  } else if (result.duplicatesRemoved > 0) {
    toast.success(`Removed ${result.duplicatesRemoved} duplicate${result.duplicatesRemoved !== 1 ? "s" : ""} from ${result.groupsMerged} group${result.groupsMerged !== 1 ? "s" : ""}`);
  } else {
    toast.info("No duplicates found");
  }
}

/**
 * The desktop menu bar's File / View / Library / Help menus.
 *
 * Rebuilt on every render of the caller, as before — which is why the shell
 * must not re-render on a timer (see StatusBar.tsx).
 */
export function useShellMenus(actions: ShellMenuActions): Menu[] {
  const router = useRouter();
  const openLibrary = useOpenLibraryIntent();
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const logout = useCallback(() => {
    useAdminStore.getState().logout();
    toast.info("Admin mode disabled");
  }, []);

  // Every library action is a URL intent: these menus are on every route,
  // and the library is mounted on one (HD-013).
  const sort = (mode: SortMode) => openLibrary({ sort: mode });

  const {
    onAbout, onShortcuts, onClearLibrary, onClearCache,
    startupSoundOn, onToggleStartupSound, textScale, onSetTextScale, onInstall,
    onExportData, onImportData,
  } = actions;

  return [
    {
      label: "File",
      items: [
        ...(isAdmin
          ? [{ label: "Open Folder...", shortcut: "Ctrl+O", onClick: () => router.push("/scanner") },
             { separator: true as const, label: "" }]
          : []),
        // Everything a listener owns is in this browser only; this is their copy.
        { label: "Export My Data...", onClick: onExportData },
        { label: "Import My Data...", onClick: onImportData },
        { separator: true, label: "" },
        { label: "Exit", onClick: () => window.close() },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Sort by Date", onClick: () => sort("date") },
        { label: "Sort by Date — Oldest First", onClick: () => sort("date-asc") },
        { label: "Sort by Name", onClick: () => sort("name") },
        { label: "Sort by Guest", onClick: () => sort("guest") },
        { separator: true, label: "" },
        { label: "Recently Played", onClick: () => sort("recent") },
        { label: "In Progress", onClick: () => sort("progress") },
        { label: sortLabel("played"), onClick: () => sort("played") },
        { label: sortLabel("rated"), onClick: () => sort("rated") },
        { label: sortLabel("my-plays"), onClick: () => sort("my-plays") },
        { label: sortLabel("my-rating"), onClick: () => sort("my-rating") },
        { separator: true, label: "" },
        { label: "Surprise Me — Shuffle All", onClick: () => openLibrary({ shuffle: "all" }) },
        { label: "Shuffle Coast to Coast", onClick: () => openLibrary({ shuffle: "coast" }) },
        { label: "Shuffle Dreamland", onClick: () => openLibrary({ shuffle: "dreamland" }) },
        { separator: true, label: "" },
        { label: "Radio Dial", onClick: () => router.push("/radio") },
        { label: "Statistics", onClick: () => router.push("/stats") },
      ],
    },
    ...(isAdmin
      ? [{
          label: "Library",
          items: [
            { label: "Scan Folder...", shortcut: "Ctrl+Shift+S", onClick: () => router.push("/scanner") },
            { label: "Search Archive...", onClick: () => router.push("/search") },
            { label: "Import Catalog...", onClick: () => router.push("/scanner") },
            { separator: true as const, label: "" },
            // The catalog for public/seed/, without the admin's own listening
            // (HD-025). The old "Export Library..." wrote an envelope nothing
            // could read back, with positions and play counts in it; a
            // listener's own copy is File > Export My Data now.
            { label: "Export Library Seed...", onClick: exportLibrarySeed },
            { separator: true as const, label: "" },
            { label: "Deduplicate Library...", onClick: deduplicateLibrary },
            { separator: true as const, label: "" },
            { label: "Clear Audio Cache...", onClick: onClearCache },
            { label: "Clear Library...", onClick: onClearLibrary },
          ],
        }]
      : []),
    {
      label: "Help",
      items: [
        { label: "Keyboard Shortcuts", onClick: onShortcuts },
        { separator: true, label: "" },
        {
          label: startupSoundOn ? "Startup Sound ✓" : "Startup Sound",
          onClick: onToggleStartupSound,
        },
        { separator: true, label: "" },
        ...TEXT_SCALE_OPTIONS.map((opt) => ({
          label: `Text Size: ${opt.label}${textScale === opt.value ? " ✓" : ""}`,
          onClick: () => onSetTextScale(opt.value),
        })),
        { separator: true, label: "" },
        ...(isAdmin
          ? [{ label: "Log Out of Admin", onClick: logout },
             { separator: true as const, label: "" }]
          : []),
        ...(onInstall ? [
          { label: "Install App...", onClick: onInstall },
          { separator: true as const, label: "" },
        ] : []),
        { label: "About High Desert", onClick: onAbout },
      ],
    },
  ];
}
