import { create } from "zustand";
import type { ScrapeProgress } from "@/lib/archive/scraper";

interface ScraperState extends ScrapeProgress {
  errorMessages: string[];
  startedAt: number | null;
  phaseTimes: Record<string, number>; // phase -> start timestamp
  currentItem: string | null; // identifier being processed
  start: () => void;
  updateProgress: (update: Partial<ScrapeProgress>) => void;
  setPhase: (phase: ScrapeProgress["phase"]) => void;
  setCurrentItem: (item: string | null) => void;
  addError: (message: string) => void;
  reset: () => void;
}

const INITIAL: ScrapeProgress = {
  fetched: 0,
  total: 0,
  page: 0,
  phase: "idle",
  imported: 0,
  duplicates: 0,
  categorized: 0,
  errors: 0,
};

export const useScraperStore = create<ScraperState>((set) => ({
  ...INITIAL,
  errorMessages: [],
  startedAt: null,
  phaseTimes: {},
  currentItem: null,

  start: () =>
    set({
      ...INITIAL,
      phase: "scraping",
      errorMessages: [],
      startedAt: Date.now(),
      phaseTimes: { scraping: Date.now() },
      currentItem: null,
    }),

  updateProgress: (update) => set((s) => ({ ...s, ...update })),

  setPhase: (phase) =>
    set((s) => ({
      phase,
      phaseTimes: { ...s.phaseTimes, [phase]: Date.now() },
      currentItem: null,
    })),

  setCurrentItem: (item) => set({ currentItem: item }),

  addError: (message) =>
    set((s) => ({
      errors: s.errors + 1,
      errorMessages:
        s.errorMessages.length < 200
          ? [...s.errorMessages, message]
          : s.errorMessages,
    })),

  reset: () =>
    set({
      ...INITIAL,
      errorMessages: [],
      startedAt: null,
      phaseTimes: {},
      currentItem: null,
    }),
}));
