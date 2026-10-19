import { create } from "zustand";

interface ImportState {
  /** "onboarding" is the first-run version, with a welcome and a finish step. */
  mode: "dialog" | "onboarding" | null;
  show: () => void;
  showOnboarding: () => void;
  hide: () => void;
}

/** The Import HTML window (also the first-run onboarding). */
export const useImport = create<ImportState>((set) => ({
  mode: null,
  show: () => set({ mode: "dialog" }),
  showOnboarding: () => set({ mode: "onboarding" }),
  hide: () => set({ mode: null }),
}));
