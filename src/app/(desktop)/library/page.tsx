"use client";

import { useState, useMemo, useCallback, useEffect, useRef, useDeferredValue } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRouter } from "next/navigation";
import { db } from "@/db";
import type { Episode } from "@/db/schema";
import { usePlayerStore } from "@/stores/player-store";
import { useContextMenuStore } from "@/stores/context-menu-store";
import { toast } from "@/stores/toast-store";
import { useAdminStore } from "@/stores/admin-store";
import { deleteEpisode, recategorizeEpisode, updateEpisode, toggleFavorite, toggleFlag } from "@/services/episodes/management";
import { SearchBar } from "@/components/library/SearchBar";
import { TimelineView } from "@/components/library/TimelineView";
import { EpisodeDetail } from "@/components/library/EpisodeDetail";
import { RecentlyPlayed } from "@/components/library/RecentlyPlayed";
import { addToPlaylist } from "@/components/library/PlaylistPanel";
import { OnThisDay } from "@/components/library/OnThisDay";
import { Dialog, Button } from "@/components/win98";
import { parseSearch, type ComparisonOp } from "@/lib/utils/search-parser";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";
import { GuestProfile } from "@/components/library/GuestProfile";
import { cn } from "@/lib/utils/cn";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useCommunityStats } from "@/hooks/useCommunityStats";

function matchComparison(actual: number, op: ComparisonOp["op"], target: number): boolean {
  switch (op) {
    case ">": return actual > target;
    case ">=": return actual >= target;
    case "<": return actual < target;
    case "<=": return actual <= target;
    case "=": return actual === target;
  }
}

type SortMode = "date" | "name" | "guest";
type ShowFilter = "all" | "coast" | "dreamland" | "special" | "unknown";

const SHOW_TABS: { key: ShowFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "coast", label: "Coast to Coast" },
  { key: "dreamland", label: "Dreamland" },
  { key: "special", label: "Specials" },
  { key: "unknown", label: "Uncategorized" },
];

// Mood filters are derived from actual episode data — see `moodFilters` memo below

