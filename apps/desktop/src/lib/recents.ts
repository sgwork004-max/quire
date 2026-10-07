import { LazyStore } from "@tauri-apps/plugin-store";

export interface Recent {
  path: string;
  name: string;
  openedAt: number;
}

const MAX = 20;
const store = new LazyStore("recents.json");

export async function loadRecents(): Promise<Recent[]> {
  try {
    return (await store.get<Recent[]>("items")) ?? [];
  } catch {
    return [];
  }
}

export async function saveRecents(items: Recent[]): Promise<void> {
  try {
    await store.set("items", items.slice(0, MAX));
    await store.save();
  } catch {
    // Recents are a convenience; never fail an open because of them.
  }
}

export function pushRecent(items: Recent[], path: string, name: string): Recent[] {
  return [{ path, name, openedAt: Date.now() }, ...items.filter((r) => r.path !== path)].slice(0, MAX);
}
