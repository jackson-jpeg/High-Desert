"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { STATS_TABS, parseStatsTab, statsTabHref, type StatsTab } from "@/lib/stats/tabs";

/**
 * The tab in the URL, kept in step both ways (UI plan push 6, batch 1).
 *
 * The page is static, so the server always draws the default; the asked tab
 * is read after mount (as useLibraryView does: reading during render made a
 * hydration mismatch that stuck the boot screen, 19c434a). A change replaces
 * the URL rather than pushing it: Back leaves /stats, it does not walk tabs.
 */
export function useStatsTab(): [StatsTab, (tab: StatsTab) => void] {
  const [tab, setTabState] = useState<StatsTab>("station");
  useEffect(() => {
    const read = () => setTabState(parseStatsTab(window.location.search));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const setTab = useCallback((next: StatsTab) => {
    setTabState(next);
    const url = new URL(statsTabHref(next), window.location.href);
    // Any other parameter (?viewer, ?season=…) stays.
    const current = new URLSearchParams(window.location.search);
    current.delete("tab");
    for (const [k, v] of current) url.searchParams.set(k, v);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + window.location.hash);
  }, []);
  return [tab, setTab];
}

export function statsPanelId(tab: StatsTab): string {
  return `stats-panel-${tab}`;
}

export function statsTabId(tab: StatsTab): string {
  return `stats-tab-${tab}`;
}

/**
 * The tablist: the ARIA tabs pattern with automatic activation (Left/Right,
 * Home/End move and select; only the selected tab is in the Tab order).
 * Win98 draws a property sheet's tabs, Night a segmented switch
 * (src/styles/stats.css); a phone gets three equal 44 px tabs.
 */
export function StatsTabs({ tab, onSelect }: { tab: StatsTab; onSelect: (tab: StatsTab) => void }) {
  const refs = useRef(new Map<StatsTab, HTMLButtonElement>());
  const onKeyDown = (e: React.KeyboardEvent) => {
    const at = STATS_TABS.findIndex((t) => t.key === tab);
    let next: number;
    switch (e.key) {
      case "ArrowRight":
        next = (at + 1) % STATS_TABS.length;
        break;
      case "ArrowLeft":
        next = (at - 1 + STATS_TABS.length) % STATS_TABS.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = STATS_TABS.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const key = STATS_TABS[next].key;
    onSelect(key);
    refs.current.get(key)?.focus();
  };

  return (
    <div className="hd-stats-tabs" role="tablist" aria-label="Stats" onKeyDown={onKeyDown} data-testid="stats-tabs">
      {STATS_TABS.map(({ key, label }) => {
        const selected = key === tab;
        return (
          <button
            key={key}
            ref={(el) => {
              if (el) refs.current.set(key, el);
              else refs.current.delete(key);
            }}
            type="button"
            role="tab"
            id={statsTabId(key)}
            aria-selected={selected}
            aria-controls={statsPanelId(key)}
            tabIndex={selected ? 0 : -1}
            data-tab={key}
            onClick={() => onSelect(key)}
            className={cn("hd-stats-tab", selected && "hd-stats-tab-on")}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
