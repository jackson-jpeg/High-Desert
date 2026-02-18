import { create } from "zustand";

const STORAGE_KEY = "hd-admin";
const ADMIN_HASH = "7740185e7b5e8ec29b31a918cd2b8d0d491c864072ed360e48999355974280d4";

function readAdmin(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface AdminState {
  isAdmin: boolean;
  /** Authenticate with password. Returns true on success. */
  login: (password: string) => Promise<boolean>;
  /** Log out of admin mode. */
  logout: () => void;
}

export const useAdminStore = create<AdminState>((set) => ({
  isAdmin: readAdmin(),

  login: async (password: string) => {
    const hash = await hashPassword(password);
    if (hash === ADMIN_HASH) {
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
      set({ isAdmin: true });
      return true;
    }
    return false;
  },

  logout: () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    set({ isAdmin: false });
  },
}));
