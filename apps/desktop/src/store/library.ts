import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { errorMessage, ipc, type FileEntry, type Folder, type LibraryQuery, type Location, type Overview, type SortKey, type Tag } from "../lib/ipc";
import { usePrompt } from "../components/PromptDialog";
import { useImport } from "./import";
import { popupMenu, type MenuEntry } from "../lib/menu";
import { savePref } from "../lib/prefs";
import { HOME, useApp } from "./app";

export type LibraryView =
  | { kind: "all" | "recent" | "starred" | "trash" | "hidden" | "shared" }
  | { kind: "location"; id: number }
  | { kind: "folder"; id: number }
  | { kind: "tag"; id: number };

export type Layout = "grid" | "list";

/** Tag colours: warm, distinct in both themes. */
export const TAG_COLORS = ["#c8372d", "#e8890c", "#d4a20b", "#3f9d5a", "#1e9bb0", "#3b6fe0", "#8b5cf6", "#d4458f"];

interface LibraryState {
  view: LibraryView;
  search: string;
  sort: SortKey;
  layout: Layout;
  overview: Overview | null;
  files: FileEntry[];
  loaded: boolean;
  renamingId: number | null;
  /** Bumped to move keyboard focus to the search field. */
  searchFocus: number;
  /** Files picked with ⌘-click / ⇧-click, for bulk actions. */
  selected: number[];
  anchor: number | null;

  setView: (view: LibraryView) => void;
  setSearch: (search: string) => void;
  setSort: (sort: SortKey) => void;
  setLayout: (layout: Layout) => void;
  focusSearch: () => void;
  refresh: () => Promise<void>;
  refreshSoon: () => void;

  openFile: (file: FileEntry) => void;
  toggleStar: (file: FileEntry) => Promise<void>;
  toggleTag: (file: FileEntry, tagId: number) => Promise<void>;
  startRename: (id: number | null) => void;
  rename: (file: FileEntry, name: string) => Promise<void>;
  duplicate: (file: FileEntry) => Promise<void>;
  trash: (file: FileEntry) => Promise<void>;
  restore: (file: FileEntry) => Promise<void>;
  emptyTrash: () => Promise<void>;
  fileMenu: (file: FileEntry) => void;
  /** ⌘-click toggles one file, ⇧-click selects a range. */
  select: (file: FileEntry, mode: "toggle" | "range") => void;
  selectAll: () => void;
  clearSelection: () => void;
  setHidden: (ids: number[], hidden: boolean) => Promise<void>;
  /** Puts files in a Quire folder; null takes them out. */
  setFolder: (ids: number[], folder: number | null) => Promise<void>;
  /** Asks for a name, creates the folder, and optionally puts files in it. */
  newFolder: (ids?: number[]) => Promise<void>;
  folderContextMenu: (folder: Folder) => void;
  tagFiles: (ids: number[], tagId: number) => Promise<void>;
  trashFiles: (ids: number[]) => Promise<void>;

  addFolder: (path?: string) => Promise<void>;
  folderMenu: (location: Location) => void;
  /** Offer to import HTML already in Downloads (shown once). */
  inboxBanner: number | null;
  createTag: (name: string) => Promise<number | null>;
  updateTag: (tag: Tag, changes: Partial<Pick<Tag, "name" | "color">>) => Promise<void>;
  tagMenu: (tag: Tag, startRename: () => void) => void;
}

const toast = (m: string, action?: { label: string; run: () => void }) => useApp.getState().toast(m, action);
const fail = (what: string) => (e: unknown) => toast(`${what}: ${errorMessage(e)}`);

function toQuery(view: LibraryView, search: string, sort: SortKey): LibraryQuery {
  return {
    view: view.kind === "shared" ? "all" : view.kind,
    locationId: view.kind === "location" ? view.id : undefined,
    folderId: view.kind === "folder" ? view.id : undefined,
    tagId: view.kind === "tag" ? view.id : undefined,
    search: search.trim() || undefined,
    sort: search.trim() ? undefined : sort,
  };
}

