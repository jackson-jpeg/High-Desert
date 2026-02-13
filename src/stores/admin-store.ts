import { create } from "zustand";

const STORAGE_KEY = "hd-admin";

function readAdmin(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

interface AdminState {
  isAdmin: boolean;
  setAdmin: (value: boolean) => void;
}

export const useAdminStore = create<AdminState>((set) => ({
  isAdmin: typeof window !== "undefined" ? readAdmin() : false,
  setAdmin: (value) => {
    try {
      if (value) {
        localStorage.setItem(STORAGE_KEY, "1");
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
    set({ isAdmin: value });
  },
}));
