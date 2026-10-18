import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { activeTab, HOME, useApp, type Mode, type Viewport } from "./store/app";
import { dropPathsOn, useLibrary, type DropTarget, type Layout } from "./store/library";
import { useAccount } from "./store/account";
import type { Account } from "./lib/ipc";
import { errorMessage, ipc, isHtmlPath, type SortKey } from "./lib/ipc";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ImportDialog } from "./components/ImportDialog";
import { SettingsDialog, applyAppearance } from "./components/SettingsDialog";
import { PromptDialog } from "./components/PromptDialog";
import { useSettings } from "./store/settings";
import { useImport } from "./store/import";
import { loadPref } from "./lib/prefs";
import { runPopupAction } from "./lib/menu";
import { flushAll, getSession } from "./editor/session";
import { getFrame, postToFrame } from "./editor/frames";
import { handleBridgeMessage } from "./editor/bridgeMessages";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { DocView } from "./components/doc/DocView";
import { LibraryView } from "./components/library/LibraryView";
import { DropOverlay } from "./components/DropOverlay";
import { Toasts } from "./components/Toasts";
import { SignInDialog } from "./components/Account";
import { ShareDialog } from "./components/ShareDialog";
import { DataDialog, useDataDialog } from "./components/DataDialog";
import { checkForUpdates } from "./lib/updates";
import { useCloud } from "./store/cloud";
import { useComments } from "./store/comments";

const app = () => useApp.getState();
const IS_MAC = navigator.userAgent.includes("Mac");
let lastFocusSync = 0;
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
  open: () => void app().openDialog(),
  "add-folder": () => void library().addFolder(),
  save: () => {
    const tab = activeTab(app());
    if (!tab) return;
    void (getSession(tab.id)?.flush() ?? Promise.resolve())
      .then(() => ipc.checkpoint(tab.id))
      .then(() => app().toast("Version saved. Your next edit starts a new one."));
  },
  "check-updates": () => void checkForUpdates(true),
  "export-pdf": () => void exportActive("pdf"),
  "export-html": () => void exportActive("html"),
  "live-data": () => {
    const tab = activeTab(app());
    if (tab) useDataDialog.getState().show(tab);
  },
  comments: () => useComments.getState().togglePanel(),
  "new-comment": () => {
    const tab = activeTab(app());
    if (!tab?.share) return app().toast("Share this file to comment on it.");
    useComments.getState().startPick(tab.id);
  },
  share: () => {
    const tab = activeTab(app());
    if (tab && (!tab.share || tab.share.role === "owner")) useCloud.getState().openShareDialog({ path: tab.path, name: tab.name });
  },
  "close-tab": () => {
    const { activeId, closeTab } = app();
    if (activeId !== HOME) void closeTab(activeId);
    else void getCurrentWindow().close();
  },
  "close-window": () => void getCurrentWindow().close(),
  "reopen-tab": () => app().reopenClosed(),
  import: () => useImport.getState().show(),
  help: () => void openUrl("https://github.com/sgwork004-max/quire#readme"),
  "report-issue": () => void openUrl("https://github.com/sgwork004-max/quire/issues/new"),
  "new-tab": () => library().focusSearch(),
  settings: () => useSettings.getState().show(),
  "next-tab-alt": () => app().cycleTab(1),
  "prev-tab-alt": () => app().cycleTab(-1),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`tab-${n}`, () => app().activateIndex(n)])),
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

/** Saves pending edits, then prints (PDF) or writes a single self-contained HTML file. */
async function exportActive(kind: "pdf" | "html") {
  const tab = activeTab(app());
  if (!tab) return app().toast("Open a file to export it.");
  await getSession(tab.id)?.flush();
  try {
    if (kind === "pdf") {
      await ipc.printDocument(tab.id);
      return;
    }
    const stem = tab.name.replace(/\.[^.]+$/, "");
    const dest = await save({ defaultPath: `${stem} (single file).html`, filters: [{ name: "HTML", extensions: ["html"] }] });
    if (!dest) return;
    await ipc.exportStandalone(tab.id, dest);
    app().toast("Exported. Everything is inside one HTML file, ready to send.");
  } catch (e) {
    app().toast(`Couldn't export: ${errorMessage(e)}`);
  }
}

/** The sidebar folder or tag under a point, if any. */
function dropTargetAt(x: number, y: number): { el: Element; target: DropTarget; label: string } | null {
  const el = document.elementFromPoint(x, y)?.closest("[data-drop]");
  const [kind, id] = el?.getAttribute("data-drop")?.split(":") ?? [];
  if (!el || (kind !== "folder" && kind !== "tag")) return null;
  return { el, target: { kind, id: Number(id) }, label: el.getAttribute("data-label") ?? "" };
}

async function restorePrefs() {
  const [sidebarOpen, codeWidth, layout, sort] = await Promise.all([
    loadPref<boolean>("sidebarOpen"),
    loadPref<number>("codeWidth"),
    loadPref<Layout>("layout"),
    loadPref<SortKey>("sort"),
  ]);
  useApp.setState({ ...(sidebarOpen !== undefined && { sidebarOpen }), ...(codeWidth && { codeWidth }) });
  void applyAppearance();
  useLibrary.setState({ ...(layout && { layout }), ...(sort && { sort }) });
}