/** "Add to Folder" submenu: Quire's folders, a new one, or out of any folder. */
export function folderMenuItems(s: LibraryState, ids: number[]): MenuEntry[] {
  const folders = s.overview?.folders ?? [];
  const files = s.files.filter((f) => ids.includes(f.id));
  return [
    ...folders.map((f) => ({ text: f.name, checked: files.length > 0 && files.every((x) => x.folderId === f.id), action: () => void s.setFolder(ids, f.id) })),
    ...(folders.length ? [null] : []),
    { text: "New Folder…", action: () => void s.newFolder(ids) },
    ...(files.some((f) => f.folderId !== null) ? [{ text: "Remove from Folder", action: () => void s.setFolder(ids, null) }] : []),
  ];
}

/** Right-click menu for several selected files. */
function bulkMenu(s: LibraryState) {
  const ids = s.selected;
  const files = s.files.filter((f) => ids.includes(f.id));
  const tags = s.overview?.tags ?? [];
  const n = `${ids.length} Files`;
  void popupMenu([
    { text: `Open ${n}`, action: () => void useApp.getState().openPaths(files.map((f) => f.path)) },
    null,
    {
      text: "Tags",
      enabled: tags.length > 0,
      items: tags.length
        ? tags.map((t) => ({ text: t.name, checked: files.every((f) => f.tagIds.includes(t.id)), action: () => void s.tagFiles(ids, t.id) }))
        : [{ text: "No tags yet", enabled: false }],
    },
    { text: "Add to Folder", items: folderMenuItems(s, ids) },
    null,
    s.view.kind === "hidden"
      ? { text: `Show ${n} in Library`, action: () => void s.setHidden(ids, false) }
      : { text: `Hide ${n} from Library`, action: () => void s.setHidden(ids, true) },
    { text: `Move ${n} to Trash`, action: () => void s.trashFiles(ids) },
  ]);
}

/** A sidebar folder or tag that files can be dropped on. */
export type DropTarget = { kind: "folder" | "tag"; id: number };

/** Files dropped on a folder go into it; dropped on a tag, they get the tag. */
export async function dropOn(target: DropTarget, ids: number[]) {
  const s = useLibrary.getState();
  if (target.kind === "folder") return s.setFolder(ids, target.id);
  try {
    await Promise.all(ids.map((id) => ipc.setFileTag(id, target.id, true)));
    const name = s.overview?.tags.find((t) => t.id === target.id)?.name;
    toast(`Tagged ${ids.length === 1 ? "1 file" : `${ids.length} files`} “${name}”`);
  } catch (e) {
    fail("Couldn't tag")(e);
  }
  void s.refresh();
}

/** HTML dropped from Finder onto a folder or tag: import it into Quire › Inbox, then file it there. */
export async function dropPathsOn(target: DropTarget, paths: string[]) {
  try {
    const r = await ipc.importPaths(paths, null);
    if (r.ids.length) await dropOn(target, r.ids);
  } catch (e) {
    fail("Couldn't import")(e);
  }
}

let refreshTimer = 0;
let refreshSeq = 0;

