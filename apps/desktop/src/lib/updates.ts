import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useApp } from "../store/app";
import { flushAll } from "../editor/session";

/**
 * Checks GitHub Releases for a newer Quire (signed with Quire's updater key,
 * which the app verifies) and offers to install it. Silent when offline or
 * already up to date; skipped in development builds.
 */
export async function checkForUpdates(manual = false) {
  if (import.meta.env.DEV) return;
  const toast = useApp.getState().toast;
  try {
    const update = await check();
    if (!update) {
      if (manual) toast("Quire is up to date.");
      return;
    }
    toast(`Quire ${update.version} is available`, {
      label: "Update",
      run: () => {
        toast("Downloading the update…");
        void (async () => {
          await flushAll();
          await update.downloadAndInstall();
          await relaunch();
        })().catch((e) => toast(`Update failed: ${e}`));
      },
    });
  } catch {
    if (manual) toast("Couldn't check for updates. Check your connection.");
  }
}
