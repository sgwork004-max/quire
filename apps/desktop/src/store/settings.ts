import { create } from "zustand";

interface SettingsState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

/** The Settings window (⌘,). */
export const useSettings = create<SettingsState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
