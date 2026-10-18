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

/**
 * Actions for the items of the popup menu on screen, by item id. Native menu
 * clicks arrive through the app-wide `menu` event (see App.tsx) rather than
 * per-item JS callbacks, which proved unreliable on macOS.
 */
const actions = new Map<string, () => void>();
let next = 0;

function toNative(entry: MenuEntry): NativeItem {
  if (entry === null) return { item: "Separator" };
  if (entry.items) return { text: entry.text, enabled: entry.enabled ?? true, items: entry.items.map(toNative) };
  const id = `ctx-${++next}`;
  if (entry.action) actions.set(id, entry.action);
  const base = { id, text: entry.text, enabled: entry.enabled ?? true };
  return entry.checked === undefined ? base : { ...base, checked: entry.checked };
}

/** Shows a native context menu at the pointer. */
export async function popupMenu(entries: MenuEntry[]): Promise<void> {
  actions.clear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const menu = await Menu.new({ items: entries.map(toNative) as any });
  await menu.popup();
}

/** Runs a popup menu item's action. Returns false for ids that aren't popup items. */
export function runPopupAction(id: string): boolean {
  const action = actions.get(id);
  if (!action) return id.startsWith("ctx-");
  actions.clear();
  // Let the menu finish closing before the action opens dialogs or windows.
  window.setTimeout(action, 0);
  return true;
}
