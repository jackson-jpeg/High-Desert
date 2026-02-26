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
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Open/close with Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => {
          if (!prev) {
            setQuery("");
            setResults([]);
            setActiveIndex(0);
          }
          return !prev;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Focus input + lock scroll when opened
  useEffect(() => {
    if (!open) return;
    lockScroll();
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => unlockScroll();
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
  }, []);

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

      // Search episodes in Dexie
      try {
        const allEps = await db.episodes.toArray();
        const episodeResults: Result[] = [];
        for (const ep of allEps) {
          if (episodeResults.length >= 5) break;
          const searchable = [ep.title, ep.guestName, ep.airDate, ep.topic].filter(Boolean).join(" ");
          if (fuzzyMatch(searchable, q)) {
            episodeResults.push({
              id: `ep-${ep.id}`,
              group: "Episodes",
              label: ep.title || ep.fileName,
              subtitle: [ep.guestName, ep.airDate].filter(Boolean).join(" — "),
              action: () => {
                window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: ep }));
              },
            });
          }
        }
        matched.push(...episodeResults);
      } catch { /* ignore */ }

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
  }, [query, open, router, actions]);

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
            className="w-full w98-inset-dark bg-inset-well text-desktop-gray text-[16px] md:text-[12px] px-3 py-2 md:py-1.5 outline-none placeholder:text-bevel-dark w98-font"
          />
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-auto overscroll-contain py-1">
          {results.length === 0 && query.trim() && (
            <div className="px-3 py-4 text-center text-[10px] text-bevel-dark/60">
              No results found
            </div>
          )}
          {Array.from(groups.entries()).map(([groupName, items]) => (
            <div key={groupName}>
              <div className="px-3 py-1 text-[8px] uppercase tracking-wider text-bevel-dark/50">
                {groupName}
              </div>
              {items.map((item) => {
                const idx = flatIndex++;
                return (
                  <button
                    key={item.id}
                    onClick={() => executeResult(item)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 md:py-1.5 min-h-[44px] md:min-h-0 flex flex-col justify-center cursor-pointer transition-colors-fast",
                      idx === activeIndex
                        ? "bg-title-bar-blue/30 text-desktop-gray"
                        : "text-desktop-gray/80 hover:bg-title-bar-blue/15",
                    )}
                  >
                    <span className="text-[12px] md:text-[11px] truncate">{item.label}</span>
                    {item.subtitle && (
                      <span className="text-[9px] text-bevel-dark/60 truncate">{item.subtitle}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-3 py-1.5 border-t border-bevel-dark/15 text-[8px] text-bevel-dark/40 flex items-center gap-3">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
