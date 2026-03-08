"use client";

import { forwardRef, useState, useEffect, useRef, useCallback } from "react";
import { TextField } from "@/components/win98";
import { cn } from "@/lib/utils/cn";

const RECENT_SEARCHES_KEY = "hd-recent-searches";
const MAX_RECENT = 5;

function getRecentSearches(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || "[]").slice(0, MAX_RECENT);
  } catch { return []; }
}

function addRecentSearch(q: string) {
  if (!q.trim()) return;
  const recent = getRecentSearches().filter((s) => s !== q);
  recent.unshift(q);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

interface Suggestion {
  type: "guest" | "category" | "year" | "series" | "recent";
  label: string;
  query: string;
}

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  resultCount?: number;
  guests?: string[];
  categories?: string[];
  years?: string[];
  series?: string[];
  className?: string;
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  function SearchBar({ value, onChange, resultCount, guests, categories, years, series, className }, ref) {
    const [showHelp, setShowHelp] = useState(false);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [activeIdx, setActiveIdx] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const suppressRef = useRef(false);

    // Build suggestions when value changes
    useEffect(() => {
      if (suppressRef.current) { suppressRef.current = false; return; }
      const q = value.trim().toLowerCase();
      if (!q) {
        const recent = getRecentSearches();
        // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from value change, not an external subscription
        setSuggestions(recent.map((s) => ({ type: "recent", label: s, query: s })));
        setActiveIdx(-1);
        return;
      }

      const results: Suggestion[] = [];

      if (guests) {
        for (const g of guests) {
          if (results.length >= 8) break;
          if (g.toLowerCase().includes(q)) {
            results.push({ type: "guest", label: g, query: `guest:${g}` });
            if (results.filter((r) => r.type === "guest").length >= 3) break;
          }
        }
      }

      if (categories) {
        for (const c of categories) {
          if (results.filter((r) => r.type === "category").length >= 2) break;
          if (c.toLowerCase().includes(q)) {
            results.push({ type: "category", label: c, query: `cat:${c}` });
          }
        }
      }

      if (years) {
        for (const y of years) {
          if (results.filter((r) => r.type === "year").length >= 2) break;
          if (y.includes(q)) {
            results.push({ type: "year", label: y, query: `year:${y}` });
          }
        }
      }

      if (series) {
        for (const s of series) {
          if (results.filter((r) => r.type === "series").length >= 2) break;
          if (s.toLowerCase().includes(q)) {
            results.push({ type: "series", label: s, query: `series:${s}` });
          }
        }
      }

      setSuggestions(results);
      setActiveIdx(-1);
    }, [value, guests, categories, years, series]);

    // Click outside to dismiss
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setShowSuggestions(false);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, []);

    const selectSuggestion = useCallback((s: Suggestion) => {
      suppressRef.current = true;
      onChange(s.query);
      addRecentSearch(s.query);
      setShowSuggestions(false);
      setActiveIdx(-1);
    }, [onChange]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (!showSuggestions || suggestions.length === 0) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIdx((i) => Math.max(i - 1, -1));
          break;
        case "Enter":
          if (activeIdx >= 0 && suggestions[activeIdx]) {
            e.preventDefault();
            selectSuggestion(suggestions[activeIdx]);
          } else if (value.trim()) {
            addRecentSearch(value.trim());
          }
          break;
        case "Escape":
          setShowSuggestions(false);
          break;
      }
    }, [showSuggestions, suggestions, activeIdx, selectSuggestion, value]);

    const typeLabels: Record<string, string> = { guest: "Guest", category: "Category", year: "Year", series: "Series", recent: "Recent" };

    return (
      <div className={cn("flex flex-col gap-1", className)} ref={containerRef}>
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <TextField
              ref={ref}
              value={value}
              onChange={(e) => {
                const val = e.target.value;
                if (val.toLowerCase() === "ilovedelaney") {
                  onChange("");
                  window.dispatchEvent(new CustomEvent("hd:admin-prompt"));
                  return;
                }
                onChange(val);
              }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={handleKeyDown}
              placeholder="Search episodes... (try guest: year: tag:)"
              inputMode="search"
              enterKeyHint="search"
              className="w-full"
              role="combobox"
              aria-expanded={showSuggestions && suggestions.length > 0}
              aria-controls="search-suggestions"
              aria-activedescendant={activeIdx >= 0 ? `search-suggestion-${activeIdx}` : undefined}
              aria-autocomplete="list"
            />
            {value && (
              <button
                onClick={() => onChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-hd-14 md:text-hd-10 text-bevel-dark/50 hover:text-desktop-gray active:text-desktop-gray cursor-pointer min-w-[44px] min-h-[44px] md:min-w-[24px] md:min-h-[24px] flex items-center justify-center"
                aria-label="Clear search"
              >
                {"\u2715"}
              </button>
            )}

            {/* Autocomplete dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div id="search-suggestions" role="listbox" className="absolute top-full left-0 right-0 z-40 mt-0.5 w98-raised-dark bg-raised-surface max-h-[200px] overflow-auto shadow-lg overscroll-contain">
                {suggestions.map((s, i) => (
                  <button
                    key={`${s.type}-${s.label}`}
                    id={`search-suggestion-${i}`}
                    role="option"
                    aria-selected={i === activeIdx}
                    onClick={() => selectSuggestion(s)}
                    className={cn(
                      "w-full text-left px-3 md:px-2 py-2.5 md:py-1 min-h-[44px] md:min-h-0 text-hd-14 md:text-hd-11 cursor-pointer flex items-center gap-2 transition-colors-fast",
                      i === activeIdx
                        ? "bg-title-bar-blue/30 text-desktop-gray"
                        : "text-desktop-gray/80 hover:bg-title-bar-blue/15 active:bg-title-bar-blue/20",
                    )}
                  >
                    <span className="text-hd-10 md:text-hd-10 text-bevel-dark/50 w-[48px] flex-shrink-0">{typeLabels[s.type]}</span>
                    <span className="truncate">{s.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {resultCount !== undefined && (
            <span className="text-hd-12 md:text-hd-11 text-bevel-dark whitespace-nowrap tabular-nums">
              {resultCount}
            </span>
          )}
          <button
            onClick={() => setShowHelp(!showHelp)}
            className={cn(
              "text-hd-13 md:text-hd-11 cursor-pointer transition-colors-fast flex-shrink-0 min-w-[32px] min-h-[32px] md:min-w-0 md:min-h-0 flex items-center justify-center",
              showHelp ? "text-desert-amber" : "text-bevel-dark/40 hover:text-bevel-dark active:text-bevel-dark",
            )}
            title="Search syntax help"
          >
            ?
          </button>
        </div>
        {showHelp && (
          <div className="text-hd-11 md:text-hd-10 text-bevel-dark/60 flex flex-wrap gap-x-3 gap-y-1 md:gap-y-0.5 px-1 py-1 md:py-0 w98-inset-dark bg-inset-well/50 md:bg-transparent md:border-0">
            <span><span className="text-desert-amber/70">guest:</span>name</span>
            <span><span className="text-desert-amber/70">year:</span>1997</span>
            <span><span className="text-desert-amber/70">tag:</span>ufo</span>
            <span><span className="text-desert-amber/70">show:</span>coast</span>
            <span><span className="text-desert-amber/70">cat:</span>paranormal</span>
            <span><span className="text-desert-amber/70">series:</span>name</span>
            <span><span className="text-desert-amber/70">has:</span>favorite</span>
            <span><span className="text-desert-amber/70">has:</span>notable</span>
            <span><span className="text-desert-amber/70">has:</span>bookmark</span>
            <span><span className="text-desert-amber/70">has:</span>played</span>
            <span><span className="text-desert-amber/70">duration:</span>&gt;60</span>
            <span><span className="text-desert-amber/70">rating:</span>&gt;=4</span>
            <span><span className="text-desert-amber/70">favorited:</span>true</span>
          </div>
        )}
      </div>
    );
  },
);
