import { create } from "zustand";
import { errorMessage, ipc, type AppNotification, type CommentsReply, type Thread } from "../lib/ipc";
import { activeTab, useApp, type ElementInfo } from "./app";
import { useCloud } from "./cloud";
import { getSession, type CommentAnchor } from "../editor/session";
import { postToFrame } from "../editor/frames";

interface DocComments {
  threads: Thread[];
  people: { email: string; name: string }[];
  canComment: boolean;
}

interface Draft {
  anchor: CommentAnchor;
}

interface CommentsState {
  byTab: Record<string, DocComments>;
  panelOpen: boolean;
  showResolved: boolean;
  activeThread: Record<string, string | null>;
  draft: Record<string, Draft | null>;
  /** Tabs where clicking the page picks an element to comment on. */
  picking: Record<string, boolean>;
  notifications: AppNotification[];
  unread: number;

  load: (tabId: string) => Promise<void>;
  togglePanel: (open?: boolean) => void;
  setShowResolved: (v: boolean) => void;
  startPick: (tabId: string) => void;
  stopPick: (tabId: string) => void;
  draftFromSelection: (tabId: string, info: ElementInfo) => void;
  cancelDraft: (tabId: string) => void;
  focus: (tabId: string, threadId: string | null) => void;
  post: (tabId: string, body: string, mentions: string[]) => Promise<boolean>;
  reply: (tabId: string, threadId: string, body: string, mentions: string[]) => Promise<boolean>;
  edit: (tabId: string, commentId: string, body: string) => Promise<void>;
  resolve: (tabId: string, threadId: string, resolved: boolean) => Promise<void>;
  remove: (tabId: string, commentId: string) => Promise<void>;
  loadNotifications: () => Promise<void>;
  markAllRead: () => Promise<void>;
  openNotification: (n: AppNotification) => Promise<void>;
}

const toast = (m: string) => useApp.getState().toast(m);
const docId = (tabId: string) => useApp.getState().tabs.find((t) => t.id === tabId)?.share?.documentId;
const path = (tabId: string, rest = "") => `/api/documents/${docId(tabId)}/comments${rest}`;

/** Draws numbered pins on commented elements in the preview. */
export function syncPins(tabId: string) {
  const s = useComments.getState();
  const session = getSession(tabId);
  const threads = s.byTab[tabId]?.threads ?? [];
  const pins: { id: string; qid: number; n: number; resolved: boolean; active: boolean }[] = [];
  threads.forEach((t, i) => {
    if (!t.anchor || (t.resolved && !s.showResolved)) return;
    const qid = session?.qidForAnchor(t.anchor);
    if (qid == null) return;
    pins.push({ id: t.id, qid, n: i + 1, resolved: t.resolved, active: s.activeThread[tabId] === t.id });
  });
  postToFrame(tabId, { type: "pins", pins });
}

/** Bridge mode for a tab: comment picking wins over the tab's own mode. */
export function frameMode(tabId: string): string {
  if (useComments.getState().picking[tabId]) return "comment";
  return useApp.getState().tabs.find((t) => t.id === tabId)?.mode ?? "view";
}

