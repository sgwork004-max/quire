import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ipc, isHtmlPath, HTML_EXTENSIONS, type DocumentInfo } from "./lib/ipc";
import { loadRecents, pushRecent, saveRecents, type Recent } from "./lib/recents";

export type Viewport = "fit" | "desktop" | "tablet" | "mobile";

export const VIEWPORT_WIDTHS: Record<Viewport, number | null> = {
  fit: null,
  desktop: 1440,
  tablet: 768,
  mobile: 390,
};

export interface Toast {
  id: number;
  message: string;
}

interface AppState {
  tabs: DocumentInfo[];
  activeId: string | null;
  /** Bumped to force an iframe to reload. */
  reloadKeys: Record<string, number>;
  recents: Recent[];
  sidebarOpen: boolean;
  viewport: Viewport;
  toasts: Toast[];

  init: () => Promise<void>;
  openPaths: (paths: string[]) => Promise<void>;
  openDialog: () => Promise<void>;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
  cycleTab: (step: 1 | -1) => void;
  reload: (id?: string) => void;
  reveal: () => void;
  openInBrowser: () => void;
  removeRecent: (path: string) => void;
  toggleSidebar: () => void;
  setViewport: (v: Viewport) => void;
  toast: (message: string) => void;
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  tabs: [],
  activeId: null,
  reloadKeys: {},
  recents: [],
  sidebarOpen: true,
  viewport: "fit",
  toasts: [],

  init: async () => {
    set({ recents: await loadRecents() });
  },

  openPaths: async (paths) => {
    const html = paths.filter(isHtmlPath);
    if (html.length < paths.length) {
      get().toast(html.length ? "Skipped files that aren't HTML" : "Quire opens .html files");
    }
    let recents = get().recents;
    let lastId: string | null = null;
    for (const path of html) {
      try {
        const doc = await ipc.openDocument(path);
        set((s) => ({
          tabs: s.tabs.some((t) => t.id === doc.id) ? s.tabs : [...s.tabs, doc],
        }));
        recents = pushRecent(recents, doc.path, doc.name);
        lastId = doc.id;
      } catch (err) {
        recents = recents.filter((r) => r.path !== path);
        get().toast(`Couldn't open ${path.split(/[\\/]/).pop()}: ${String(err)}`);
      }
    }
    set({ recents, ...(lastId ? { activeId: lastId } : {}) });
    void saveRecents(recents);
  },

  openDialog: async () => {
    const picked = await open({
      multiple: true,
      directory: false,
      filters: [{ name: "HTML", extensions: HTML_EXTENSIONS }],
    });
    if (picked) await get().openPaths(Array.isArray(picked) ? picked : [picked]);
  },

  closeTab: (id) => {
    const { tabs, activeId } = get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index === -1) return;
    const next = tabs.filter((t) => t.id !== id);
    const neighbour = next[Math.min(index, next.length - 1)];
    set({
      tabs: next,
      activeId: activeId === id ? (neighbour?.id ?? null) : activeId,
    });
    void ipc.closeDocument(id);
  },

  activate: (id) => set({ activeId: id }),

  cycleTab: (step) => {
    const { tabs, activeId } = get();
    if (tabs.length < 2) return;
    const i = tabs.findIndex((t) => t.id === activeId);
    set({ activeId: tabs[(i + step + tabs.length) % tabs.length].id });
  },

  reload: (id) => {
    const target = id ?? get().activeId;
    if (!target) return;
    set((s) => ({ reloadKeys: { ...s.reloadKeys, [target]: (s.reloadKeys[target] ?? 0) + 1 } }));
  },

  reveal: () => {
    const doc = activeDoc(get());
    if (doc) void revealItemInDir(doc.path);
  },

  openInBrowser: () => {
    const doc = activeDoc(get());
    if (doc) ipc.openInBrowser(doc.id).catch((e) => get().toast(String(e)));
  },

  removeRecent: (path) => {
    const recents = get().recents.filter((r) => r.path !== path);
    set({ recents });
    void saveRecents(recents);
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  setViewport: (viewport) => set({ viewport }),

  toast: (message) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
  },
}));

export function activeDoc(s: Pick<AppState, "tabs" | "activeId">): DocumentInfo | undefined {
  return s.tabs.find((t) => t.id === s.activeId);
}
