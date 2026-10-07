import clsx from "clsx";
import { Clock, FileCode2, FolderOpen, PanelLeftClose, X } from "lucide-react";
import { useApp } from "../store";
import { parentFolder, relativeTime } from "../lib/format";
import { IconButton } from "./IconButton";
import { Logo } from "./Logo";

export function Sidebar() {
  const recents = useApp((s) => s.recents);
  const tabs = useApp((s) => s.tabs);
  const activeId = useApp((s) => s.activeId);
  const { openDialog, openPaths, removeRecent, toggleSidebar } = useApp.getState();
  const activePath = tabs.find((t) => t.id === activeId)?.path;
  const openPathSet = new Set(tabs.map((t) => t.path));

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-sidebar">
      <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center justify-end px-2.5">
        <IconButton label="Hide sidebar" shortcut="⌘\" onClick={toggleSidebar}>
          <PanelLeftClose size={16} strokeWidth={1.75} />
        </IconButton>
      </div>

      <div className="px-2.5 pb-3">
        <button
          type="button"
          onClick={openDialog}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-medium text-ink shadow-[0_1px_1px_rgb(0_0_0/0.04)] transition-colors hover:bg-hover"
        >
          <FolderOpen size={15} strokeWidth={1.75} className="text-ink-2" />
          Open file…
          <kbd className="ml-auto font-sans text-[11px] text-ink-3">⌘O</kbd>
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-4 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        <Clock size={11} strokeWidth={2.25} />
        Recent
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {recents.length === 0 ? (
          <p className="px-2 py-1.5 text-[12px] leading-relaxed text-ink-3">
            Files you open show up here.
          </p>
        ) : (
          <ul className="space-y-px">
            {recents.map((r) => (
              <li key={r.path} className="group relative">
                <button
                  type="button"
                  onClick={() => openPaths([r.path])}
                  title={r.path}
                  className={clsx(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                    r.path === activePath ? "bg-active" : "hover:bg-hover",
                  )}
                >
                  <FileCode2
                    size={15}
                    strokeWidth={1.75}
                    className={clsx("mt-px shrink-0", openPathSet.has(r.path) ? "text-accent" : "text-ink-3")}
                  />
                  <span className="min-w-0 flex-1 pr-4">
                    <span className="block truncate text-[13px] text-ink">{r.name}</span>
                    <span className="block truncate text-[11px] text-ink-3">
                      {parentFolder(r.path)} · {relativeTime(r.openedAt)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${r.name} from recents`}
                  onClick={() => removeRecent(r.path)}
                  className="absolute right-1.5 top-1.5 hidden h-5 w-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink group-hover:flex"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-ink-2">
        <Logo size={16} />
        <span className="text-[12px] font-semibold tracking-tight text-ink">Quire</span>
        <span className="ml-auto text-[11px] text-ink-3">v0.1</span>
      </div>
    </aside>
  );
}
