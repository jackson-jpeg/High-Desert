"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Menu } from "@/components/win98";
import { useAdminStore } from "@/stores/admin-store";
import { toast } from "@/stores/toast-store";
import { db } from "@/db";
import { exportLibrarySeed } from "@/db/seed";
import { TEXT_SCALE_OPTIONS, type TextScaleValue } from "@/hooks/useTextScalePreference";
import { emit } from "@/lib/events";

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
}

function dispatchSort(sort: string) {
  emit("sort", sort);
}

async function exportLibrary() {
  const episodes = await db.episodes.toArray();
  const data = {
    version: "0.4.0",
    exportedAt: new Date().toISOString(),
    episodeCount: episodes.length,
    episodes: episodes.map((ep) => ({
      title: ep.title,
      artist: ep.artist,
      airDate: ep.airDate,
      guestName: ep.guestName,
      showType: ep.showType,
      topic: ep.topic,
      description: ep.description,
      duration: ep.duration,
      format: ep.format,
      source: ep.source,
      sourceUrl: ep.sourceUrl,
      archiveIdentifier: ep.archiveIdentifier,
      aiSummary: ep.aiSummary,
      aiTags: ep.aiTags,
      aiStatus: ep.aiStatus,
      playbackPosition: ep.playbackPosition,
      playCount: ep.playCount,
      lastPlayedAt: ep.lastPlayedAt,
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `high-desert-library-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${episodes.length} episodes`);
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
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const logout = useCallback(() => {
    useAdminStore.getState().logout();
    toast.info("Admin mode disabled");
  }, []);

  const {
    onAbout, onShortcuts, onClearLibrary, onClearCache,
    startupSoundOn, onToggleStartupSound, textScale, onSetTextScale, onInstall,
  } = actions;

  return [
    {
      label: "File",
      items: [
        ...(isAdmin
          ? [{ label: "Open Folder...", shortcut: "Ctrl+O", onClick: () => router.push("/scanner") },
             { separator: true as const, label: "" }]
          : []),
        { label: "Exit", onClick: () => window.close() },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Sort by Date", onClick: () => dispatchSort("date") },
        { label: "Sort by Name", onClick: () => dispatchSort("name") },
        { label: "Sort by Guest", onClick: () => dispatchSort("guest") },
        { separator: true, label: "" },
        { label: "Recently Played", onClick: () => dispatchSort("recent") },
        { label: "In Progress", onClick: () => dispatchSort("progress") },
        { label: "Top Rated", onClick: () => dispatchSort("rated") },
        { label: "Most Played", onClick: () => dispatchSort("played") },
        { separator: true, label: "" },
        { label: "Surprise Me — Shuffle All", onClick: () => emit("shuffle", "all") },
        { label: "Shuffle Coast to Coast", onClick: () => emit("shuffle", "coast") },
        { label: "Shuffle Dreamland", onClick: () => emit("shuffle", "dreamland") },
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
            { label: "Export Library...", onClick: exportLibrary },
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
