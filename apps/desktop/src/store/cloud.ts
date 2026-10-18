import { create } from "zustand";
import { ask } from "@tauri-apps/plugin-dialog";
import { errorMessage, ipc, type CloudDocument, type CloudOverview } from "../lib/ipc";
import { useApp } from "./app";
import { useAccount } from "./account";
import { startLive } from "../editor/live";

interface ShareTarget {
  path: string;
  name: string;
}

interface CloudState {
  overview: CloudOverview | null;
  error: string | null;
  /** The file whose share dialog is open. */
  dialog: ShareTarget | null;

  refresh: () => Promise<void>;
  refreshSoon: () => void;
  openShareDialog: (target: ShareTarget) => void;
  closeShareDialog: () => void;
  openShared: (doc: CloudDocument) => Promise<void>;
  leave: (doc: CloudDocument) => Promise<void>;
  stopSharing: (documentId: string, name: string) => Promise<boolean>;
}

let timer = 0;

export const useCloud = create<CloudState>((set, get) => ({
  overview: null,
  error: null,
  dialog: null,

  refresh: async () => {
    if (!useAccount.getState().account) return;
    try {
      set({ overview: await ipc.cloudOverview(), error: null });
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  refreshSoon: () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void get().refresh(), 300);
  },

  openShareDialog: (target) => {
    if (!useAccount.getState().account) {
      useApp.getState().toast("Sign in to share files", { label: "Sign in", run: () => void useAccount.getState().signIn() });
      return;
    }
    set({ dialog: target });
  },

  closeShareDialog: () => set({ dialog: null }),

  openShared: async (doc) => {
    try {
      const path = await ipc.openShared(doc.id);
      await useApp.getState().openPaths([path]);
    } catch (e) {
      useApp.getState().toast(`Couldn't open “${doc.title}”: ${errorMessage(e)}`);
    }
    void get().refresh();
  },

  leave: async (doc) => {
    const ok = await ask(`You'll lose access to “${doc.title}” and its copy on this Mac will be removed.`, {
      title: "Remove yourself from this file?",
      kind: "warning",
      okLabel: "Remove",
    });
    if (!ok) return;
    const app = useApp.getState();
    const link = get().overview?.links.find((l) => l.documentId === doc.id);
    const tab = link && app.tabs.find((t) => t.path === link.path);
    if (tab) await app.closeTab(tab.id);
    await ipc.leaveShared(doc.id).catch((e) => app.toast(errorMessage(e)));
    void get().refresh();
  },

  stopSharing: async (documentId, name) => {
    const ok = await ask(`Everyone you shared “${name}” with loses access, and the cloud copy is deleted. Your file on this Mac stays as it is.`, {
      title: "Stop sharing?",
      kind: "warning",
      okLabel: "Stop sharing",
    });
    if (!ok) return false;
    const app = useApp.getState();
    try {
      await ipc.stopSharing(documentId);
      const link = get().overview?.links.find((l) => l.documentId === documentId);
      const tab = link && app.tabs.find((t) => t.path === link.path);
      if (tab) {
        const { stopLive } = await import("../editor/live");
        await stopLive(tab.id);
        useApp.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, share: undefined } : t)) }));
      }
      app.toast(`Stopped sharing “${name}”`);
    } catch (e) {
      app.toast(`Couldn't stop sharing: ${errorMessage(e)}`);
      return false;
    }
    await get().refresh();
    return true;
  },
}));

/** After a file is shared from this Mac, connect any open tab of it live. */
export async function afterShared(path: string) {
  await useCloud.getState().refresh();
  const tab = useApp.getState().tabs.find((t) => t.path === path);
  if (tab) void startLive(tab.id);
}