export const useComments = create<CommentsState>((set, get) => ({
  byTab: {},
  panelOpen: false,
  showResolved: false,
  activeThread: {},
  draft: {},
  picking: {},
  notifications: [],
  unread: 0,

  load: async (tabId) => {
    if (!docId(tabId)) return;
    try {
      const r = await ipc.cloudApi<CommentsReply>("GET", path(tabId));
      set((s) => ({ byTab: { ...s.byTab, [tabId]: r } }));
      syncPins(tabId);
    } catch (e) {
      console.warn("comments", errorMessage(e));
    }
  },

  togglePanel: (open) => {
    const next = open ?? !get().panelOpen;
    set({ panelOpen: next });
    if (next && useApp.getState().historyOpen) useApp.setState({ historyOpen: false });
    const tab = activeTab(useApp.getState());
    if (next && tab) void get().load(tab.id);
  },

  setShowResolved: (showResolved) => {
    set({ showResolved });
    for (const t of useApp.getState().tabs) syncPins(t.id);
  },

  startPick: (tabId) => {
    const data = get().byTab[tabId];
    if (data && !data.canComment) {
      toast("You can view this file but not comment on it.");
      return;
    }
    get().togglePanel(true);
    set((s) => ({ picking: { ...s.picking, [tabId]: true }, draft: { ...s.draft, [tabId]: null } }));
    postToFrame(tabId, { type: "mode", mode: "comment" });
  },

  stopPick: (tabId) => {
    set((s) => ({ picking: { ...s.picking, [tabId]: false } }));
    postToFrame(tabId, { type: "mode", mode: frameMode(tabId) });
  },

  draftFromSelection: (tabId, info) => {
    const session = getSession(tabId);
    const anchor = info.qid == null ? null : session?.anchorFor(info.qid);
    if (!anchor) {
      toast(info.qid == null ? "That part of the page is created by a script. Pick another element." : "Couldn't pin a comment there.");
      return;
    }
    get().stopPick(tabId);
    if (!get().panelOpen) get().togglePanel(true);
    set((s) => ({ draft: { ...s.draft, [tabId]: { anchor } }, activeThread: { ...s.activeThread, [tabId]: null } }));
  },

  cancelDraft: (tabId) => {
    get().stopPick(tabId);
    set((s) => ({ draft: { ...s.draft, [tabId]: null } }));
  },

  focus: (tabId, threadId) => {
    set((s) => ({ activeThread: { ...s.activeThread, [tabId]: threadId } }));
    syncPins(tabId);
    const t = get().byTab[tabId]?.threads.find((x) => x.id === threadId);
    const qid = t?.anchor ? getSession(tabId)?.qidForAnchor(t.anchor) : null;
    if (qid != null) postToFrame(tabId, { type: "select", qid, scroll: true });
  },

  post: async (tabId, body, mentions) => {
    const draft = get().draft[tabId];
    if (!draft) return false;
    try {
      const r = await ipc.cloudApi<{ id: string; threads: Thread[] }>("POST", path(tabId), { body, anchor: draft.anchor, mentions });
      set((s) => ({
        byTab: { ...s.byTab, [tabId]: { ...s.byTab[tabId], threads: r.threads } },
        draft: { ...s.draft, [tabId]: null },
        activeThread: { ...s.activeThread, [tabId]: r.id },
      }));
      syncPins(tabId);
      return true;
    } catch (e) {
      toast(`Couldn't post: ${errorMessage(e)}`);
      return false;
    }
  },

  reply: async (tabId, threadId, body, mentions) => {
    try {
      const r = await ipc.cloudApi<{ threads: Thread[] }>("POST", path(tabId), { body, threadId, mentions });
      set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...s.byTab[tabId], threads: r.threads } } }));
      syncPins(tabId);
      return true;
    } catch (e) {
      toast(`Couldn't reply: ${errorMessage(e)}`);
      return false;
    }
  },

  edit: async (tabId, commentId, body) => {
    try {
      const r = await ipc.cloudApi<{ threads: Thread[] }>("PATCH", path(tabId, `/${commentId}`), { body });
      set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...s.byTab[tabId], threads: r.threads } } }));
    } catch (e) {
      toast(`Couldn't edit: ${errorMessage(e)}`);
    }
  },

  resolve: async (tabId, threadId, resolved) => {
    try {
      const r = await ipc.cloudApi<{ threads: Thread[] }>("PATCH", path(tabId, `/${threadId}`), { resolved });
      set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...s.byTab[tabId], threads: r.threads } } }));
      syncPins(tabId);
    } catch (e) {
      toast(`Couldn't update: ${errorMessage(e)}`);
    }
  },

  remove: async (tabId, commentId) => {
    try {
      const r = await ipc.cloudApi<{ threads: Thread[] }>("DELETE", path(tabId, `/${commentId}`));
      set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...s.byTab[tabId], threads: r.threads } } }));
      syncPins(tabId);
    } catch (e) {
      toast(`Couldn't delete: ${errorMessage(e)}`);
    }
  },

  loadNotifications: async () => {
    try {
      const r = await ipc.cloudApi<{ notifications: AppNotification[]; unread: number }>("GET", "/api/notifications");
      set({ notifications: r.notifications, unread: r.unread });
    } catch {
      // offline or signed out: keep what we have
    }
  },

  markAllRead: async () => {
    if (!get().unread) return;
    set({ unread: 0 });
    await ipc.cloudApi("POST", "/api/notifications/read", {}).catch(() => {});
    void get().loadNotifications();
  },

  /** Opens the file a notification is about, with its thread focused. */
  openNotification: async (n) => {
    const cloud = useCloud.getState();
    await cloud.refresh();
    const overview = useCloud.getState().overview;
    const link = overview?.links.find((l) => l.documentId === n.documentId);
    const doc = overview?.documents.find((d) => d.id === n.documentId);
    const app = useApp.getState();
    if (link && link.role === "owner") await app.openPaths([link.path]);
    else if (doc) await cloud.openShared(doc);
    else return toast("That file is no longer shared with you.");
    const tab = activeTab(useApp.getState());
    if (!tab) return;
    get().togglePanel(true);
    // The live connection may still be starting; focus once comments load.
    for (let i = 0; i < 20 && !get().byTab[tab.id]; i++) {
      await get().load(tab.id);
      if (!get().byTab[tab.id]) await new Promise((r) => setTimeout(r, 300));
    }
    get().focus(tab.id, n.threadId);
  },
}));
