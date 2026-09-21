"use client";

import { useState } from "react";
import type { Episode } from "@/db/schema";
import { Button } from "@/components/win98";
import { cn } from "@/lib/utils/cn";
import {
  SHOW_TYPE_OPTIONS,
  draftFromEpisode,
  draftToFields,
  type EpisodeEditDraft,
} from "@/lib/library/episode-detail";

const inputClass = "w-full bg-inset-well w98-inset-dark px-2 py-2 md:px-1.5 md:py-1 text-hd-title md:text-hd-body text-desktop-gray outline-none min-h-touch md:min-h-0";
const labelClass = "text-hd-body md:text-hd-caption text-bevel-dark uppercase tracking-wider";

/**
 * The detail panel's edit mode. The draft is taken from the episode when the
 * form mounts — i.e. when Edit is pressed — and is not re-read while editing;
 * the panel unmounts the form if the selected episode changes.
 */
export function EpisodeEditForm({
  episode,
  onSave,
  onCancel,
}: {
  episode: Episode;
  onSave: (fields: Partial<Episode>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<EpisodeEditDraft>(() => draftFromEpisode(episode));
  const set = <K extends keyof EpisodeEditDraft>(key: K, value: EpisodeEditDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-0.5">
        <span className={labelClass}>Title</span>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          autoComplete="off"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className={labelClass}>Guest Name</span>
        <input
          type="text"
          value={draft.guestName}
          onChange={(e) => set("guestName", e.target.value)}
          autoComplete="off"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className={labelClass}>Air Date</span>
        <input
          type="date"
          value={draft.airDate}
          onChange={(e) => set("airDate", e.target.value)}
          placeholder="YYYY-MM-DD"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className={labelClass}>Topic</span>
        <input
          type="text"
          value={draft.topic}
          onChange={(e) => set("topic", e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className={labelClass}>Show Type</span>
        <select
          value={draft.showType}
          onChange={(e) => set("showType", e.target.value as Episode["showType"])}
          className={inputClass}
        >
          {SHOW_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className={labelClass}>Category</span>
        <input
          type="text"
          value={draft.aiCategory}
          onChange={(e) => set("aiCategory", e.target.value)}
          placeholder="e.g. UFOs & Aliens, Paranormal, Conspiracy"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className={labelClass}>Series</span>
        <input
          type="text"
          value={draft.aiSeries}
          onChange={(e) => set("aiSeries", e.target.value)}
          placeholder="e.g. Mel's Hole, Area 51 Caller"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className={labelClass}>AI Summary</span>
        <textarea
          value={draft.aiSummary}
          onChange={(e) => set("aiSummary", e.target.value)}
          rows={4}
          className={cn(inputClass, "resize-y")}
        />
      </label>
      <div className="flex items-center gap-2 pt-1">
        <Button variant="dark" size="sm" onClick={() => onSave(draftToFields(draft))}>Save</Button>
        <Button size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
