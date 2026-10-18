import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { errorMessage, HTML_EXTENSIONS, ipc, isHtmlPath, type DocumentInfo, type ShareRole } from "../lib/ipc";
import { startLive, stopLive } from "../editor/live";
import { savePref } from "../lib/prefs";
import { closeSession, ensureSession, getSession } from "../editor/session";
import { postToFrame } from "../editor/frames";

export const HOME = "home";

export type Viewport = "fit" | "desktop" | "tablet" | "mobile";
export type Mode = "view" | "visual" | "code";
export type SaveStatus = "saved" | "saving" | "dirty" | "conflict" | "error";

export const VIEWPORT_WIDTHS: Record<Viewport, number | null> = {
  fit: null,
  desktop: 1440,
  tablet: 768,
  mobile: 390,
};

export interface Tab extends DocumentInfo {
  mode: Mode;
  /** Set when this file is shared (by you or with you). */
  share?: { documentId: string; role: ShareRole };
}

export interface Peer {
  clientId: number;
  name: string;
  color: string;
}

/** What the bridge reports about the element selected in Visual mode. */
export interface ElementInfo {
  qid: number | null;
  tag: string;
  id: string | null;
  classes: string[];
  crumbs: { tag: string; qid: number | null }[];
  text: boolean;
  attrs: Record<string, string>;
  computed: Record<string, string>;
  inline: Record<string, string>;
}

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

interface AppState {
  tabs: Tab[];
  /** `HOME` (the library) or a tab id. */
  activeId: string;
  reloadKeys: Record<string, number>;
  status: Record<string, SaveStatus>;
  selection: Record<string, ElementInfo | null>;
  sidebarOpen: boolean;
  viewport: Viewport;
  historyOpen: boolean;
  codeWidth: number;
  toasts: Toast[];
  /** People currently in each shared document, by tab id. */
  presence: Record<string, Peer[]>;

  openPaths: (paths: string[], mode?: Mode) => Promise<void>;
  openDialog: () => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  activate: (id: string) => void;
  cycleTab: (step: 1 | -1) => void;
  setMode: (id: string, mode: Mode) => Promise<void>;
  reload: (id?: string) => void;
  reveal: () => void;
  openInBrowser: () => void;
  toggleSidebar: () => void;
  toggleHistory: () => void;
  setViewport: (v: Viewport) => void;
  setCodeWidth: (w: number) => void;
  toast: (message: string, action?: Toast["action"]) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  tabs: [],
  activeId: HOME,
  reloadKeys: {},
  status: {},
  selection: {},
  sidebarOpen: true,
  viewport: "fit",
  historyOpen: false,
  codeWidth: 520,
  toasts: [],
  presence: {},

  openPaths: async (paths, mode = "view") => {
    const html = paths.filter(isHtmlPath);
    let lastId: string | null = null;
    for (const path of html) {
      try {
        const doc = await ipc.openDocument(path);
        set((s) => ({
          tabs: s.tabs.some((t) => t.id === doc.id) ? s.tabs : [...s.tabs, { ...doc, mode: "view" }],
        }));
        lastId = doc.id;
        void startLive(doc.id);
      } catch (err) {
        get().toast(`Couldn't open ${path.split(/[\\/]/).pop()}: ${errorMessage(err)}`);
      }
    }
    if (lastId) {
      set({ activeId: lastId });
      if (mode !== "view") await get().setMode(lastId, mode);
    }
  },

  openDialog: async () => {
    const picked = await open({
      multiple: true,
      directory: false,
      filters: [{ name: "HTML", extensions: HTML_EXTENSIONS }],
    });
    if (picked) await get().openPaths(Array.isArray(picked) ? picked : [picked]);
  },

  closeTab: async (id) => {
    await stopLive(id);
    await closeSession(id);
    const { tabs, activeId } = get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index === -1) return;
    const next = tabs.filter((t) => t.id !== id);
    const neighbour = next[Math.min(index, next.length - 1)];
    set((s) => {
      const { [id]: _s, ...status } = s.status;
      const { [id]: _e, ...selection } = s.selection;
      return {
        tabs: next,
        status,
        selection,
        activeId: activeId === id ? (neighbour?.id ?? HOME) : activeId,
      };
    });
    void ipc.closeDocument(id);
  },

  activate: (id) => set({ activeId: id }),

  cycleTab: (step) => {
    const ids = [HOME, ...get().tabs.map((t) => t.id)];
    const i = ids.indexOf(get().activeId);
    set({ activeId: ids[(i + step + ids.length) % ids.length] });
  },

  setMode: async (id, mode) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || tab.mode === mode) return;
    if (mode !== "view" && tab.share && !["owner", "editor"].includes(tab.share.role)) {
      get().toast(`You can ${tab.share.role === "commenter" ? "comment on" : "view"} this file. Ask its owner for edit access.`);
      return;
    }
    if (mode === "view") {
      const session = getSession(id);
      if (session) {
        await session.flush();
        await session.setLive(false);
      }
      set((s) => ({ selection: { ...s.selection, [id]: null } }));
    } else {
      try {
        const session = await ensureSession(tab);
        await session.setLive(true);
      } catch (err) {
        get().toast(`Can't edit ${tab.name}: ${errorMessage(err)}`);
        return;
      }
    }
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, mode } : t)) }));
    postToFrame(id, { type: "mode", mode });
  },

  reload: (id) => {
    const target = id ?? get().activeId;
    if (!target || target === HOME) return;
    set((s) => ({ reloadKeys: { ...s.reloadKeys, [target]: (s.reloadKeys[target] ?? 0) + 1 } }));
  },

  reveal: () => {
    const doc = activeTab(get());
    if (doc) void revealItemInDir(doc.path);
  },

  openInBrowser: () => {
    const doc = activeTab(get());
    if (doc) ipc.openInBrowser(doc.id).catch((e) => get().toast(errorMessage(e)));
  },

  toggleSidebar: () => {
    const sidebarOpen = !get().sidebarOpen;
    set({ sidebarOpen });
    savePref("sidebarOpen", sidebarOpen);
  },

  toggleHistory: () => set((s) => ({ historyOpen: !s.historyOpen })),

  setViewport: (viewport) => set({ viewport }),

  setCodeWidth: (codeWidth) => {
    set({ codeWidth });
    savePref("codeWidth", codeWidth);
  },

  toast: (message, action) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, message, action }] }));
    setTimeout(() => get().dismissToast(id), action ? 6000 : 4000);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function activeTab(s: Pick<AppState, "tabs" | "activeId">): Tab | undefined {
  return s.tabs.find((t) => t.id === s.activeId);
}