export const useLibrary = create<LibraryState>((set, get) => ({
  view: { kind: "all" },
  search: "",
  sort: "modified",
  layout: "grid",
  overview: null,
  files: [],
  loaded: false,
  renamingId: null,
  searchFocus: 0,
  selected: [],
  anchor: null,
  inboxBanner: null,

  setView: (view) => {
    set({ view, search: "", renamingId: null, selected: [], anchor: null });
    useApp.getState().activate(HOME);
    void get().refresh();
  },

  setSearch: (search) => {
    set({ search });
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => void get().refresh(), 120);
  },

  setSort: (sort) => {
    set({ sort });
    savePref("sort", sort);
    void get().refresh();
  },

  setLayout: (layout) => {
    set({ layout });
    savePref("layout", layout);
  },

  focusSearch: () => {
    useApp.getState().activate(HOME);
    set((s) => ({ searchFocus: s.searchFocus + 1 }));
  },

  refresh: async () => {
    const seq = ++refreshSeq;
    const { view, search, sort } = get();
    if (view.kind === "shared") {
      const { useCloud } = await import("./cloud");
      void useCloud.getState().refresh();
      set({ overview: await ipc.overview().catch(() => get().overview), files: [], loaded: true });
      return;
    }
    try {
      const [overview, files] = await Promise.all([ipc.overview(), ipc.query(toQuery(view, search, sort))]);
      if (seq !== refreshSeq) return; // a newer refresh won
      // A folder or tag that no longer exists falls back to All files.
      const gone =
        (view.kind === "location" && !overview.locations.some((l) => l.id === view.id)) ||
        (view.kind === "folder" && !overview.folders.some((f) => f.id === view.id)) ||
        (view.kind === "tag" && !overview.tags.some((t) => t.id === view.id));
      if (gone) {
        set({ view: { kind: "all" }, overview });
        return get().refresh();
      }
      set({ overview, files, loaded: true, selected: get().selected.filter((id) => files.some((f) => f.id === id)) });
    } catch (e) {
      fail("Couldn't load the library")(e);
    }
  },

  refreshSoon: () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => void get().refresh(), 250);
  },

  openFile: (file) => {
    if (file.trashedMs) {
      toast("Restore this file to open it", { label: "Restore", run: () => void get().restore(file) });
      return;
    }
    void useApp.getState().openPaths([file.path]).then(() => get().refreshSoon());
  },

  toggleStar: async (file) => {
    // Optimistic: flip it locally first so the star responds instantly.
    set((s) => ({ files: s.files.map((f) => (f.id === file.id ? { ...f, starred: !file.starred } : f)) }));
    await ipc.setStarred(file.id, !file.starred).catch(fail("Couldn't star"));
    void get().refresh();
  },

  toggleTag: async (file, tagId) => {
    await ipc.setFileTag(file.id, tagId, !file.tagIds.includes(tagId)).catch(fail("Couldn't tag"));
    void get().refresh();
  },

  startRename: (id) => set({ renamingId: id }),

  rename: async (file, name) => {
    set({ renamingId: null });
    if (!name.trim() || name.trim() === file.name) return;
    const app = useApp.getState();
    const openTab = app.tabs.find((t) => t.path === file.path);
    try {
      if (openTab) await app.closeTab(openTab.id);
      const renamed = await ipc.renameFile(file.id, name);
      if (openTab) await app.openPaths([renamed.path], openTab.mode);
    } catch (e) {
      fail("Couldn't rename")(e);
      if (openTab) await app.openPaths([file.path], openTab.mode);
    }
    void get().refresh();
  },

  duplicate: async (file) => {
    try {
      const copy = await ipc.duplicateFile(file.id);
      await get().refresh();
      set({ renamingId: copy.id });
    } catch (e) {
      fail("Couldn't duplicate")(e);
    }
  },

  trash: async (file) => {
    const app = useApp.getState();
    const openTab = app.tabs.find((t) => t.path === file.path);
    if (openTab) await app.closeTab(openTab.id);
    try {
      await ipc.trashFile(file.id);
      toast(`Moved “${file.name}” to Trash`, { label: "Undo", run: () => void get().restore(file) });
    } catch (e) {
      fail("Couldn't move to Trash")(e);
    }
    void get().refresh();
  },

  restore: async (file) => {
    try {
      const restored = await ipc.restoreFile(file.id);
      toast(`Restored “${restored.name}”`);
    } catch (e) {
      fail("Couldn't restore")(e);
    }
    void get().refresh();
  },

  emptyTrash: async () => {
    try {
      const n = await ipc.emptyTrash();
      toast(n ? `Moved ${n} file${n === 1 ? "" : "s"} to the system Trash` : "Trash is already empty");
    } catch (e) {
      fail("Couldn't empty the Trash")(e);
    }
    void get().refresh();
  },

  select: (file, mode) => {
    const { files, selected, anchor } = get();
    if (mode === "toggle") {
      const on = selected.includes(file.id);
      set({ selected: on ? selected.filter((id) => id !== file.id) : [...selected, file.id], anchor: file.id });
      return;
    }
    const from = files.findIndex((f) => f.id === (anchor ?? file.id));
    const to = files.findIndex((f) => f.id === file.id);
    const [a, b] = from < to ? [from, to] : [to, from];
    set({ selected: [...new Set([...selected, ...files.slice(a, b + 1).map((f) => f.id)])] });
  },

  selectAll: () => set({ selected: get().files.map((f) => f.id) }),
  clearSelection: () => set({ selected: [], anchor: null }),

  setHidden: async (ids, hidden) => {
    try {
      await ipc.setHidden(ids, hidden);
      const n = ids.length === 1 ? "File" : `${ids.length} files`;
      toast(hidden ? `${n} hidden. Find ${ids.length === 1 ? "it" : "them"} under Hidden.` : `${n} back in the library`, {
        label: "Undo",
        run: () => void get().setHidden(ids, !hidden),
      });
    } catch (e) {
      fail("Couldn't change that")(e);
    }
    set({ selected: [] });
    void get().refresh();
  },

  setFolder: async (ids, folder) => {
    try {
      await ipc.setFilesFolder(ids, folder);
      const name = get().overview?.folders.find((f) => f.id === folder)?.name;
      const n = ids.length === 1 ? "1 file" : `${ids.length} files`;
      toast(folder === null ? `Took ${n} out of the folder` : `Added ${n} to “${name}”`);
    } catch (e) {
      fail("Couldn't change the folder")(e);
    }
    set({ selected: [] });
    void get().refresh();
  },

  newFolder: async (ids = []) => {
    const name = await usePrompt.getState().ask("New Folder", { label: "Folder name" });
    if (!name) return;
    try {
      const id = await ipc.createFolder(name);
      if (ids.length) await get().setFolder(ids, id);
      else get().setView({ kind: "folder", id });
      await get().refresh();
    } catch (e) {
      fail("Couldn't create the folder")(e);
    }
  },

  folderContextMenu: (folder) => {
    const s = get();
    void popupMenu([
      {
        text: "Rename…",
        action: () =>
          void usePrompt
            .getState()
            .ask("Rename Folder", { label: "Folder name", initial: folder.name, confirm: "Rename" })
            .then((name) => {
              if (name) void ipc.renameFolder(folder.id, name).catch(fail("Couldn't rename")).finally(() => void s.refresh());
            }),
      },
      null,
      {
        text: "Delete Folder",
        action: () =>
          void ipc
            .deleteFolder(folder.id)
            .then(() => toast(`Deleted “${folder.name}”. Its files are still in your library.`))
            .catch(fail("Couldn't delete folder"))
            .finally(() => void s.refresh()),
      },
    ]);
  },

  tagFiles: async (ids, tagId) => {
    const files = get().files.filter((f) => ids.includes(f.id));
    // Like Finder: if every file already has the tag, remove it; otherwise add it to all.
    const on = !files.every((f) => f.tagIds.includes(tagId));
    try {
      await Promise.all(ids.map((id) => ipc.setFileTag(id, tagId, on)));
    } catch (e) {
      fail("Couldn't tag")(e);
    }
    void get().refresh();
  },

  trashFiles: async (ids) => {
    try {
      for (const id of ids) await ipc.trashFile(id);
      toast(ids.length === 1 ? "Moved to Trash" : `Moved ${ids.length} files to Trash`, {
        label: "Undo",
        run: () => void Promise.all(ids.map((id) => ipc.restoreFile(id))).then(() => get().refresh()),
      });
    } catch (e) {
      fail("Couldn't move to Trash")(e);
    }
    set({ selected: [] });
    void get().refresh();
  },

  fileMenu: (file) => {
    const s = get();
    if (s.selected.length > 1 && s.selected.includes(file.id)) return bulkMenu(s);
    const tags = s.overview?.tags ?? [];
    const entries: MenuEntry[] = file.trashedMs
      ? [
          { text: "Restore", action: () => void s.restore(file) },
          null,
          { text: "Empty Trash…", action: () => void s.emptyTrash() },
        ]
      : [
          { text: "Open", action: () => s.openFile(file) },
          {
            text: "Open in Visual Editor",
            action: () => void useApp.getState().openPaths([file.path], "visual"),
          },
          { text: "Open in Code Editor", action: () => void useApp.getState().openPaths([file.path], "code") },
          null,
          {
            text: "Share…",
            action: () =>
              void import("./cloud").then(({ useCloud }) => useCloud.getState().openShareDialog({ path: file.path, name: file.name })),
          },
          null,
          { text: file.starred ? "Remove Star" : "Star", action: () => void s.toggleStar(file) },
          {
            text: "Tags",
            enabled: tags.length > 0,
            items: tags.length
              ? tags.map((t) => ({ text: t.name, checked: file.tagIds.includes(t.id), action: () => void s.toggleTag(file, t.id) }))
              : [{ text: "No tags yet", enabled: false }],
          },
          null,
          { text: "Rename…", action: () => s.startRename(file.id) },
          { text: "Duplicate", action: () => void s.duplicate(file) },
          { text: "Add to Folder", items: folderMenuItems(s, [file.id]) },
          null,
          { text: "Show in Finder", action: () => void revealItemInDir(file.path) },
          null,
          s.view.kind === "hidden"
            ? { text: "Show in Library", action: () => void s.setHidden([file.id], false) }
            : { text: "Hide from Library", action: () => void s.setHidden([file.id], true) },
          { text: "Move to Trash", action: () => void s.trash(file) },
        ];
    void popupMenu(entries);
  },

  addFolder: async (path) => {
    let folder = path;
    if (!folder) {
      const picked = await open({ directory: true, title: "Choose a folder. Quire adds every HTML file inside it." });
      if (typeof picked !== "string") return;
      folder = picked;
    }
    try {
      const id = await ipc.addLocation(folder);
      get().setView({ kind: "location", id });
    } catch (e) {
      fail("Couldn't add folder")(e);
    }
  },

  folderMenu: async (location) => {
    const isQuire = /[\\/]Quire$/.test(location.path);
    const inbox = isQuire ? await ipc.inboxStatus().catch(() => null) : null;
    void popupMenu([
      ...(inbox
        ? [
            {
              text: "Import New HTML from Downloads and Desktop",
              checked: inbox.enabled,
              action: () =>
                void ipc
                  .setInboxEnabled(!inbox.enabled)
                  .then(() => toast(inbox.enabled ? "Stopped importing automatically" : "New HTML in Downloads and on your Desktop will now appear in Quire"))
                  .catch(fail("Couldn't change that setting")),
            },
            { text: "Import HTML…", action: () => useImport.getState().show() },
            null,
          ]
        : []),
      { text: "Show in Finder", action: () => void revealItemInDir(location.path) },
      { text: "Rescan", action: () => void ipc.rescanLocation(location.id).catch(fail("Couldn't rescan")) },
      null,
      {
        text: "Remove from Library",
        action: () =>
          void ipc
            .removeLocation(location.id)
            .then(() => toast(`Removed “${location.name}”. Files on disk are untouched.`))
            .catch(fail("Couldn't remove folder"))
            .finally(() => void get().refresh()),
      },
    ]);
  },

  createTag: async (name) => {
    const used = new Set(get().overview?.tags.map((t) => t.color));
    const color = TAG_COLORS.find((c) => !used.has(c)) ?? TAG_COLORS[(get().overview?.tags.length ?? 0) % TAG_COLORS.length];
    try {
      const id = await ipc.createTag(name, color);
      await get().refresh();
      return id;
    } catch (e) {
      fail("Couldn't create tag")(e);
      return null;
    }
  },

  updateTag: async (tag, changes) => {
    await ipc
      .updateTag(tag.id, changes.name ?? tag.name, changes.color ?? tag.color)
      .catch(fail("Couldn't update tag"));
    void get().refresh();
  },

  tagMenu: (tag, startRename) => {
    const s = get();
    void popupMenu([
      { text: "Rename…", action: startRename },
      {
        text: "Colour",
        items: TAG_COLORS.map((c, i) => ({
          text: ["Vermilion", "Amber", "Gold", "Green", "Teal", "Blue", "Violet", "Pink"][i],
          checked: tag.color === c,
          action: () => void s.updateTag(tag, { color: c }),
        })),
      },
      null,
      {
        text: "Delete Tag",
        action: () =>
          void ipc
            .deleteTag(tag.id)
            .catch(fail("Couldn't delete tag"))
            .finally(() => void s.refresh()),
      },
    ]);
  },
}));
