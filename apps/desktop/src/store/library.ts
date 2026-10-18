import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { errorMessage, ipc, type FileEntry, type LibraryQuery, type Location, type Overview, type SortKey, type Tag } from "../lib/ipc";
import { popupMenu, type MenuEntry } from "../lib/menu";
import { savePref } from "../lib/prefs";
import { HOME, useApp } from "./app";

export type LibraryView =
  | { kind: "all" | "recent" | "starred" | "trash" }
  | { kind: "location"; id: number }
  | { kind: "tag"; id: number };

export type Layout = "grid" | "list";

/** Tag colours: warm, distinct in both themes. */
export const TAG_COLORS = ["#e2513a", "#e8890c", "#d4a20b", "#3f9d5a", "#1e9bb0", "#3b6fe0", "#8b5cf6", "#d4458f"];

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
  newFile: () => Promise<void>;
  fileMenu: (file: FileEntry) => void;

  addFolder: (path?: string) => Promise<void>;
  folderMenu: (location: Location) => void;
  createTag: (name: string) => Promise<number | null>;
  updateTag: (tag: Tag, changes: Partial<Pick<Tag, "name" | "color">>) => Promise<void>;
  tagMenu: (tag: Tag, startRename: () => void) => void;
}

const toast = (m: string, action?: { label: string; run: () => void }) => useApp.getState().toast(m, action);
const fail = (what: string) => (e: unknown) => toast(`${what}: ${errorMessage(e)}`);

function toQuery(view: LibraryView, search: string, sort: SortKey): LibraryQuery {
  return {
    view: view.kind,
    locationId: view.kind === "location" ? view.id : undefined,
    tagId: view.kind === "tag" ? view.id : undefined,
    search: search.trim() || undefined,
    sort: search.trim() ? undefined : sort,
  };
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

  setView: (view) => {
    set({ view, search: "", renamingId: null });
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
    try {
      const [overview, files] = await Promise.all([ipc.overview(), ipc.query(toQuery(view, search, sort))]);
      if (seq !== refreshSeq) return; // a newer refresh won
      // A folder or tag that no longer exists falls back to All files.
      const gone =
        (view.kind === "location" && !overview.locations.some((l) => l.id === view.id)) ||
        (view.kind === "tag" && !overview.tags.some((t) => t.id === view.id));
      if (gone) {
        set({ view: { kind: "all" }, overview });
        return get().refresh();
      }
      set({ overview, files, loaded: true });
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

  newFile: async () => {
    const { view, overview } = get();
    let dir = view.kind === "location" ? overview?.locations.find((l) => l.id === view.id)?.path : undefined;
    if (!dir) {
      const picked = await open({
        directory: true,
        title: "Choose a folder for the new file",
        defaultPath: overview?.locations[0]?.path,
      });
      if (typeof picked !== "string") return;
      dir = picked;
    }
    try {
      const file = await ipc.newFile(dir);
      await useApp.getState().openPaths([file.path], "visual");
      void get().refresh();
    } catch (e) {
      fail("Couldn't create the file")(e);
    }
  },

  fileMenu: (file) => {
    const s = get();
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
          null,
          { text: "Show in Finder", action: () => void revealItemInDir(file.path) },
          null,
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

  folderMenu: (location) => {
    void popupMenu([
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
