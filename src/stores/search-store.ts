import { create } from "zustand";
import type { ArchiveSearchResult } from "@/lib/archive/types";

export interface SearchState {
  query: string;
  results: ArchiveSearchResult[];
  totalResults: number;
  page: number;
  loading: boolean;
  error: string | null;
  addingIds: Set<string>;
  addedIds: Set<string>;

  setQuery: (query: string) => void;
  setResults: (results: ArchiveSearchResult[], total: number, page: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  startAdding: (id: string) => void;
  finishAdding: (id: string) => void;
  markAdded: (ids: string[]) => void;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  results: [],
  totalResults: 0,
  page: 1,
  loading: false,
  error: null,
  addingIds: new Set(),
  addedIds: new Set(),

  setQuery: (query) => set({ query }),

  setResults: (results, totalResults, page) =>
    set({ results, totalResults, page, error: null }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error, loading: false }),

  startAdding: (id) =>
    set((s) => ({ addingIds: new Set(s.addingIds).add(id) })),

  finishAdding: (id) =>
    set((s) => {
      const addingIds = new Set(s.addingIds);
      addingIds.delete(id);
      const addedIds = new Set(s.addedIds).add(id);
      return { addingIds, addedIds };
    }),

  markAdded: (ids) =>
    set((s) => {
      const addedIds = new Set(s.addedIds);
      ids.forEach((id) => addedIds.add(id));
      return { addedIds };
    }),

  reset: () =>
    set({
      query: "",
      results: [],
      totalResults: 0,
      page: 1,
      loading: false,
      error: null,
      addingIds: new Set(),
      addedIds: new Set(),
    }),
}));