export default function LibraryPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sortMode, setSortMode] = useState<SortMode>("date");
  const [showFilter, setShowFilter] = useState<ShowFilter>("all");
  const [guestFilter, setGuestFilter] = useState<string | null>(null);
  const [showFacets, setShowFacets] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [guestProfileName, setGuestProfileName] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const currentEpisodeId = usePlayerStore((s) => s.currentEpisode?.id);
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const isMobile = useIsMobile();
  const searchBarRef = useRef<HTMLInputElement>(null);

  // Listen for sort events from the menu bar
  useEffect(() => {
    const handler = (e: Event) => {
      const sort = (e as CustomEvent<string>).detail;
      if (sort === "date" || sort === "name" || sort === "guest") setSortMode(sort as SortMode);
    };
    window.addEventListener("hd:sort", handler);
    return () => window.removeEventListener("hd:sort", handler);
  }, []);

  // Listen for focus-search events
  useEffect(() => {
    const handler = () => {
      searchBarRef.current?.focus();
    };
    window.addEventListener("hd:focus-search", handler);
    return () => window.removeEventListener("hd:focus-search", handler);
  }, []);

  // Listen for tag/category click-to-filter events from detail panel
  useEffect(() => {
    const handleTag = (e: Event) => {
      const tag = (e as CustomEvent<string>).detail;
      setSearch(`tag:${tag}`);
      setSelectedEpisode(null);
    };
    const handleCategory = (e: Event) => {
      const cat = (e as CustomEvent<string>).detail;
      setCategoryFilter(cat);
      setSelectedEpisode(null);
    };
    const handleGuest = (e: Event) => {
      const name = (e as CustomEvent<string>).detail;
      setGuestProfileName(name);
      setSelectedEpisode(null);
    };
    const handleSeries = (e: Event) => {
      const series = (e as CustomEvent<string>).detail;
      setSeriesFilter(series);
      setSelectedEpisode(null);
    };
    window.addEventListener("hd:filter-tag", handleTag);
    window.addEventListener("hd:filter-category", handleCategory);
    window.addEventListener("hd:show-guest", handleGuest);
    window.addEventListener("hd:filter-series", handleSeries);
    return () => {
      window.removeEventListener("hd:filter-tag", handleTag);
      window.removeEventListener("hd:filter-category", handleCategory);
      window.removeEventListener("hd:show-guest", handleGuest);
      window.removeEventListener("hd:filter-series", handleSeries);
    };
  }, []);

  // Handle ?episode=ID deep link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const epId = params.get("episode");
    if (!epId) return;
    const id = parseInt(epId, 10);
    if (isNaN(id)) return;
    // Strip param from URL
    window.history.replaceState({}, "", window.location.pathname);
    // Load the episode
    db.episodes.get(id).then((ep) => {
      if (ep) setSelectedEpisode(ep);
    });
  }, []);

  const allEpisodes = useLiveQuery(
    () => db.episodes.orderBy("airDate").reverse().toArray(),
    [],
  );

  const recentlyPlayed = useLiveQuery(
    () => db.episodes.where("lastPlayedAt").above(0).sortBy("lastPlayedAt").then((eps) => eps.reverse().slice(0, 5)),
    [],
  );

  const allPlaylists = useLiveQuery(() => db.playlists.toArray(), []);

  // Bookmarked episode IDs for has:bookmark search operator
  const bookmarkedIds = useLiveQuery(
    async () => {
      try {
        const bms = await db.bookmarks.toArray();
        return new Set(bms.map((b) => b.episodeId));
      } catch {
        return new Set<number>();
      }
    },
    [],
  );

  // Show type counts for filter tabs
  const showCounts = useMemo(() => {
    if (!allEpisodes) return new Map<ShowFilter, number>();
    const counts = new Map<ShowFilter, number>();
    counts.set("all", allEpisodes.length);
    for (const ep of allEpisodes) {
      const type = (ep.showType ?? "unknown") as ShowFilter;
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return counts;
  }, [allEpisodes]);

  // Category counts for filter chips
  const categoryCounts = useMemo(() => {
    if (!allEpisodes) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const ep of allEpisodes) {
      if (ep.aiCategory) {
        counts.set(ep.aiCategory, (counts.get(ep.aiCategory) ?? 0) + 1);
      }
    }
    return counts;
  }, [allEpisodes]);

  // Dynamic mood filters — only shows categories that actually exist in the library
  const moodFilters = useMemo(() => {
    if (!allEpisodes) return [];
    const filters: { label: string; kind: "notable" | "favorite" | "category"; category?: string }[] = [];

    // Notable episodes
    const notableCount = allEpisodes.filter((ep) => !!ep.aiNotable).length;
    if (notableCount > 0) filters.push({ label: "Late Night Classics", kind: "notable" });

    // Favorites
    const favCount = allEpisodes.filter((ep) => !!ep.favoritedAt).length;
    if (favCount > 0) filters.push({ label: "Favorites", kind: "favorite" });

    // Top categories by episode count (only those with 3+ episodes)
    const sorted = Array.from(categoryCounts.entries())
      .filter(([cat, count]) => count >= 3 && cat !== "Other" && cat !== "Best Of & Replay")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    // Friendly labels for long category names
    const SHORT_LABELS: Record<string, string> = {
      "UFOs & Aliens": "UFOs",
      "Science & Space": "Space & Science",
      "Time Travel & Physics": "Time Travel",
      "Remote Viewing & Psychic": "Psychic",
      "Prophecy & Predictions": "Prophecy",
      "Health & Medicine": "Health",
      "Earth Changes": "Earth Changes",
    };

    for (const [cat] of sorted) {
      filters.push({ label: SHORT_LABELS[cat] ?? cat, kind: "category", category: cat });
    }

    return filters;
  }, [allEpisodes, categoryCounts]);

  // Series counts for facets
  const seriesCounts = useMemo(() => {
    if (!allEpisodes) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const ep of allEpisodes) {
      if (ep.aiSeries) {
        counts.set(ep.aiSeries, (counts.get(ep.aiSeries) ?? 0) + 1);
      }
    }
    return counts;
  }, [allEpisodes]);

  // Top guests for faceted browsing
  const topGuests = useMemo(() => {
    if (!allEpisodes) return [];
    const guestCounts = new Map<string, number>();
    for (const ep of allEpisodes) {
      if (ep.guestName) {
        guestCounts.set(ep.guestName, (guestCounts.get(ep.guestName) ?? 0) + 1);
      }
    }
    return Array.from(guestCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);
  }, [allEpisodes]);

  // Top topics for faceted browsing
  const topTopics = useMemo(() => {
    if (!allEpisodes) return [];
    const topicCounts = new Map<string, number>();
    for (const ep of allEpisodes) {
      if (ep.topic) {
        topicCounts.set(ep.topic, (topicCounts.get(ep.topic) ?? 0) + 1);
      }
    }
    return Array.from(topicCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
  }, [allEpisodes]);

  // Search suggestion data
  const searchGuests = useMemo(() => {
    if (!allEpisodes) return [];
    const set = new Set<string>();
    for (const ep of allEpisodes) { if (ep.guestName) set.add(ep.guestName); }
    return Array.from(set).sort();
  }, [allEpisodes]);

  const searchCategories = useMemo(() => {
    if (!allEpisodes) return [];
    const set = new Set<string>();
    for (const ep of allEpisodes) { if (ep.aiCategory) set.add(ep.aiCategory); }
    return Array.from(set).sort();
  }, [allEpisodes]);

  const searchSeries = useMemo(() => {
    if (!allEpisodes) return [];
    const set = new Set<string>();
    for (const ep of allEpisodes) { if (ep.aiSeries) set.add(ep.aiSeries); }
    return Array.from(set).sort();
  }, [allEpisodes]);

  const searchYears = useMemo(() => {
    if (!allEpisodes) return [];
    const set = new Set<string>();
    for (const ep of allEpisodes) {
      if (ep.airDate) { const y = ep.airDate.slice(0, 4); if (y.length === 4) set.add(y); }
    }
    return Array.from(set).sort().reverse();
  }, [allEpisodes]);

  const filtered = useMemo(() => {
    if (!allEpisodes) return [];

    let list = allEpisodes;

    // Show type filter
    if (showFilter !== "all") {
      list = list.filter((ep) => (ep.showType ?? "unknown") === showFilter);
    }

    // Favorites filter
    if (favoritesOnly) {
      list = list.filter((ep) => !!ep.favoritedAt);
    }

    // Guest filter
    if (guestFilter) {
      list = list.filter((ep) => ep.guestName === guestFilter);
    }

    // Category filter
    if (categoryFilter) {
      list = list.filter((ep) => ep.aiCategory === categoryFilter);
    }

    // Series filter
    if (seriesFilter) {
      list = list.filter((ep) => ep.aiSeries === seriesFilter);
    }

    // Search filter with operator support
    if (deferredSearch.trim()) {
      const parsed = parseSearch(deferredSearch);

      // Apply operators
      if (parsed.guest) {
        const g = parsed.guest;
        list = list.filter((ep) => ep.guestName?.toLowerCase().includes(g));
      }
      if (parsed.year) {
        const y = parsed.year;
        list = list.filter((ep) => ep.airDate?.startsWith(y));
      }
      if (parsed.tag) {
        const t = parsed.tag;
        list = list.filter((ep) => ep.aiTags?.some((tag) => tag.toLowerCase().includes(t)));
      }
      if (parsed.show) {
        const s = parsed.show;
        list = list.filter((ep) => ep.showType === s);
      }
      if (parsed.cat) {
        const c = parsed.cat;
        list = list.filter((ep) => ep.aiCategory?.toLowerCase().includes(c));
      }
      if (parsed.series) {
        const s = parsed.series;
        list = list.filter((ep) => ep.aiSeries?.toLowerCase().includes(s));
      }
      if (parsed.has && parsed.has.length > 0) {
        for (const h of parsed.has) {
          if (h === "favorite" || h === "fav") {
            list = list.filter((ep) => !!ep.favoritedAt);
          } else if (h === "bookmark") {
            list = list.filter((ep) => bookmarkedIds?.has(ep.id!));
          } else if (h === "summary") {
            list = list.filter((ep) => !!ep.aiSummary);
          } else if (h === "played") {
            list = list.filter((ep) => (ep.playCount ?? 0) > 0);
          } else if (h === "notable") {
            list = list.filter((ep) => !!ep.aiNotable);
          } else if (h === "rated") {
            list = list.filter((ep) => !!ep.rating);
          } else if (h === "series") {
            list = list.filter((ep) => !!ep.aiSeries);
          }
        }
      }

      // Duration filter (input in minutes, stored in seconds)
      if (parsed.duration) {
        const { op, value } = parsed.duration;
        const secs = value * 60;
        list = list.filter((ep) => {
          if (ep.duration == null) return false;
          return matchComparison(ep.duration, op, secs);
        });
      }

      // Rating filter
      if (parsed.rating) {
        const { op, value } = parsed.rating;
        list = list.filter((ep) => {
          if (!ep.rating) return false;
          return matchComparison(ep.rating, op, value);
        });
      }

      // Favorited filter
      if (parsed.favorited) {
        list = list.filter((ep) => !!ep.favoritedAt);
      }

      // Free-text search on remaining terms
      if (parsed.text) {
        const q = parsed.text.toLowerCase();
        list = list.filter(
          (ep) =>
            ep.fileName.toLowerCase().includes(q) ||
            ep.title?.toLowerCase().includes(q) ||
            ep.guestName?.toLowerCase().includes(q) ||
            ep.topic?.toLowerCase().includes(q) ||
            ep.airDate?.includes(q) ||
            ep.description?.toLowerCase().includes(q) ||
            ep.aiCategory?.toLowerCase().includes(q) ||
            ep.aiSeries?.toLowerCase().includes(q) ||
            ep.aiTags?.some((tag) => tag.toLowerCase().includes(q)),
        );
      }
    }

    // Sort
    if (seriesFilter) {
      // When filtering by series, sort by part number (fallback to airDate)
      list = [...list].sort((a, b) => {
        const partA = a.aiSeriesPart ?? 999;
        const partB = b.aiSeriesPart ?? 999;
        return partA - partB || (a.airDate ?? "").localeCompare(b.airDate ?? "");
      });
    } else if (sortMode === "name") {
      list = [...list].sort((a, b) => {
        const nameA = (a.title || a.fileName).toLowerCase();
        const nameB = (b.title || b.fileName).toLowerCase();
        return nameA.localeCompare(nameB);
      });
    } else if (sortMode === "guest") {
      list = [...list].sort((a, b) => {
        const gA = (a.guestName || "").toLowerCase();
        const gB = (b.guestName || "").toLowerCase();
        return gA.localeCompare(gB) || (a.airDate ?? "").localeCompare(b.airDate ?? "");
      });
    }
    // "date" is already the default order from Dexie (airDate desc)

    return list;
  }, [allEpisodes, deferredSearch, sortMode, showFilter, guestFilter, categoryFilter, seriesFilter, favoritesOnly, bookmarkedIds]);

  // Community play counts for visible episodes
  const archiveIds = useMemo(() => {
    return filtered
      .map((ep) => ep.archiveIdentifier)
      .filter((id): id is string => !!id);
  }, [filtered]);
  const communityCounts = useCommunityStats(archiveIds);

  // Scroll to currently playing episode
  useEffect(() => {
    const handler = () => {
      if (!currentEpisodeId || !filtered.length) return;
      const idx = filtered.findIndex((ep) => ep.id === currentEpisodeId);
      if (idx !== -1) {
        setSelectedEpisode(filtered[idx]);
        setFocusedIndex(idx);
        const container = document.querySelector('[role="listbox"]')?.parentElement;
        if (container) {
          const itemH = window.innerWidth < 768 ? 88 : 72;
        container.scrollTop = idx * itemH - container.clientHeight / 2 + itemH / 2;
        }
      }
    };
    window.addEventListener("hd:scroll-to-current", handler);
    return () => window.removeEventListener("hd:scroll-to-current", handler);
  }, [currentEpisodeId, filtered]);

  const handleEpisodeClick = useCallback((episode: Episode, e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (e.shiftKey && lastClickedId != null) {
          const allIds = filtered.map((ep) => ep.id!);
          const startIdx = allIds.indexOf(lastClickedId);
          const endIdx = allIds.indexOf(episode.id!);
          if (startIdx !== -1 && endIdx !== -1) {
            const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
            for (let i = lo; i <= hi; i++) {
              next.add(allIds[i]);
            }
          }
        } else {
          if (next.has(episode.id!)) {
            next.delete(episode.id!);
          } else {
            next.add(episode.id!);
          }
        }
        return next;
      });
    } else {
      setSelectedIds(new Set());
      setSelectedEpisode(episode);
    }
    setLastClickedId(episode.id!);
  }, [filtered, lastClickedId]);

  const handlePlay = useCallback((episode: Episode) => {
    window.dispatchEvent(
      new CustomEvent("hd:play-episode", { detail: episode }),
    );
  }, []);

  const handleDoubleClick = useCallback((episode: Episode) => {
    window.dispatchEvent(
      new CustomEvent("hd:play-episode", { detail: episode }),
    );
  }, []);

  const handleAction = useCallback((action: "scan" | "search") => {
    router.push(action === "scan" ? "/scanner" : "/search");
  }, [router]);

  const handleQueue = useCallback((episode: Episode) => {
    usePlayerStore.getState().enqueue(episode);
    toast.info("Added to queue");
  }, []);

  const handleToggleFavorite = useCallback(async (episode: Episode) => {
    const isFav = await toggleFavorite(episode.id!);
    toast.info(isFav ? "Added to favorites" : "Removed from favorites");
  }, []);

  const handleShuffle = useCallback((showType?: string) => {
    if (!allEpisodes || allEpisodes.length === 0) return;
    let pool = allEpisodes;
    if (showType && showType !== "all") {
      pool = allEpisodes.filter((ep) => ep.showType === showType);
    }
    if (pool.length === 0) {
      toast.info("No episodes to shuffle");
      return;
    }
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const batch = shuffled.slice(0, 20);
    const store = usePlayerStore.getState();
    store.enqueueMany(batch);
    if (batch[0]) {
      window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: batch[0] }));
    }
    const label = showType && showType !== "all"
      ? showType === "coast" ? "Coast to Coast" : showType === "dreamland" ? "Dreamland" : "Specials"
      : "All Shows";
    toast.info(`Shuffling ${batch.length} episodes from ${label}`);
  }, [allEpisodes]);

  // Listen for shuffle events from the menu bar
  useEffect(() => {
    const handler = (e: Event) => {
      const showType = (e as CustomEvent<string>).detail;
      handleShuffle(showType);
    };
    window.addEventListener("hd:shuffle", handler);
    return () => window.removeEventListener("hd:shuffle", handler);
  }, [handleShuffle]);

  const handleCloseDetail = useCallback(() => {
    setSelectedEpisode(null);
  }, []);

  const handleContextMenu = useCallback((episode: Episode, x: number, y: number) => {
    const isPlaying = episode.id === currentEpisodeId;
    const store = usePlayerStore.getState();
    const admin = useAdminStore.getState().isAdmin;

    const items = [
      {
        label: "Play",
        onClick: () => handlePlay(episode),
        disabled: isPlaying,
      },
      {
        label: "Play Next",
        onClick: () => {
          store.enqueueNext(episode);
          toast.info(`"${episode.title || episode.fileName}" plays next`);
        },
        disabled: isPlaying,
      },
      {
        label: "Add to Queue",
        onClick: () => {
          store.enqueue(episode);
          toast.info(`Added to queue`);
        },
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: episode.favoritedAt ? "Unfavorite" : "Favorite",
        onClick: () => handleToggleFavorite(episode),
      },
      {
        label: episode.flaggedAt ? "Remove Flag" : "Report Broken",
        onClick: async () => {
          const flagged = await toggleFlag(episode.id!);
          toast[flagged ? "info" : "success"](flagged ? "Episode flagged as broken" : "Flag removed");
        },
      },
      ...((allPlaylists && allPlaylists.length > 0)
        ? [
            { label: "", onClick: () => {}, separator: true },
            ...allPlaylists.map((pl) => ({
              label: `+ ${pl.name}`,
              onClick: async () => {
                await addToPlaylist(pl.id!, [episode.id!]);
                toast.info(`Added to "${pl.name}"`);
              },
            })),
          ]
        : []),
      ...(admin
        ? [
            { label: "", onClick: () => {}, separator: true },
            {
              label: "Re-categorize",
              onClick: () => recategorizeEpisode(episode.id!),
            },
            { label: "", onClick: () => {}, separator: true },
            {
              label: "Delete",
              onClick: async () => {
                if (selectedIds.size > 1 && selectedIds.has(episode.id!)) {
                  setDeleteOpen(true);
                } else {
                  await deleteEpisode(episode.id!);
                  if (selectedEpisode?.id === episode.id) setSelectedEpisode(null);
                }
              },
              danger: true,
            },
          ]
        : []),
    ];

    useContextMenuStore.getState().show(x, y, items);
  }, [currentEpisodeId, handlePlay, handleToggleFavorite, selectedIds, selectedEpisode, allPlaylists]);

  const handleBulkDelete = useCallback(async () => {
    setDeleting(true);
    const count = selectedIds.size;
    try {
      for (const id of selectedIds) {
        await deleteEpisode(id);
      }
      setSelectedIds(new Set());
      setSelectedEpisode(null);
      toast.success(`Deleted ${count} episode${count !== 1 ? "s" : ""}`);
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }, [selectedIds]);

  // Keyboard navigation for the library list
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.code === "ArrowUp" && e.shiftKey) {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.max(0, prev - 1);
          const ep = filtered[next];
          if (ep) setSelectedEpisode(ep);
          return next;
        });
      } else if (e.code === "ArrowDown" && e.shiftKey) {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.min(filtered.length - 1, prev + 1);
          const ep = filtered[next];
          if (ep) setSelectedEpisode(ep);
          return next;
        });
      } else if (e.code === "Enter" && selectedEpisode) {
        e.preventDefault();
        handlePlay(selectedEpisode);
      } else if ((e.code === "Delete" || e.code === "Backspace") && useAdminStore.getState().isAdmin) {
        if (selectedIds.size > 0) {
          e.preventDefault();
          setDeleteOpen(true);
        } else if (selectedEpisode) {
          e.preventDefault();
          deleteEpisode(selectedEpisode.id!).then(() => setSelectedEpisode(null));
        }
      } else if (e.code === "Escape") {
        setSelectedIds(new Set());
        setSelectedEpisode(null);
        setFocusedIndex(-1);
        setGuestFilter(null);
        setCategoryFilter(null);
        setSeriesFilter(null);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered, focusedIndex, selectedEpisode, selectedIds, handlePlay]);

  // Detail panel swipe-down-to-close
  const detailSwipe = useRef({ startY: 0, currentY: 0, swiping: false });
  const detailRef = useRef<HTMLDivElement>(null);

  const onDetailTouchStart = useCallback((e: React.TouchEvent) => {
    // Only activate from the top 48px (drag handle area)
    const rect = detailRef.current?.getBoundingClientRect();
    if (!rect) return;
    const touchY = e.touches[0].clientY;
    if (touchY - rect.top > 48) return;
    detailSwipe.current = { startY: touchY, currentY: touchY, swiping: true };
  }, []);

  const onDetailTouchMove = useCallback((e: React.TouchEvent) => {
    const s = detailSwipe.current;
    if (!s.swiping) return;
    s.currentY = e.touches[0].clientY;
    const dy = s.currentY - s.startY;
    if (dy > 0 && detailRef.current) {
      detailRef.current.style.transform = `translateY(${dy}px)`;
      detailRef.current.style.transition = "none";
    }
  }, []);

  const onDetailTouchEnd = useCallback(() => {
    const s = detailSwipe.current;
    if (!s.swiping) return;
    s.swiping = false;
    const dy = s.currentY - s.startY;
    if (detailRef.current) {
      detailRef.current.style.transform = "";
      detailRef.current.style.transition = "transform 0.2s ease-out";
    }
    if (dy > 80) {
      handleCloseDetail();
    }
  }, [handleCloseDetail]);

  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [swipeTip, setSwipeTip] = useState(false);

  // Sync discovery state from localStorage after hydration
  useEffect(() => {
    const saved = localStorage.getItem("hd-discovery-open");
    if (saved === "true") setDiscoveryOpen(true);
  }, []);

  // Show swipe gesture tip once on mobile
  useEffect(() => {
    if (!isMobile || !allEpisodes || allEpisodes.length === 0) return;
    if (localStorage.getItem("hd-swipe-tip-seen")) return;
    const timer = setTimeout(() => setSwipeTip(true), 1500);
    return () => clearTimeout(timer);
  }, [isMobile, allEpisodes]);

  const toggleDiscovery = useCallback(() => {
    setDiscoveryOpen((prev) => {
      const next = !prev;
      localStorage.setItem("hd-discovery-open", String(next));
      return next;
    });
  }, []);

  const hasActiveFilters = showFilter !== "all" || guestFilter !== null || categoryFilter !== null || seriesFilter !== null || favoritesOnly;

  return (
    <div className="flex flex-col h-full overflow-auto overscroll-contain">
      {/* Search + Show Type Pills — sticky on mobile so users can refine while scrolling */}
      <div className="flex flex-col gap-1.5 px-3 py-2 flex-shrink-0 md:flex-row md:items-center md:gap-2 sticky top-0 z-20 bg-midnight/95 backdrop-blur-sm md:static md:bg-transparent md:backdrop-blur-none">
        <SearchBar
          ref={searchBarRef}
          value={search}
          onChange={setSearch}
          resultCount={allEpisodes ? filtered.length : undefined}
          guests={searchGuests}
          categories={searchCategories}
          years={searchYears}
          series={searchSeries}
          className="flex-1"
        />
        {allEpisodes && allEpisodes.length > 0 && (
          <div className="flex items-center gap-1 md:gap-0.5 flex-shrink-0 overflow-x-auto -mx-3 px-3 md:mx-0 md:px-0">
            {SHOW_TABS.map((tab) => {
              const count = showCounts.get(tab.key) ?? 0;
              const isActive = showFilter === tab.key;
              if (count === 0 && tab.key !== "all") return null;
              return (
                <button
                  key={tab.key}
                  onClick={() => {
                    setShowFilter(tab.key);
                    setGuestFilter(null);
                    setSeriesFilter(null);
                  }}
                  className={cn(
                    "px-3 py-1.5 text-hd-13 md:px-2 md:py-0.5 md:text-hd-10 cursor-pointer transition-colors-fast whitespace-nowrap flex-shrink-0",
                    isActive
                      ? "bg-title-bar-blue/20 text-desktop-gray w98-inset-dark"
                      : "text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10 active:bg-title-bar-blue/20",
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Active filter indicator + multi-select bar — only when needed */}
      {(hasActiveFilters || selectedIds.size > 0) && (
        <div className="px-3 pb-1 flex-shrink-0 flex flex-col gap-1">
          {hasActiveFilters && (
            <div className="flex items-center gap-2 text-hd-13 md:text-hd-10">
              {guestFilter && (
                <span className="bg-static-green/15 text-static-green px-2 py-1 md:px-1.5 md:py-0.5 flex items-center gap-1">
                  Guest: {guestFilter}
                  <button onClick={() => setGuestFilter(null)} className="text-static-green/60 hover:text-static-green active:text-static-green cursor-pointer min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0 flex items-center justify-center">x</button>
                </span>
              )}
              {categoryFilter && (
                <span className="bg-desert-amber/15 text-desert-amber px-2 py-1 md:px-1.5 md:py-0.5 flex items-center gap-1">
                  {categoryFilter}
                  <button onClick={() => setCategoryFilter(null)} className="text-desert-amber/60 hover:text-desert-amber active:text-desert-amber cursor-pointer min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0 flex items-center justify-center">x</button>
                </span>
              )}
              {seriesFilter && (
                <span className="bg-title-bar-blue/15 text-title-bar-blue px-2 py-1 md:px-1.5 md:py-0.5 flex items-center gap-1">
                  {seriesFilter}
                  <button onClick={() => setSeriesFilter(null)} className="text-title-bar-blue/60 hover:text-title-bar-blue active:text-title-bar-blue cursor-pointer min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0 flex items-center justify-center">x</button>
                </span>
              )}
              <button
                onClick={() => { setShowFilter("all"); setGuestFilter(null); setCategoryFilter(null); setSeriesFilter(null); setFavoritesOnly(false); }}
                className="text-bevel-dark hover:text-desktop-gray active:text-desktop-gray cursor-pointer ml-auto min-h-[44px] md:min-h-0 flex items-center"
              >
                Clear filters
              </button>
            </div>
          )}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 text-hd-13 md:text-hd-10 bg-title-bar-blue/10 px-2 py-2 md:py-1 w98-inset-dark">
              <span className="text-desktop-gray font-bold">{selectedIds.size} selected</span>
              <button
                onClick={() => {
                  const store = usePlayerStore.getState();
                  const episodes = allEpisodes?.filter((ep) => selectedIds.has(ep.id!)) ?? [];
                  store.enqueueMany(episodes);
                  toast.info(`Added ${episodes.length} episodes to queue`);
                }}
                className="text-title-bar-blue hover:text-title-bar-blue/80 cursor-pointer transition-colors-fast"
              >
                Add to Queue
              </button>
              {isAdmin && (
                <button onClick={() => setDeleteOpen(true)} className="text-red-400/60 hover:text-red-400 cursor-pointer transition-colors-fast">Delete</button>
              )}
              <button onClick={() => setSelectedIds(new Set())} className="text-bevel-dark hover:text-desktop-gray cursor-pointer transition-colors-fast ml-auto">Deselect</button>
            </div>
          )}
        </div>
      )}

      {/* Mood quick filters — derived from actual episode data */}
      {(!search.trim() || search === "has:notable") && moodFilters.length > 0 && (
        <div className="flex items-center gap-1.5 md:gap-1 px-3 pb-1 flex-shrink-0 overflow-x-auto -mx-3 px-3 md:mx-0">
          {moodFilters.map((mood) => {
            const isActive =
              (mood.kind === "category" && categoryFilter === mood.category) ||
              (mood.kind === "notable" && search === "has:notable") ||
              (mood.kind === "favorite" && favoritesOnly);
            return (
              <button
                key={mood.label}
                onClick={() => {
                  if (isActive) {
                    setCategoryFilter(null);
                    setFavoritesOnly(false);
                    setSearch("");
                  } else if (mood.kind === "category") {
                    setCategoryFilter(mood.category!);
                    setFavoritesOnly(false);
                    setSearch("");
                  } else if (mood.kind === "notable") {
                    setSearch("has:notable");
                    setCategoryFilter(null);
                    setFavoritesOnly(false);
                  } else if (mood.kind === "favorite") {
                    setFavoritesOnly(true);
                    setCategoryFilter(null);
                    setSearch("");
                  }
                }}
                className={cn(
                  "px-3 py-1.5 md:px-2 md:py-0.5 text-hd-12 md:text-hd-10 whitespace-nowrap flex-shrink-0 cursor-pointer transition-colors-fast",
                  isActive
                    ? "bg-desert-amber/15 text-desert-amber w98-inset-dark"
                    : "text-bevel-dark/60 hover:text-desktop-gray hover:bg-title-bar-blue/10 active:bg-title-bar-blue/15",
                )}
              >
                {mood.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Swipe gesture tip — shown once on mobile */}
      {swipeTip && (
        <div className="mx-3 mb-1 px-3 py-2 bg-desert-amber/10 border border-desert-amber/20 rounded flex items-center justify-between gap-2 flex-shrink-0 md:hidden animate-fade-in">
          <span className="text-hd-12 text-desert-amber/80">
            Swipe cards: {"\u2190"} favorite {"\u00B7"} queue {"\u2192"}
          </span>
          <button
            onClick={() => { setSwipeTip(false); localStorage.setItem("hd-swipe-tip-seen", "1"); }}
            className="text-hd-12 text-bevel-dark/50 active:text-desktop-gray cursor-pointer min-w-[28px] min-h-[28px] flex items-center justify-center"
          >
            OK
          </button>
        </div>
      )}

      {/* Discovery section — collapsed by default, compact when open */}
      {!search.trim() && !hasActiveFilters && (
        <div className="px-3 flex-shrink-0">
          <button
            onClick={toggleDiscovery}
            className="text-hd-13 md:text-hd-10 text-bevel-dark uppercase tracking-wider px-2 py-2 md:px-1 md:py-0.5 cursor-pointer hover:text-desktop-gray active:text-desktop-gray transition-colors-fast"
          >
            {discoveryOpen ? "▾" : "▸"} Explore
          </button>

          {discoveryOpen && (
            <div className="flex flex-col md:flex-row gap-2 mt-1 mb-1 overflow-hidden max-h-[200px] md:max-h-[100px]">
              {recentlyPlayed && recentlyPlayed.length > 0 && (
                <WidgetErrorBoundary name="Recently Played">
                  <RecentlyPlayed episodes={recentlyPlayed.slice(0, 4)} onPlay={handlePlay} compact />
                </WidgetErrorBoundary>
              )}
              <WidgetErrorBoundary name="On This Day">
                <OnThisDay onPlay={handlePlay} compact className="md:w-[220px] md:flex-shrink-0" />
              </WidgetErrorBoundary>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-hidden flex">
        {/* Faceted browsing sidebar — desktop only */}
        {showFacets && allEpisodes && allEpisodes.length > 0 && (
          <div className="hidden md:flex w-[180px] flex-shrink-0 overflow-auto border-r border-bevel-dark/20 p-2 flex-col gap-3">
            {/* Top Guests */}
            {topGuests.length > 0 && (
              <div>
                <div className="text-hd-10 text-desert-amber uppercase tracking-wider mb-1.5 font-bold">
                  Guests
                </div>
                <div className="flex flex-col gap-0.5">
                  {topGuests.map(([guest, count]) => (
                    <button
                      key={guest}
                      onClick={() => setGuestFilter(guestFilter === guest ? null : guest)}
                      className={`
                        text-left px-1.5 py-0.5 text-hd-10 cursor-pointer transition-colors-fast truncate
                        ${guestFilter === guest
                          ? "bg-title-bar-blue/20 text-desktop-gray"
                          : "text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10"
                        }
                      `}
                    >
                      {guest}
                      <span className="ml-1 tabular-nums opacity-50">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Categories */}
            {categoryCounts.size > 0 && (
              <div>
                <div className="text-hd-10 text-desert-amber uppercase tracking-wider mb-1.5 font-bold">
                  Categories
                </div>
                <div className="flex flex-col gap-0.5">
                  {Array.from(categoryCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([cat, count]) => (
                      <button
                        key={cat}
                        onClick={() => {
                          setCategoryFilter(categoryFilter === cat ? null : cat);
                          setShowFacets(false);
                        }}
                        className={cn(
                          "text-left px-1.5 py-0.5 text-hd-10 cursor-pointer transition-colors-fast truncate",
                          categoryFilter === cat
                            ? "bg-desert-amber/15 text-desert-amber"
                            : "text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10",
                        )}
                      >
                        {cat}
                        <span className="ml-1 tabular-nums opacity-50">{count}</span>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {/* Series */}
            {seriesCounts.size > 0 && (
              <div>
                <div className="text-hd-10 text-desert-amber uppercase tracking-wider mb-1.5 font-bold">
                  Series
                </div>
                <div className="flex flex-col gap-0.5">
                  {Array.from(seriesCounts.entries())
                    .filter(([, count]) => count >= 2)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 20)
                    .map(([series, count]) => (
                      <button
                        key={series}
                        onClick={() => {
                          setSeriesFilter(seriesFilter === series ? null : series);
                          setShowFacets(false);
                        }}
                        className={cn(
                          "text-left px-1.5 py-0.5 text-hd-10 cursor-pointer transition-colors-fast truncate",
                          seriesFilter === series
                            ? "bg-title-bar-blue/20 text-title-bar-blue"
                            : "text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10",
                        )}
                      >
                        {series}
                        <span className="ml-1 tabular-nums opacity-50">{count} parts</span>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {/* Top Topics */}
            {topTopics.length > 0 && (
              <div>
                <div className="text-hd-10 text-desert-amber uppercase tracking-wider mb-1.5 font-bold">
                  Topics
                </div>
                <div className="flex flex-col gap-0.5">
                  {topTopics.map(([topic, count]) => (
                    <button
                      key={topic}
                      onClick={() => {
                        setSearch(topic);
                        setShowFacets(false);
                      }}
                      className="text-left px-1.5 py-0.5 text-hd-10 text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10 cursor-pointer transition-colors-fast truncate"
                    >
                      {topic}
                      <span className="ml-1 tabular-nums opacity-50">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Loading skeleton */}
        {allEpisodes === undefined && (
          <div className="flex-1 p-4 flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-[82px] rounded w98-inset-dark bg-inset-well animate-skeleton"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="p-3 flex flex-col gap-2">
                  <div className="h-[10px] bg-bevel-dark/10 rounded w-[80px]" />
                  <div className="h-[12px] bg-bevel-dark/10 rounded w-[200px]" />
                  <div className="h-[10px] bg-bevel-dark/10 rounded w-[120px]" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Episode list */}
        {allEpisodes !== undefined && (
        <div className="flex-1 overflow-hidden min-w-0">
          {/* Empty library state */}
          {allEpisodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-8">
              <div className="text-hd-24 text-desert-amber/30 select-none mb-3">📡</div>
              <div className="text-hd-13 text-desktop-gray mb-2">No episodes in the library yet.</div>
              <div className="text-hd-11 text-bevel-dark/60 leading-relaxed max-w-[260px]">
                The library seeds automatically on first visit. If this persists, try refreshing the page.
              </div>
            </div>
          ) : filtered.length === 0 && search.trim() ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-8">
              <div className="text-hd-13 text-desktop-gray mb-2">
                No episodes matching &ldquo;{search}&rdquo;
              </div>
              <div className="text-hd-11 text-bevel-dark mb-4">
                Try a different search term{isAdmin ? ", or search the archive" : ""}.
              </div>
              {isAdmin && (
                <button
                  onClick={() => router.push(`/search`)}
                  className="text-hd-11 text-title-bar-blue hover:text-title-bar-blue/80 cursor-pointer transition-colors-fast px-3 py-1.5 w98-raised-dark bg-raised-surface"
                >
                  Search Archive.org for &ldquo;{search}&rdquo;
                </button>
              )}
            </div>
          ) : (
            <TimelineView
              episodes={filtered}
              currentEpisodeId={currentEpisodeId}
              onEpisodeClick={handleEpisodeClick}
              onEpisodeDoubleClick={handleDoubleClick}
              onEpisodeContextMenu={handleContextMenu}
              onAction={isAdmin ? handleAction : undefined}
              onToggleFavorite={handleToggleFavorite}
              onQueue={handleQueue}
              selectedEpisodeId={selectedEpisode?.id}
              selectedIds={selectedIds}
              communityPlayCounts={communityCounts}
            />
          )}
        </div>
        )}

        {/* Guest Profile panel */}
        {guestProfileName && !selectedEpisode && (
          <>
            <div
              className="fixed inset-0 bg-black/50 z-40 md:hidden animate-glass-backdrop"
              onClick={() => setGuestProfileName(null)}
            />
            <div className={cn(
              "fixed bottom-0 inset-x-0 z-50 max-h-[80dvh] overflow-auto pb-[var(--safe-bottom)] animate-glass-sheet rounded-t-xl",
              "md:sticky md:top-0 md:w-[280px] md:flex-shrink-0 md:max-h-screen md:overflow-auto md:pb-0 md:z-auto md:border-l md:border-bevel-dark/20 md:animate-fade-in md:rounded-none",
            )}>
              <GuestProfile
                guestName={guestProfileName}
                onPlay={handlePlay}
                onClose={() => setGuestProfileName(null)}
              />
            </div>
          </>
        )}

        {/* Detail panel — mobile: slide-up overlay; desktop: 280px sidebar */}
        {selectedEpisode && (
          <>
            {/* Mobile backdrop */}
            <div
              className="fixed inset-0 bg-black/50 z-40 md:hidden animate-glass-backdrop"
              onClick={handleCloseDetail}
            />
            <div
              ref={detailRef}
              onTouchStart={onDetailTouchStart}
              onTouchMove={onDetailTouchMove}
              onTouchEnd={onDetailTouchEnd}
              className={cn(
              // Mobile: slide-up overlay from bottom
              "fixed bottom-0 inset-x-0 z-50 max-h-[80dvh] overflow-auto pb-[var(--safe-bottom)] animate-glass-sheet rounded-t-xl will-change-transform",
              // Desktop: sticky sidebar with fade-in — stays in view as you scroll
              "md:sticky md:top-0 md:w-[280px] md:flex-shrink-0 md:max-h-screen md:overflow-auto md:pb-0 md:z-auto md:border-l md:border-bevel-dark/20 md:animate-fade-in md:rounded-none",
            )}>
              <EpisodeDetail
                key={selectedEpisode.id}
                episode={selectedEpisode}
                isPlaying={selectedEpisode.id === currentEpisodeId}
                onPlay={handlePlay}
                onClose={handleCloseDetail}
                onToggleFavorite={handleToggleFavorite}
                communityPlays={communityCounts.get(selectedEpisode.archiveIdentifier ?? "")}
                {...(isAdmin
                  ? {
                      onDelete: async (ep: Episode) => {
                        await deleteEpisode(ep.id!);
                        setSelectedEpisode(null);
                      },
                      onRecategorize: (ep: Episode) => recategorizeEpisode(ep.id!),
                      onEdit: async (id: number, fields: Partial<Episode>) => {
                        await updateEpisode(id, fields);
                        const updated = await db.episodes.get(id);
                        if (updated) setSelectedEpisode(updated);
                      },
                    }
                  : {})}
              />
            </div>
          </>
        )}
      </div>

      {/* Floating "Now Playing" button — mobile only */}
      {isMobile && currentEpisodeId && !selectedEpisode && (
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("hd:scroll-to-current"))}
          className="fixed bottom-[120px] right-3 z-25 w-[40px] h-[40px] rounded-full bg-midnight/90 border border-desert-amber/30 flex items-center justify-center shadow-lg active:scale-95 transition-transform"
          aria-label="Scroll to now playing"
          title="Scroll to now playing"
        >
          <span className="w-[5px] h-[5px] rounded-full bg-red-500 animate-on-air" />
        </button>
      )}

      {/* Bulk delete confirmation */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete Episodes"
        width="320px"
      >
        <div className="p-4 flex flex-col gap-4">
          <div className="text-hd-12 text-desktop-gray">
            Delete {selectedIds.size > 0 ? selectedIds.size : 1} episode{selectedIds.size !== 1 ? "s" : ""}? This cannot be undone.
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="dark" onClick={handleBulkDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
