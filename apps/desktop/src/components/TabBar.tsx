import clsx from "clsx";
import {
  ExternalLink,
  FileCode2,
  FolderSearch,
  Monitor,
  PanelLeftOpen,
  Plus,
  RotateCw,
  Scan,
  Smartphone,
  Tablet,
  X,
} from "lucide-react";
import { useApp, type Viewport } from "../store";
import { IconButton } from "./IconButton";

const VIEWPORTS: { id: Viewport; label: string; shortcut: string; Icon: typeof Monitor }[] = [
  { id: "fit", label: "Fit window", shortcut: "⌘0", Icon: Scan },
  { id: "desktop", label: "Desktop · 1440", shortcut: "⌘1", Icon: Monitor },
  { id: "tablet", label: "Tablet · 768", shortcut: "⌘2", Icon: Tablet },
  { id: "mobile", label: "Mobile · 390", shortcut: "⌘3", Icon: Smartphone },
];

export function TabBar() {
  const tabs = useApp((s) => s.tabs);
  const activeId = useApp((s) => s.activeId);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const viewport = useApp((s) => s.viewport);
  const { activate, closeTab, openDialog, toggleSidebar, reload, reveal, openInBrowser, setViewport } =
    useApp.getState();
  const hasDoc = activeId !== null;

  return (
    <header
      data-tauri-drag-region
      className={clsx(
        "flex h-[52px] shrink-0 items-center gap-1 border-b border-line bg-bg pr-2.5",
        sidebarOpen ? "pl-2" : "pl-[84px]",
      )}
    >
      {!sidebarOpen && (
        <IconButton label="Show sidebar" shortcut="⌘\" onClick={toggleSidebar} className="mr-1">
          <PanelLeftOpen size={16} strokeWidth={1.75} />
        </IconButton>
      )}

      <div role="tablist" className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={active}
              title={t.path}
              onMouseDown={(e) => e.button === 0 && activate(t.id)}
              onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
              className={clsx(
                "group flex h-8 max-w-[220px] min-w-[120px] shrink items-center gap-2 rounded-lg pl-2.5 pr-1 transition-colors",
                active
                  ? "bg-surface text-ink shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.05)]"
                  : "text-ink-2 hover:bg-hover hover:text-ink",
              )}
            >
              <FileCode2 size={14} strokeWidth={1.75} className={clsx("shrink-0", active ? "text-accent" : "text-ink-3")} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{t.name}</span>
              <button
                type="button"
                aria-label={`Close ${t.name}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => closeTab(t.id)}
                className={clsx(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink",
                  active ? "visible" : "invisible group-hover:visible",
                )}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>

      <IconButton label="Open file" shortcut="⌘O" onClick={openDialog}>
        <Plus size={16} strokeWidth={1.75} />
      </IconButton>

      <div data-tauri-drag-region className="h-full min-w-6 flex-1" />

      {hasDoc && (
        <div className="flex items-center gap-1">
          <div className="mr-1 flex items-center rounded-lg bg-hover p-0.5">
            {VIEWPORTS.map(({ id, label, shortcut, Icon }) => (
              <button
                key={id}
                type="button"
                aria-label={label}
                aria-pressed={viewport === id}
                title={`${label}  ${shortcut}`}
                onClick={() => setViewport(id)}
                className={clsx(
                  "flex h-6 w-7 items-center justify-center rounded-md transition-colors",
                  viewport === id
                    ? "bg-surface text-ink shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.06)]"
                    : "text-ink-3 hover:text-ink",
                )}
              >
                <Icon size={14} strokeWidth={1.75} />
              </button>
            ))}
          </div>
          <IconButton label="Reload" shortcut="⌘R" onClick={() => reload()}>
            <RotateCw size={15} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Show in Finder" shortcut="⇧⌘R" onClick={reveal}>
            <FolderSearch size={15} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Open in browser" shortcut="⇧⌘B" onClick={openInBrowser}>
            <ExternalLink size={15} strokeWidth={1.75} />
          </IconButton>
        </div>
      )}
    </header>
  );
}
