import { LazyStore } from "@tauri-apps/plugin-store";

/** Small UI preferences that survive restarts. Failures are ignored. */
const store = new LazyStore("prefs.json");

export async function loadPref<T>(key: string): Promise<T | undefined> {
  try {
    return (await store.get<T>(key)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function savePref(key: string, value: unknown): void {
  store
    .set(key, value)
    .then(() => store.save())
    .catch(() => {});
}
