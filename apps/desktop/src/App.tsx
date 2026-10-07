import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useApp, type Viewport } from "./store";
import { ipc, isHtmlPath } from "./lib/ipc";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { Viewer } from "./components/Viewer";
import { EmptyState } from "./components/EmptyState";
import { DropOverlay } from "./components/DropOverlay";
import { Toasts } from "./components/Toasts";

const MENU_ACTIONS: Record<string, () => void> = {
  open: () => void useApp.getState().openDialog(),
  "close-tab": () => {
    const { activeId, closeTab } = useApp.getState();
    if (activeId) closeTab(activeId);
  },
  reveal: () => useApp.getState().reveal(),
  "open-in-browser": () => useApp.getState().openInBrowser(),
  reload: () => useApp.getState().reload(),
  "toggle-sidebar": () => useApp.getState().toggleSidebar(),
  "next-tab": () => useApp.getState().cycleTab(1),
  "prev-tab": () => useApp.getState().cycleTab(-1),
  ...Object.fromEntries(
    (["fit", "desktop", "tablet", "mobile"] as Viewport[]).map((v) => [
      `viewport-${v}`,
      () => useApp.getState().setViewport(v),
    ]),
  ),
};

export default function App() {
  const hasTabs = useApp((s) => s.tabs.length > 0);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const [drag, setDrag] = useState<null | { valid: boolean }>(null);
  const reloadTimers = useRef(new Map<string, number>());

  useEffect(() => {
    const { init, openPaths, reload } = useApp.getState();
    const unlisten: Promise<() => void>[] = [
      listen<string>("menu", (e) => MENU_ACTIONS[e.payload]?.()),
      listen<string[]>("open-paths", (e) => void openPaths(e.payload)),
      // Editors and AI tools often write a file in several bursts; settle first.
      listen<string>("document-changed", (e) => {
        const id = e.payload;
        window.clearTimeout(reloadTimers.current.get(id));
        reloadTimers.current.set(id, window.setTimeout(() => reload(id), 150));
      }),
      getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter") setDrag({ valid: p.paths.some(isHtmlPath) });
        else if (p.type === "leave") setDrag(null);
        else if (p.type === "drop") {
          setDrag(null);
          void openPaths(p.paths);
        }
      }),
    ];

    // Listeners must be attached before asking for files queued at launch.
    void Promise.all(unlisten)
      .then(init)
      .then(() => ipc.takePendingOpens())
      .then((paths) => (paths.length ? openPaths(paths) : undefined));

    return () => unlisten.forEach((u) => void u.then((f) => f()));
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {sidebarOpen && <Sidebar />}
      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        {hasTabs ? <Viewer /> : <EmptyState />}
      </main>
      {drag && <DropOverlay valid={drag.valid} />}
      <Toasts />
    </div>
  );
}
