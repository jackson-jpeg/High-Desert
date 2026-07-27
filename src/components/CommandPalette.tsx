"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/db";
import { usePlayerStore } from "@/stores/player-store";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils/cn";
import { lockScroll, unlockScroll } from "@/lib/utils/scroll-lock";

interface Result {
  id: string;
  group: "Episodes" | "Go to" | "Actions";
  label: string;
  subtitle?: string;
  action: () => void;
}

const ROUTES: Result[] = [
  { id: "nav-library", group: "Go to", label: "Library", action: () => {} },
  { id: "nav-radio", group: "Go to", label: "Radio Dial", action: () => {} },
  { id: "nav-stats", group: "Go to", label: "Statistics", action: () => {} },
  { id: "nav-scanner", group: "Go to", label: "Scanner", action: () => {} },
  { id: "nav-search", group: "Go to", label: "Archive Search", action: () => {} },
];

const ROUTE_PATHS: Record<string, string> = {
  "nav-library": "/library",
  "nav-radio": "/radio",
  "nav-stats": "/stats",
  "nav-scanner": "/scanner",
  "nav-search": "/search",
};

function fuzzyMatch(text: string, query: string): boolean {
  return scoreMatch(text, query) > 0;
}

/**
 * Relevance score, 0 meaning no match. Higher is better.
 *
 * The old predicate was pure subsequence matching with no ranking, and callers
 * took the first five hits in *table order* — so typing "bell" surfaced
 * whichever rows happened to sit earliest in IndexedDB rather than the best
 * matches, and results bore little resemblance to the main search bar's.
 *
 * Subsequence matching is kept as the weakest tier so short abbreviations
 * still work ("cchg" → "Coast to Coast — Hoagland"), but exact and
 * word-boundary hits now outrank it decisively.
 */
