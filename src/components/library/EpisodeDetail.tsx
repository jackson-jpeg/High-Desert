"use client";

import { useState, useEffect } from "react";
import type { Episode } from "@/lib/db/schema";
import { Button } from "@/components/win98";
import { usePlayerStore } from "@/stores/player-store";
import { toast } from "@/stores/toast-store";
import { rateEpisode } from "@/lib/episodes/management";
import { BookmarkList } from "@/components/player/BookmarkMarkers";
import { MoreLikeThis } from "@/components/library/MoreLikeThis";
import { cn } from "@/lib/utils/cn";
import { formatDuration, formatTime, getShowLabel } from "@/lib/utils/format";

interface EpisodeDetailProps {
  episode: Episode;
  isPlaying: boolean;
  onPlay: (episode: Episode) => void;
  onClose: () => void;
  onDelete?: (episode: Episode) => void;
  onRecategorize?: (episode: Episode) => void;
  onEdit?: (id: number, fields: Partial<Episode>) => void;
  onToggleFavorite?: (episode: Episode) => void;
  className?: string;
}

const SHOW_TYPE_OPTIONS: { value: Episode["showType"]; label: string }[] = [
  { value: "coast", label: "Coast to Coast" },
  { value: "dreamland", label: "Dreamland" },
  { value: "special", label: "Special" },
  { value: "unknown", label: "Unknown" },
];

