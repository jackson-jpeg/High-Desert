import { create } from "zustand";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  separator?: boolean;
  danger?: boolean;
}

interface ContextMenuState {
  open: boolean;
  position: { x: number; y: number };
  items: ContextMenuItem[];
  show: (x: number, y: number, items: ContextMenuItem[]) => void;
  hide: () => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  open: false,
  position: { x: 0, y: 0 },
  items: [],

  show: (x, y, items) => set({ open: true, position: { x, y }, items }),
  hide: () => set({ open: false }),
}));
