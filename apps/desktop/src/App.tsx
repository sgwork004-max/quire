import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { activeTab, HOME, useApp, type Mode, type Viewport } from "./store/app";
import { useLibrary, type Layout } from "./store/library";
import { ipc, isHtmlPath, type SortKey } from "./lib/ipc";
import { loadPref } from "./lib/prefs";
import { flushAll, getSession } from "./editor/session";
import { getFrame, postToFrame } from "./editor/frames";
import { handleBridgeMessage } from "./editor/bridgeMessages";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { DocView } from "./components/doc/DocView";
import { LibraryView } from "./components/library/LibraryView";
import { DropOverlay } from "./components/DropOverlay";
import { Toasts } from "./components/Toasts";

const app = () => useApp.getState();
const library = () => useLibrary.getState();

/**
 * Undo/redo come from the native menu, so route them to whatever has focus:
 * a text field, the code editor, or the document in Visual mode.
 */
function historyAction(kind: "undo" | "redo") {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    document.execCommand(kind);
    return;
  }
  const tab = activeTab(app());
  if (!tab) return;
  if (el instanceof HTMLIFrameElement && el === getFrame(tab.id)) {
    postToFrame(tab.id, { type: kind });
    return;
  }
  const session = getSession(tab.id);
  if (session) (kind === "undo" ? session.undo() : session.redo());
}

function setActiveMode(mode: Mode) {
  const tab = activeTab(app());
  if (tab) void app().setMode(tab.id, mode);
}

const MENU_ACTIONS: Record<string, () => void> = {
  "new-file": () => void library().newFile(),
  open: () => void app().openDialog(),
  "add-folder": () => void library().addFolder(),
  save: () => {
    const tab = activeTab(app());
    if (!tab) return;
    void (getSession(tab.id)?.flush() ?? Promise.resolve())
      .then(() => ipc.checkpoint(tab.id))
      .then(() => app().toast("Version saved. Your next edit starts a new one."));
  },
  "close-tab": () => {
    const { activeId, closeTab } = app();
    if (activeId !== HOME) void closeTab(activeId);
  },
  reveal: () => app().reveal(),
  "open-in-browser": () => app().openInBrowser(),
  reload: () => app().reload(),
  "toggle-sidebar": () => app().toggleSidebar(),
  "next-tab": () => app().cycleTab(1),
  "prev-tab": () => app().cycleTab(-1),
  undo: () => historyAction("undo"),
  redo: () => historyAction("redo"),
  search: () => library().focusSearch(),
  library: () => app().activate(HOME),
  "mode-view": () => setActiveMode("view"),
  "mode-visual": () => setActiveMode("visual"),
  "mode-code": () => setActiveMode("code"),
  history: () => app().toggleHistory(),
  ...Object.fromEntries(
    (["fit", "desktop", "tablet", "mobile"] as Viewport[]).map((v) => [`viewport-${v}`, () => app().setViewport(v)]),
  ),
};

async function restorePrefs() {
  const [sidebarOpen, codeWidth, layout, sort] = await Promise.all([
    loadPref<boolean>("sidebarOpen"),
    loadPref<number>("codeWidth"),
    loadPref<Layout>("layout"),
    loadPref<SortKey>("sort"),
  ]);
  useApp.setState({ ...(sidebarOpen !== undefined && { sidebarOpen }), ...(codeWidth && { codeWidth }) });
  useLibrary.setState({ ...(layout && { layout }), ...(sort && { sort }) });
}

export default function App() {
  const tabs = useApp((s) => s.tabs);
  const activeId = useApp((s) => s.activeId);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const [dragging, setDragging] = useState(false);
  const reloadTimers = useRef(new Map<string, number>());

  useEffect(() => {
    const unlisten: Promise<() => void>[] = [
      listen<string>("menu", (e) => MENU_ACTIONS[e.payload]?.()),
      listen<string[]>("open-paths", (e) => void app().openPaths(e.payload)),
      listen("library-changed", () => library().refreshSoon()),
      listen<{ id: string; doc: boolean }>("document-changed", (e) => {
        const { id, doc } = e.payload;
        // Editors and AI tools often write a file in several bursts; settle first.
        window.clearTimeout(reloadTimers.current.get(id));
        reloadTimers.current.set(
          id,
          window.setTimeout(() => {
            const tab = app().tabs.find((t) => t.id === id);
            const session = getSession(id);
            if (doc && tab && tab.mode !== "view" && session) void session.onDiskChange();
            else app().reload(id);
          }, 150),
        );
      }),
      getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter") setDragging(true);
        else if (p.type === "leave") setDragging(false);
        else if (p.type === "drop") {
          setDragging(false);
          const html = p.paths.filter(isHtmlPath);
          if (html.length) void app().openPaths(html);
          // Anything else is treated as a folder to add; Rust rejects non-folders.
          for (const path of p.paths.filter((x) => !isHtmlPath(x))) void library().addFolder(path);
        }
      }),
      getCurrentWindow().onCloseRequested(() => flushAll()),
    ];
    window.addEventListener("message", handleBridgeMessage);

    // Listeners must be attached before asking for files queued at launch.
    void Promise.all(unlisten)
      .then(restorePrefs)
      .then(() => library().refresh())
      .then(() => ipc.takePendingOpens())
      .then((paths) => (paths.length ? app().openPaths(paths) : undefined));

    return () => {
      window.removeEventListener("message", handleBridgeMessage);
      unlisten.forEach((u) => void u.then((f) => f()));
    };
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {sidebarOpen && <Sidebar />}
      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <div className={activeId === HOME ? "flex min-h-0 flex-1" : "hidden"}>
          <LibraryView />
        </div>
        {tabs.map((t) => (
          <DocView key={t.id} tab={t} visible={t.id === activeId} />
        ))}
      </main>
      {dragging && <DropOverlay />}
      <Toasts />
    </div>
  );
}
