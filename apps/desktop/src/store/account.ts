import { create } from "zustand";
import { openUrl } from "@tauri-apps/plugin-opener";
import { errorMessage, ipc, type Account, type SignInStart } from "../lib/ipc";
import { useApp } from "./app";

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

export const useAccount = create<AccountState>((set, get) => ({
  status: "loading",
  account: null,
  pending: null,
  error: null,
  offline: false,

  load: async () => {
    try {
      const account = await ipc.account();
      set({ account, status: account ? "signed-in" : "signed-out", offline: false });
    } catch {
      // Offline with a saved session: stay signed in, try again later.
      set((s) => ({ status: s.account ? "signed-in" : "signed-out", offline: true }));
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
    if (account) {
      set({ account, status: "signed-in", pending: null, error: null, offline: false });
      useApp.getState().toast(`Signed in as ${account.email}`);
    } else {
      set({ account: null, status: "signed-out", pending: null });
    }
  },

  failed: (reason) => set({ error: reason, pending: null }),

  signOut: async () => {
    await ipc.signOut().catch(() => {});
    set({ account: null, status: "signed-out" });
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
