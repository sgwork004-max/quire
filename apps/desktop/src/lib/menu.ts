import { Menu } from "@tauri-apps/api/menu";

/** A native right-click menu item. `null` renders a separator. */
export type MenuEntry =
  | null
  | {
      text: string;
      action?: () => void;
      enabled?: boolean;
      checked?: boolean;
      items?: MenuEntry[];
    };

type NativeItem = Record<string, unknown>;

function toNative(entry: MenuEntry): NativeItem {
  if (entry === null) return { item: "Separator" };
  if (entry.items) return { text: entry.text, enabled: entry.enabled ?? true, items: entry.items.map(toNative) };
  const base = { text: entry.text, enabled: entry.enabled ?? true, action: entry.action };
  return entry.checked === undefined ? base : { ...base, checked: entry.checked };
}

/** Shows a native context menu at the pointer. */
export async function popupMenu(entries: MenuEntry[]): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const menu = await Menu.new({ items: entries.map(toNative) as any });
  await menu.popup();
}
