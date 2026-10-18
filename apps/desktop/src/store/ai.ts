import { create } from "zustand";
import { errorMessage, ipc } from "../lib/ipc";
import { activeTab, useApp } from "./app";
import { ensureSession, getSession } from "../editor/session";
import { planChanges } from "../editor/aiEdits";
import { lineDiff, type DiffRow } from "../editor/diff";
import type { Change } from "../editor/sourcemap";

type Phase = "idle" | "asking" | "review" | "key";

interface Review {
  summary: string;
  changes: Change[];
  rows: DiffRow[];
  added: number;
  removed: number;
  /** The text the edits were planned against; applying requires it unchanged. */
  base: string;
}

interface AiState {
  open: boolean;
  tabId: string | null;
  phase: Phase;
  focus: { tag: string; snippet: string; source: string } | null;
  review: Review | null;
  error: string | null;
  lastPrompt: string;
  /** Text to start the prompt box with (e.g. from Live data → Wire up). */
  prefill: string;

  show: () => Promise<void>;
  close: () => void;
  ask: (prompt: string) => Promise<void>;
  accept: () => void;
  saveKey: (key: string) => Promise<boolean>;
  removeKey: () => Promise<void>;
}

export const useAi = create<AiState>((set, get) => ({
  open: false,
  tabId: null,
  phase: "idle",
  focus: null,
  review: null,
  error: null,
  lastPrompt: "",
  prefill: "",

  show: async () => {
    const app = useApp.getState();
    const tab = activeTab(app);
    if (!tab) return app.toast("Open a file to edit it with AI.");
    if (tab.share && !["owner", "editor"].includes(tab.share.role)) return app.toast("You can view this file but not edit it.");
    const qid = app.selection[tab.id]?.qid;
    const session = await ensureSession(tab);
    const focus = tab.mode === "visual" && qid != null ? session.focusFor(qid) : null;
    const hasKey = await ipc.aiKeyStatus();
    set({ open: true, tabId: tab.id, focus, review: null, error: null, phase: hasKey ? "idle" : "key" });
  },

  close: () => set({ open: false, review: null, error: null, phase: "idle" }),

  ask: async (prompt) => {
    const { tabId, focus } = get();
    const session = tabId ? getSession(tabId) : undefined;
    if (!session || !prompt.trim()) return;
    set({ phase: "asking", error: null, lastPrompt: prompt });
    const base = session.text;
    try {
      const plan = await ipc.aiEdit(base, prompt, focus);
      if (!get().open) return; // closed while waiting
      if (!plan.edits.length) {
        set({ phase: "idle", error: plan.summary || "Claude didn't suggest any changes." });
        return;
      }
      const { changes, result } = planChanges(base, plan.edits);
      const diff = lineDiff(base, result);
      set({ phase: "review", review: { summary: plan.summary, changes, base, ...diff } });
    } catch (e) {
      set({ phase: "idle", error: errorMessage(e) });
    }
  },

  accept: () => {
    const { tabId, review } = get();
    const session = tabId ? getSession(tabId) : undefined;
    if (!session || !review) return;
    if (session.text !== review.base) {
      set({ phase: "idle", review: null, error: "The page changed while you were reviewing. Ask again to get fresh edits." });
      return;
    }
    try {
      session.applyChanges(review.changes);
      useApp.getState().toast("AI edit applied. ⌘Z to undo.");
      get().close();
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  saveKey: async (key) => {
    try {
      await ipc.aiSetKey(key);
      set({ phase: "idle", error: null });
      return true;
    } catch (e) {
      set({ error: errorMessage(e) });
      return false;
    }
  },

  removeKey: async () => {
    await ipc.aiRemoveKey().catch(() => {});
    set({ phase: "key", error: null });
  },
}));
