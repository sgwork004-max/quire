import { create } from "zustand";

interface ImportState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

/** The Import HTML dialog. */
export const useImport = create<ImportState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