export default function App() {
  const tabs = useApp((s) => s.tabs);
  const activeId = useApp((s) => s.activeId);
  const [dragging, setDragging] = useState(false);
  const [dropLabel, setDropLabel] = useState<string | null>(null);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const reloadTimers = useRef(new Map<string, number>());

  useEffect(() => {
    const unlisten: Promise<() => void>[] = [
      listen<string>("menu", (e) => runPopupAction(e.payload) || MENU_ACTIONS[e.payload]?.()),
      listen<string[]>("open-paths", (e) => void app().openPaths(e.payload)),
      listen("library-changed", () => library().refreshSoon()),
      listen<{ path: string; name: string; updated: boolean }>("inbox-imported", (e) => {
        const { path, name, updated } = e.payload;
        library().refreshSoon();
        app().toast(updated ? `Updated “${name}” from Downloads` : `New in Inbox: “${name}”`, {
          label: "Open",
          run: () => void app().openPaths([path]),
        });
      }),
      // Fresh live data: reload any open tab of that page.
      listen<string>("data-refreshed", (e) => {
        for (const t of app().tabs) if (t.path === e.payload) app().reload(t.id);
      }),
      listen("cloud-changed", () => {
        useCloud.getState().refreshSoon();
        library().refreshSoon();
      }),
      listen<number>("notifications", (e) => {
        const before = useComments.getState().unread;
        if (e.payload !== before) void useComments.getState().loadNotifications();
        if (e.payload > before) app().toast(e.payload === 1 ? "You have a new comment notification" : `${e.payload} unread comment notifications`);
      }),
      listen<Account | null>("auth-changed", (e) => useAccount.getState().signedIn(e.payload)),
      listen<string>("auth-failed", (e) => useAccount.getState().failed(e.payload)),
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
        // Files from Finder held over a sidebar folder or tag go there instead of opening.
        const target = "position" in p ? dropTargetAt(p.position.x / devicePixelRatio, p.position.y / devicePixelRatio) : null;
        document.querySelectorAll("[data-drop-hover]").forEach((el) => el.removeAttribute("data-drop-hover"));
        if (p.type === "enter" || p.type === "over") {
          setDragging(true);
          target?.el.setAttribute("data-drop-hover", "");
          setDropLabel(target?.label ?? null);
        } else if (p.type === "leave") setDragging(false);
        else if (p.type === "drop") {
          setDragging(false);
          if (target) {
            const html = p.paths.filter(isHtmlPath);
            if (html.length) void dropPathsOn(target.target, html);
            return;
          }
          const html = p.paths.filter(isHtmlPath);
          if (html.length) void app().openPaths(html);
          // Anything else is treated as a folder to add; Rust rejects non-folders.
          for (const path of p.paths.filter((x) => !isHtmlPath(x))) void library().addFolder(path);
        }
      }),
      // Catch up with shared files when Quire comes to the front (background sync is slow on purpose).
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (!focused || Date.now() - lastFocusSync < 15_000 || !useAccount.getState().account) return;
        lastFocusSync = Date.now();
        void ipc.syncNow().catch(() => undefined);
      }),
      // On a Mac, closing the window keeps Quire running (click the Dock icon to bring it back); ⌘Q quits.
      getCurrentWindow().onCloseRequested(async (e) => {
        await flushAll();
        if (IS_MAC) {
          e.preventDefault();
          await getCurrentWindow().hide();
        }
      }),
    ];
    window.addEventListener("message", handleBridgeMessage);
    // In-app menus reuse the native menu's actions.
    const appMenu = (e: Event) => MENU_ACTIONS[(e as CustomEvent<string>).detail]?.();
    window.addEventListener("quire-menu", appMenu);
    // ⌃Tab never reaches the menu bar on macOS, so handle tab shortcuts here (and in documents, via the bridge).
    const tabKeys = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      const name = e.key === "Tab" ? (e.shiftKey ? "prev-tab" : "next-tab") : e.key.toLowerCase() === "t" && !e.shiftKey ? "new-tab" : null;
      if (!name) return;
      e.preventDefault();
      e.stopPropagation();
      MENU_ACTIONS[name]();
    };
    window.addEventListener("keydown", tabKeys, true);

    // Listeners must be attached before asking for files queued at launch.
    void Promise.all(unlisten)
      .then(restorePrefs)
      .then(() => library().refresh())
      .then(() => void useAccount.getState().load())
      .then(() => window.setTimeout(() => void checkForUpdates(), 5000))
      .then(() => ipc.takePendingOpens())
      .then((paths) => (paths.length ? app().openPaths(paths) : undefined));

    return () => {
      window.removeEventListener("message", handleBridgeMessage);
      window.removeEventListener("quire-menu", appMenu);
      window.removeEventListener("keydown", tabKeys, true);
      unlisten.forEach((u) => void u.then((f) => f()));
    };
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <div className={activeId === HOME ? "flex min-h-0 flex-1" : "hidden"}>
          <LibraryView />
        </div>
        {tabs.map((t) => (
          <DocView key={t.id} tab={t} visible={t.id === activeId} />
        ))}
      </main>
      {dragging && <DropOverlay target={dropLabel} left={sidebarOpen ? 240 : 78} />}
      <SignInDialog />
      <ShareDialog />
      <DataDialog />
      <ImportDialog />
      <SettingsDialog />
      <PromptDialog />
      <Toasts />
    </div>
  );
}
