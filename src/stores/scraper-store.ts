import { create } from "zustand";
import type { ScrapeProgress } from "@/lib/archive/scraper";

interface ScraperState extends ScrapeProgress {
  errorMessages: string[];
  start: () => void;
  updateProgress: (update: Partial<ScrapeProgress>) => void;
  setPhase: (phase: ScrapeProgress["phase"]) => void;
  addError: (message: string) => void;
  reset: () => void;
}

const INITIAL: ScrapeProgress = {
  fetched: 0,
  total: 0,
  cursor: null,
  phase: "idle",
  imported: 0,
  duplicates: 0,
  categorized: 0,
  errors: 0,
};

export const useScraperStore = create<ScraperState>((set) => ({
  ...INITIAL,
  errorMessages: [],

  start: () => set({ ...INITIAL, phase: "scraping", errorMessages: [] }),

  updateProgress: (update) => set((s) => ({ ...s, ...update })),

  setPhase: (phase) => set({ phase }),

  addError: (message) =>
    set((s) => ({
      errors: s.errors + 1,
      errorMessages: s.errorMessages.length < 100
        ? [...s.errorMessages, message]
        : s.errorMessages,
    })),

  reset: () => set({ ...INITIAL, errorMessages: [] }),
}));