export function EpisodeDetail({
  episode,
  isPlaying,
  onPlay,
  onClose,
  onDelete,
  onRecategorize,
  onEdit,
  onToggleFavorite,
  className,
}: EpisodeDetailProps) {
  const showLabel = getShowLabel(episode.showType);
  const isArchive = episode.source === "archive";

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editGuest, setEditGuest] = useState("");
  const [editAirDate, setEditAirDate] = useState("");
  const [editTopic, setEditTopic] = useState("");
  const [editShowType, setEditShowType] = useState<Episode["showType"]>("unknown");
  const [editSummary, setEditSummary] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editSeries, setEditSeries] = useState("");

  // Reset edit state when episode changes
  useEffect(() => {
    setEditing(false);
  }, [episode.id]);

  const startEditing = () => {
    setEditTitle(episode.title ?? "");
    setEditGuest(episode.guestName ?? "");
    setEditAirDate(episode.airDate ?? "");
    setEditTopic(episode.topic ?? "");
    setEditShowType(episode.showType ?? "unknown");
    setEditSummary(episode.aiSummary ?? "");
    setEditCategory(episode.aiCategory ?? "");
    setEditSeries(episode.aiSeries ?? "");
    setEditing(true);
  };

  const handleSave = () => {
    if (!onEdit || !episode.id) return;
    onEdit(episode.id, {
      title: editTitle || undefined,
      guestName: editGuest || undefined,
      airDate: editAirDate || undefined,
      topic: editTopic || undefined,
      showType: editShowType,
      aiSummary: editSummary || undefined,
      aiCategory: editCategory || undefined,
      aiSeries: editSeries || undefined,
    });
    setEditing(false);
    toast.success("Episode updated");
  };

  const handleCancel = () => {
    setEditing(false);
  };

  const inputClass = "w-full bg-inset-well w98-inset-dark px-1.5 py-1 text-desktop-gray outline-none";

  return (
    <div
      className={cn(
        "w98-raised-dark bg-raised-surface flex flex-col animate-slide-up",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-bevel-dark/20">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-bevel-dark/70">
            {[showLabel, isArchive ? "Archive" : null].filter(Boolean).join(" \u00B7 ")}
          </span>
          {episode.aiCategory && (
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent("hd:filter-category", { detail: episode.aiCategory }));
              }}
              className="text-[8px] text-desert-amber/60 bg-desert-amber/8 px-1 py-px cursor-pointer hover:text-desert-amber hover:bg-desert-amber/15 transition-colors-fast"
              title={`Filter by ${episode.aiCategory}`}
            >
              {episode.aiCategory}
            </button>
          )}
          {episode.aiNotable && (
            <span className="text-[9px] text-yellow-400/80" title="Notable episode">
              {"\u272A"}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-[12px] md:text-[10px] text-bevel-dark hover:text-desktop-gray active:text-desktop-gray cursor-pointer flex-shrink-0 min-w-[32px] min-h-[32px] md:min-w-0 md:min-h-0 flex items-center justify-center"
          aria-label="Close detail"
        >
          {"\u2715"}
        </button>
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col gap-2.5 max-h-[50vh] overflow-auto md:max-h-none md:overflow-visible">
        {editing ? (
          /* ── Edit Mode ── */
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[8px] text-bevel-dark uppercase tracking-wider">Title</span>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className={cn(inputClass, "text-[12px]")}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[8px] text-bevel-dark uppercase tracking-wider">Guest Name</span>
              <input
                type="text"
                value={editGuest}
                onChange={(e) => setEditGuest(e.target.value)}
                className={cn(inputClass, "text-[11px]")}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[8px] text-bevel-dark uppercase tracking-wider">Air Date</span>
              <input
                type="text"
                value={editAirDate}
                onChange={(e) => setEditAirDate(e.target.value)}
                placeholder="YYYY-MM-DD"
                className={cn(inputClass, "text-[11px]")}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[8px] text-bevel-dark uppercase tracking-wider">Topic</span>
              <input
                type="text"
                value={editTopic}
                onChange={(e) => setEditTopic(e.target.value)}
                className={cn(inputClass, "text-[11px]")}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[8px] text-bevel-dark uppercase tracking-wider">Show Type</span>
              <select
                value={editShowType}
                onChange={(e) => setEditShowType(e.target.value as Episode["showType"])}
                className={cn(inputClass, "text-[11px]")}
              >
                {SHOW_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[8px] text-bevel-dark uppercase tracking-wider">Category</span>
              <input
                type="text"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                placeholder="e.g. UFOs & Aliens, Paranormal, Conspiracy"
                className={cn(inputClass, "text-[11px]")}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[8px] text-bevel-dark uppercase tracking-wider">Series</span>
              <input
                type="text"
                value={editSeries}
                onChange={(e) => setEditSeries(e.target.value)}
                placeholder="e.g. Mel's Hole, Area 51 Caller"
                className={cn(inputClass, "text-[11px]")}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[8px] text-bevel-dark uppercase tracking-wider">AI Summary</span>
              <textarea
                value={editSummary}
                onChange={(e) => setEditSummary(e.target.value)}
                rows={4}
                className={cn(inputClass, "text-[10px] resize-y")}
              />
            </label>
            <div className="flex items-center gap-2 pt-1">
              <Button variant="dark" size="sm" onClick={handleSave}>Save</Button>
              <Button size="sm" onClick={handleCancel}>Cancel</Button>
            </div>
          </div>
        ) : (
          /* ── View Mode ── */
          <>
            {/* Title + date + duration */}
            <div>
              <div className="text-[14px] md:text-[12px] text-desktop-gray font-bold leading-snug">
                {episode.title || episode.fileName}
              </div>
              <div className="flex items-center gap-2 mt-1">
                {episode.airDate && (
                  <span className="text-[10px] text-desert-amber tabular-nums">
                    {episode.airDate}
                  </span>
                )}
                {episode.duration != null && (
                  <span className="text-[10px] text-bevel-dark/70 tabular-nums">
                    {formatDuration(episode.duration)}
                  </span>
                )}
              </div>
            </div>

            {/* Guest */}
            {episode.guestName && (
              <div className="text-[13px] md:text-[11px] text-static-green/80">
                {episode.guestName}
              </div>
            )}

            {/* Topic */}
            {episode.topic && !episode.guestName && (
              <div className="text-[13px] md:text-[11px] text-desktop-gray/80">
                {episode.topic}
              </div>
            )}

            {/* Series */}
            {episode.aiSeries && (
              <div className="text-[10px] text-title-bar-blue/70 flex items-center gap-1">
                <span>{"\u{1F4DA}"}</span>
                <span>
                  {episode.aiSeries}
                  {episode.aiSeriesPart ? ` \u2014 Part ${episode.aiSeriesPart}` : ""}
                </span>
              </div>
            )}

            {/* Summary or Description */}
            {(episode.aiSummary || episode.description) && (
              <div className="text-[12px] md:text-[10px] text-desktop-gray/60 leading-relaxed">
                {episode.aiSummary || episode.description}
              </div>
            )}

            {/* Tags (clickable) */}
            {episode.aiTags && episode.aiTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {episode.aiTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("hd:filter-tag", { detail: tag }));
                    }}
                    className="text-[8px] text-desert-amber/70 bg-desert-amber/8 px-1.5 py-px cursor-pointer hover:bg-desert-amber/15 hover:text-desert-amber transition-colors-fast"
                    title={`Filter by "${tag}"`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            {/* Bookmarks */}
            {episode.id && (
              <BookmarkList episodeId={episode.id} />
            )}

            {/* Playback progress */}
            {episode.playbackPosition != null && episode.playbackPosition > 0 && episode.duration != null && episode.duration > 0 && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-[3px] w98-inset-dark bg-inset-well overflow-hidden">
                  <div
                    className={cn(
                      "h-full",
                      episode.playbackPosition / episode.duration > 0.9
                        ? "bg-static-green/50"
                        : "bg-phosphor-amber/50",
                    )}
                    style={{ width: `${Math.min(100, (episode.playbackPosition / episode.duration) * 100)}%` }}
                  />
                </div>
                <span className="text-[9px] text-bevel-dark/70 tabular-nums flex-shrink-0">
                  {formatTime(episode.playbackPosition)} / {formatDuration(episode.duration)}
                </span>
              </div>
            )}

            {/* Play stats */}
            {(episode.playCount ?? 0) > 0 && (
              <div className="text-[9px] text-bevel-dark/50 tabular-nums">
                {episode.playCount != null && episode.playCount > 0 && `Played ${episode.playCount}x`}
                {episode.lastPlayedAt != null && episode.lastPlayedAt > 0 && (
                  <> &middot; {new Date(episode.lastPlayedAt).toLocaleDateString()}</>
                )}
              </div>
            )}

            {/* Play buttons */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="dark"
                size="sm"
                onClick={() => onPlay(episode)}
                disabled={isPlaying}
              >
                {isPlaying ? "Playing" : "Play"}
              </Button>
              <Button
                variant="dark"
                size="sm"
                onClick={() => {
                  usePlayerStore.getState().enqueueNext(episode);
                  toast.info(`"${episode.title || episode.fileName}" plays next`);
                }}
                disabled={isPlaying}
              >
                Play Next
              </Button>
              <Button
                variant="dark"
                size="sm"
                onClick={() => {
                  usePlayerStore.getState().enqueue(episode);
                  toast.info("Added to queue");
                }}
              >
                Queue
              </Button>
              {onToggleFavorite && (
                <button
                  onClick={() => onToggleFavorite(episode)}
                  className={cn(
                    "text-[14px] md:text-[12px] cursor-pointer transition-colors-fast ml-auto min-w-[32px] min-h-[32px] md:min-w-0 md:min-h-0 flex items-center justify-center",
                    episode.favoritedAt ? "text-desert-amber" : "text-bevel-dark/40 hover:text-desert-amber",
                  )}
                  title={episode.favoritedAt ? "Remove from favorites" : "Add to favorites"}
                >
                  {episode.favoritedAt ? "\u2605" : "\u2606"}
                </button>
              )}
            </div>

            {/* Star rating */}
            {episode.id && (
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={async () => {
                      const newRating = episode.rating === star ? undefined : star;
                      await rateEpisode(episode.id!, newRating);
                    }}
                    className={cn(
                      "text-[14px] md:text-[11px] cursor-pointer transition-colors-fast",
                      star <= (episode.rating ?? 0)
                        ? "text-desert-amber"
                        : "text-bevel-dark/30 hover:text-desert-amber/60",
                    )}
                    title={`Rate ${star} star${star !== 1 ? "s" : ""}`}
                    aria-label={`Rate ${star} star${star !== 1 ? "s" : ""}`}
                  >
                    {star <= (episode.rating ?? 0) ? "\u2605" : "\u2606"}
                  </button>
                ))}
                {episode.rating && (
                  <span className="text-[8px] text-bevel-dark/40 ml-1">{episode.rating}/5</span>
                )}
              </div>
            )}

            {/* File info + management */}
            <div className="flex items-center gap-2 border-t border-bevel-dark/15 pt-2 mt-0.5">
              {episode.archiveIdentifier && (
                <a
                  href={`https://archive.org/details/${episode.archiveIdentifier}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] md:text-[9px] text-bevel-dark/50 hover:text-desktop-gray active:text-desktop-gray cursor-pointer transition-colors-fast min-h-[32px] md:min-h-0 flex items-center"
                >
                  Archive
                </a>
              )}
              <button
                onClick={() => {
                  const url = `${window.location.origin}/library?episode=${episode.id}`;
                  navigator.clipboard.writeText(url).then(() => {
                    toast.success("Link copied");
                  }).catch(() => {
                    toast.info(url);
                  });
                }}
                className="text-[12px] md:text-[9px] text-bevel-dark/50 hover:text-desktop-gray active:text-desktop-gray cursor-pointer transition-colors-fast min-h-[32px] md:min-h-0 flex items-center"
              >
                Share
              </button>
              {onEdit && (
                <button
                  onClick={startEditing}
                  className="text-[12px] md:text-[9px] text-bevel-dark/50 hover:text-desktop-gray active:text-desktop-gray cursor-pointer transition-colors-fast min-h-[32px] md:min-h-0 flex items-center"
                >
                  Edit
                </button>
              )}
              {onRecategorize && (
                <button
                  onClick={() => onRecategorize(episode)}
                  className="text-[12px] md:text-[9px] text-bevel-dark/50 hover:text-desktop-gray active:text-desktop-gray cursor-pointer transition-colors-fast min-h-[32px] md:min-h-0 flex items-center"
                >
                  Re-categorize
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => onDelete(episode)}
                  className="text-[12px] md:text-[9px] text-red-400/40 hover:text-red-400 active:text-red-400 cursor-pointer transition-colors-fast ml-auto min-h-[32px] md:min-h-0 flex items-center"
                >
                  Delete
                </button>
              )}
            </div>

            {/* Recommendations */}
            <MoreLikeThis episode={episode} onPlay={onPlay} />
          </>
        )}
      </div>
    </div>
  );
}
