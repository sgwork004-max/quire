import { create } from "zustand";
import { openUrl } from "@tauri-apps/plugin-opener";
import { errorMessage, ipc, type Account, type SignInStart } from "../lib/ipc";
import { loadPref, savePref } from "../lib/prefs";
import { useApp } from "./app";
import { startLiveForAll, stopLiveForAll } from "../editor/live";
import { useCloud } from "./cloud";

type Status = "loading" | "signed-out" | "signing-in" | "signed-in";

interface AccountState {
  status: Status;
  account: Account | null;
  pending: SignInStart | null;
  /** Shown in the sign-in dialog, e.g. "Sign-in was cancelled in the browser." */
  error: string | null;
  offline: boolean;

  load: () => Promise<void>;
  signIn: () => Promise<void>;
  reopenBrowser: () => void;
  cancelSignIn: () => void;
  signedIn: (account: Account | null) => void;
  failed: (reason: string) => void;
  signOut: () => Promise<void>;
  rename: (name: string) => Promise<void>;
}

const RETRY_MS = 15_000;
let retryTimer = 0;

export const useAccount = create<AccountState>((set, get) => ({
  status: "loading",
  account: null,
  pending: null,
  error: null,
  offline: false,

  load: async () => {
    window.clearTimeout(retryTimer);
    try {
      const account = await ipc.account();
      const wasOffline = get().offline;
      set({ account, status: account ? "signed-in" : "signed-out", offline: false });
      savePref("account", account);
      if (account) {
        void useCloud.getState().refresh();
        startLiveForAll();
        if (wasOffline) useApp.getState().toast("Back online");
      }
    } catch {
      // Can't reach Quire Cloud but a session is saved: stay signed in as the
      // last known account, keep working locally, and keep trying.
      const cached = get().account ?? (await loadPref<Account | null>("account")) ?? null;
      set({ account: cached, status: cached ? "signed-in" : "signed-out", offline: true });
      retryTimer = window.setTimeout(() => void get().load(), RETRY_MS);
    }
  },

  signIn: async () => {
    set({ status: "signing-in", error: null, pending: null });
    try {
      set({ pending: await ipc.startSignIn() });
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  reopenBrowser: () => {
    const url = get().pending?.verificationUrl;
    if (url) void openUrl(url);
  },

  cancelSignIn: () => {
    void ipc.cancelSignIn();
    set({ status: get().account ? "signed-in" : "signed-out", pending: null, error: null });
  },

  signedIn: (account) => {
    savePref("account", account);
    if (account) {
      set({ account, status: "signed-in", pending: null, error: null, offline: false });
      useApp.getState().toast(`Signed in as ${account.email}`);
      void useCloud.getState().refresh();
      startLiveForAll();
    } else {
      set({ account: null, status: "signed-out", pending: null });
    }
  },

  failed: (reason) => set({ error: reason, pending: null }),

  signOut: async () => {
    await stopLiveForAll();
    // Close copies of files others shared; signing out deletes them from this Mac.
    const app = useApp.getState();
    const shared = new Set(useCloud.getState().overview?.links.filter((l) => l.role !== "owner").map((l) => l.path));
    for (const t of app.tabs) if (shared.has(t.path)) await app.closeTab(t.id);
    await ipc.signOut().catch(() => {});
    window.clearTimeout(retryTimer);
    savePref("account", null);
    set({ account: null, status: "signed-out", offline: false });
    useCloud.setState({ overview: null });
  },

  rename: async (name) => {
    try {
      const account = await ipc.updateProfile(name);
      if (account) set({ account });
    } catch (e) {
      useApp.getState().toast(`Couldn't update your name: ${errorMessage(e)}`);
    }
  },
}));
