/**
 * scanner-store.ts
 *
 * Zustand store that tracks the state and progress of a file scan session.
 * Used by the useFileScanner hook and the Scanner UI components.
 */

import { create } from "zustand";

export interface ScannerState {
  // Status
  status: "idle" | "scanning" | "completed" | "cancelled" | "error";

  // Progress counters
  totalFiles: number;
  processedFiles: number;
  currentFile: string;
  newEpisodes: number;
  duplicates: number;
  errors: number;
  errorMessages: string[];

  // Actions
  startScan: () => void;
  updateProgress: (update: Partial<ScannerState>) => void;
  addError: (message: string) => void;
  reset: () => void;
  setCompleted: () => void;
  setCancelled: () => void;
}

const initialState = {
  status: "idle" as const,
  totalFiles: 0,
  processedFiles: 0,
  currentFile: "",
  newEpisodes: 0,
  duplicates: 0,
  errors: 0,
  errorMessages: [],
};

export const useScannerStore = create<ScannerState>((set) => ({
  ...initialState,

  startScan: () =>
    set({
      ...initialState,
      status: "scanning",
    }),

  updateProgress: (update) =>
    set((state) => ({
      ...state,
      ...update,
    })),

  addError: (message: string) =>
    set((state) => ({
      errors: state.errors + 1,
      errorMessages: [...state.errorMessages, message].slice(-100), // Keep last 100
    })),

  reset: () => set(initialState),

  setCompleted: () =>
    set({ status: "completed", currentFile: "" }),

  setCancelled: () =>
    set({ status: "cancelled", currentFile: "" }),
}));