function scoreMatch(text: string, query: string): number {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 0;

  if (lower.startsWith(q)) return 1000 - lower.length;

  const idx = lower.indexOf(q);
  if (idx === 0) return 900;
  if (idx > 0) {
    // Word-boundary hits beat mid-word ones.
    const boundary = idx === 0 || /[\s\-–—:,.(]/.test(lower[idx - 1]);
    return (boundary ? 700 : 500) - idx;
  }

  // Subsequence fallback: every query char in order, anywhere.
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length ? 100 : 0;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Controlled by the shell rather than owning its own Ctrl+K listener, so the
 * shell can keep the shortcut while mounting this component — and downloading
 * its chunk — only once it is actually opened.
 */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  /**
   * Lightweight episode index, built once when the palette opens.
   *
   * Every debounced keystroke used to call `db.episodes.toArray()`, which
   * deserialises all ~1,300 rows *including* each aiSummary — hundreds of
   * kilobytes of text, rebuilt from IndexedDB on every character typed, just
   * to read four short fields off each row. Now it is read once per open and
   * reduced to the fields actually searched.
   *
   * Only the id is retained for the action; the full row is fetched on
   * activation, so the index stays small however large the catalog grows.
   */
  const indexRef = useRef<{ id: number; hay: string; label: string; sub: string }[]>([]);
  const [indexReady, setIndexReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    db.episodes
      .toArray()
      .then((eps) => {
        if (cancelled) return;
        indexRef.current = eps
          .filter((e) => e.id != null)
          .map((e) => ({
            id: e.id!,
            hay: [e.title, e.guestName, e.airDate, e.topic]
              .filter(Boolean)
              .join(" ")
              .toLowerCase(),
            label: e.title || e.fileName,
            sub: [e.guestName, e.airDate].filter(Boolean).join(" — "),
          }));
        setIndexReady(true);
      })
      .catch(() => {
        if (!cancelled) setIndexReady(true); // degrade to routes + actions
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Focus input + lock scroll when opened
  useEffect(() => {
    if (!open) return;
    lockScroll();
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => unlockScroll();
  }, [open]);

  const close = useCallback(() => {
    setQuery("");
    setResults([]);
    setActiveIndex(0);
    onClose();
  }, [onClose]);

  // Build actions list (stable refs via router)
  const actions: Result[] = useMemo(() => [
    {
      id: "act-shuffle",
      group: "Actions" as const,
      label: "Shuffle All Episodes",
      action: () => { window.dispatchEvent(new CustomEvent("hd:shuffle", { detail: "all" })); },
    },
    {
      id: "act-shuffle-coast",
      group: "Actions" as const,
      label: "Shuffle Coast to Coast",
      action: () => { window.dispatchEvent(new CustomEvent("hd:shuffle", { detail: "coast" })); },
    },
    {
      id: "act-shuffle-dreamland",
      group: "Actions" as const,
      label: "Shuffle Dreamland",
      action: () => { window.dispatchEvent(new CustomEvent("hd:shuffle", { detail: "dreamland" })); },
    },
    {
      id: "act-clear-queue",
      group: "Actions" as const,
      label: "Clear Queue",
      action: () => { usePlayerStore.getState().clearQueue(); toast.info("Queue cleared"); },
    },
    {
      id: "act-stop",
      group: "Actions" as const,
      label: "Stop Playback",
      action: () => { usePlayerStore.getState().stop(); },
    },
  ], []);

  // Search with debounce
  useEffect(() => {
    if (!open) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      // Show default actions + routes
      setResults([...ROUTES.slice(0, 3), ...actions.slice(0, 3)]);
      setActiveIndex(0);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const q = query.trim();
      const matched: Result[] = [];

      // Score the whole index, then take the best five — the previous version
      // stopped at the first five matches in table order, so relevance played
      // no part at all.
      const scored: { score: number; id: number; label: string; sub: string }[] = [];
      for (const entry of indexRef.current) {
        const score = scoreMatch(entry.hay, q);
        if (score > 0) scored.push({ score, ...entry });
      }
      scored.sort((a, b) => b.score - a.score);

      for (const hit of scored.slice(0, 5)) {
        matched.push({
          id: `ep-${hit.id}`,
          group: "Episodes",
          label: hit.label,
          subtitle: hit.sub,
          action: () => {
            // The index holds ids only; fetch the row the player needs.
            db.episodes
              .get(hit.id)
              .then((ep) => {
                if (ep) {
                  window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: ep }));
                }
              })
              .catch(() => {});
          },
        });
      }

      // Filter routes
      for (const r of ROUTES) {
        if (fuzzyMatch(r.label, q)) {
          matched.push({ ...r, action: () => router.push(ROUTE_PATHS[r.id]) });
        }
      }

      // Filter actions
      for (const a of actions) {
        if (fuzzyMatch(a.label, q)) {
          matched.push(a);
        }
      }

      setResults(matched.slice(0, 8));
      setActiveIndex(0);
    }, 150);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // indexReady is a dependency so a query typed while the index is still
    // loading re-runs once it lands, instead of showing no episodes.
  }, [query, open, router, actions, indexReady]);

  // Wire route actions with router
  const executeResult = useCallback((result: Result) => {
    if (result.group === "Go to" && ROUTE_PATHS[result.id]) {
      router.push(ROUTE_PATHS[result.id]);
    } else {
      result.action();
    }
    close();
  }, [router, close]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (results[activeIndex]) executeResult(results[activeIndex]);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
    }
  }, [results, activeIndex, executeResult, close]);

  if (!open) return null;

  // Group results
  const groups = new Map<string, Result[]>();
  for (const r of results) {
    if (!groups.has(r.group)) groups.set(r.group, []);
    groups.get(r.group)!.push(r);
  }

  let flatIndex = 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={close}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-midnight/60 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="relative w-full max-w-[480px] mx-4 w98-raised-dark bg-raised-surface shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="p-2 border-b border-bevel-dark/20">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search episodes, pages, actions..."
            inputMode="search"
            enterKeyHint="go"
            aria-label="Search episodes, pages, and actions"
            className="w-full w98-inset-dark bg-inset-well text-desktop-gray text-hd-16 md:text-hd-12 px-3 py-2 md:py-1.5 outline-none placeholder:text-bevel-dark w98-font"
          />
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-auto overscroll-contain py-1">
          {results.length === 0 && query.trim() && (
            <div className="px-3 py-4 text-center text-hd-10 text-bevel-dark/85">
              No results found
            </div>
          )}
          {Array.from(groups.entries()).map(([groupName, items]) => (
            <div key={groupName}>
              <div className="px-3 py-1 text-hd-8 uppercase tracking-wider text-bevel-dark/85">
                {groupName}
              </div>
              {items.map((item) => {
                const idx = flatIndex++;
                return (
                  <button
                    key={item.id}
                    onClick={() => executeResult(item)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 md:py-1.5 min-h-touch md:min-h-0 flex flex-col justify-center cursor-pointer transition-colors-fast",
                      idx === activeIndex
                        ? "bg-title-bar-blue/30 text-desktop-gray"
                        : "text-desktop-gray/85 hover:bg-title-bar-blue/15",
                    )}
                  >
                    <span className="text-hd-12 md:text-hd-11 truncate">{item.label}</span>
                    {item.subtitle && (
                      <span className="text-hd-9 text-bevel-dark/85 truncate">{item.subtitle}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-3 py-1.5 border-t border-bevel-dark/15 text-hd-8 text-bevel-dark/85 flex items-center gap-3">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
