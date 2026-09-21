"use client";

import { useEffect, useRef, useState } from "react";
import type { Episode } from "@/db/schema";
import { toast } from "@/stores/toast-store";
import { shareText as buildShareText, shareUrl } from "@/lib/library/episode-detail";

const linkClass = "text-hd-body md:text-hd-caption text-bevel-dark/85 hover:text-desktop-gray active:text-desktop-gray cursor-pointer transition-colors-fast min-h-touch md:min-h-0 flex items-center";
const menuItemClass = "w-full text-left px-3 py-3 md:px-2 md:py-1.5 text-hd-title md:text-hd-caption text-desktop-gray/85 hover:bg-title-bar-blue/20 active:bg-title-bar-blue/20 cursor-pointer transition-colors-fast";

/** Copy a link that resolves in anyone's browser, or hand it to the Web Share sheet. */
export function EpisodeShareButton({ episode }: { episode: Episode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const url = typeof window !== "undefined" ? shareUrl(window.location.origin, episode) : "";
  const shareText = buildShareText(episode);

  const copyLink = () => {
    navigator.clipboard.writeText(url).then(() => toast.success("Link copied")).catch(() => toast.info(url));
    setMenuOpen(false);
  };

  const webShare = async () => {
    try {
      await navigator.share({ title: episode.title || episode.fileName, text: shareText, url });
    } catch { /* user cancelled */ }
    setMenuOpen(false);
  };

  const hasWebShare = typeof navigator !== "undefined" && !!navigator.share;

  if (!hasWebShare) {
    // No Web Share API — just copy link directly
    return (
      <button onClick={copyLink} className={linkClass}>
        Share
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setMenuOpen(!menuOpen)} className={linkClass}>
        Share
      </button>
      {menuOpen && (
        <div className="absolute bottom-full mb-1 left-0 w98-raised-dark bg-raised-surface z-30 min-w-[120px] shadow-lg">
          <button onClick={copyLink} className={menuItemClass}>
            Copy Link
          </button>
          <button onClick={webShare} className={menuItemClass}>
            Share...
          </button>
        </div>
      )}
    </div>
  );
}
