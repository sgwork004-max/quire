import clsx from "clsx";
import {
  Code2,
  Eye,
  FileCode2,
  History,
  LayoutGrid,
  Monitor,
  MoreHorizontal,
  MousePointer2,
  PanelLeftOpen,
  RotateCw,
  Scan,
  Smartphone,
  Tablet,
  Share2,
  Users,
  X,
} from "lucide-react";
import { useCloud } from "../store/cloud";
import { useComments } from "../store/comments";
import { MessageSquare } from "lucide-react";
import { HOME, useApp, type Mode, type Tab, type Viewport } from "../store/app";
import { popupMenu } from "../lib/menu";
import { IconButton } from "./IconButton";

const VIEWPORTS: { id: Viewport; label: string; shortcut: string; Icon: typeof Monitor }[] = [
  { id: "fit", label: "Fit window", shortcut: "⌘0", Icon: Scan },
  { id: "desktop", label: "Desktop · 1440", shortcut: "⌘1", Icon: Monitor },
  { id: "tablet", label: "Tablet · 768", shortcut: "⌘2", Icon: Tablet },
  { id: "mobile", label: "Mobile · 390", shortcut: "⌘3", Icon: Smartphone },
];

const MODES: { id: Mode; label: string; shortcut: string; Icon: typeof Eye }[] = [
  { id: "view", label: "Preview", shortcut: "⌥⌘1", Icon: Eye },
  { id: "visual", label: "Visual", shortcut: "⌥⌘2", Icon: MousePointer2 },
  { id: "code", label: "Code", shortcut: "⌥⌘3", Icon: Code2 },
];

function Segmented<T extends string>({
  items,
  value,
  onChange,
  labels,
}: {
  items: { id: T; label: string; shortcut: string; Icon: typeof Eye }[];
  value: T;
  onChange: (v: T) => void;
  labels?: boolean;
}) {
  return (
    <div className="flex items-center rounded-lg bg-hover p-0.5">
      {items.map(({ id, label, shortcut, Icon }) => (
        <button
          key={id}
          type="button"
          aria-label={label}
          aria-pressed={value === id}
          title={`${label}  ${shortcut}`}
          onClick={() => onChange(id)}
          className={clsx(
            "flex h-6 items-center justify-center gap-1.5 rounded-md text-[12px] font-medium transition-colors",
            labels ? "px-2" : "w-7",
            value === id
              ? "bg-surface text-ink shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.06)]"
              : "text-ink-3 hover:text-ink",
          )}
        >
          <Icon size={13.5} strokeWidth={1.85} />
          {labels && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}

function DocTab({ tab, active }: { tab: Tab; active: boolean }) {
  const status = useApp((s) => s.status[tab.id]);
  const { activate, closeTab } = useApp.getState();
  const unsaved = status === "dirty" || status === "saving" || status === "conflict";
  return (
    <div
      role="tab"
      aria-selected={active}
      title={tab.path}
      onMouseDown={(e) => e.button === 0 && activate(tab.id)}
      onAuxClick={(e) => e.button === 1 && void closeTab(tab.id)}
      className={clsx(
        "group flex h-8 min-w-[110px] max-w-[210px] shrink items-center gap-2 rounded-lg pl-2.5 pr-1 transition-colors",
        active ? "bg-surface text-ink shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.05)]" : "text-ink-2 hover:bg-hover hover:text-ink",
      )}
    >
      {tab.mode === "code" ? (
        <Code2 size={14} strokeWidth={1.75} className={clsx("shrink-0", active ? "text-accent" : "text-ink-3")} />
      ) : tab.mode === "visual" ? (
        <MousePointer2 size={14} strokeWidth={1.75} className={clsx("shrink-0", active ? "text-accent" : "text-ink-3")} />
      ) : (
        <FileCode2 size={14} strokeWidth={1.75} className={clsx("shrink-0", active ? "text-accent" : "text-ink-3")} />
      )}
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{tab.name}</span>
      <button
        type="button"
        aria-label={`Close ${tab.name}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => void closeTab(tab.id)}
        className="group/close relative flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink"
      >
        {unsaved && (
          <span className={clsx("h-2 w-2 rounded-full group-hover/close:hidden", status === "conflict" ? "bg-amber-500" : "bg-ink-3")} />
        )}
        <X
          size={12}
          strokeWidth={2}
          className={clsx(unsaved ? "hidden group-hover/close:block" : active ? "block" : "invisible group-hover:visible")}
        />
      </button>
    </div>
  );
}

const ROLE_NOTE = { owner: "", editor: "", commenter: "Can comment", viewer: "View only" } as const;

/** Who else is in this shared file right now. */
function Presence({ tabId }: { tabId: string }) {
  const peers = useApp((s) => s.presence[tabId]) ?? [];
  if (!peers.length) return null;
  const shown = peers.slice(0, 4);
  return (
    <div className="flex items-center -space-x-1.5 pr-1" title={peers.map((p) => p.name).join(", ") + " here now"}>
      {shown.map((p) => (
        <span
          key={p.clientId}
          className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-bg"
          style={{ background: p.color }}
        >
          {p.name.trim().slice(0, 1).toUpperCase()}
        </span>
      ))}
      {peers.length > shown.length && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-active text-[10px] font-semibold text-ink-2 ring-2 ring-bg">
          +{peers.length - shown.length}
        </span>
      )}
    </div>
  );
}

function CommentsButton({ tabId }: { tabId: string }) {
  const open = useComments((s) => s.panelOpen);
  const count = useComments((s) => s.byTab[tabId]?.threads.filter((t) => !t.resolved).length ?? 0);
  return (
    <button
      type="button"
      aria-label="Comments"
      aria-pressed={open}
      title="Comments  ⇧⌘M"
      onClick={() => useComments.getState().togglePanel()}
      className={clsx(
        "relative flex h-7 items-center gap-1 rounded-md px-1.5 text-ink-2 transition-colors hover:bg-hover hover:text-ink",
        open && "bg-active text-ink",
      )}
    >
      <MessageSquare size={15} strokeWidth={1.75} />
      {count > 0 && <span className="text-[11.5px] font-semibold tabular-nums">{count}</span>}
    </button>
  );
}

export function TabBar() {
  const tabs = useApp((s) => s.tabs);
  const activeId = useApp((s) => s.activeId);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const viewport = useApp((s) => s.viewport);
  const historyOpen = useApp((s) => s.historyOpen);
  const { activate, toggleSidebar, reload, reveal, openInBrowser, setViewport, setMode, toggleHistory } = useApp.getState();
  const active = tabs.find((t) => t.id === activeId);

  const moreMenu = () =>
    void popupMenu([
      { text: "Reload", action: () => reload() },
      { text: "Show in Finder", action: reveal },
      { text: "Open in Browser", action: openInBrowser },
    ]);

  return (
    <header
      data-tauri-drag-region
      className={clsx("flex h-[52px] shrink-0 items-center gap-1 border-b border-line bg-bg pr-2.5", sidebarOpen ? "pl-2" : "pl-[84px]")}
    >
      {!sidebarOpen && (
        <IconButton label="Show sidebar" shortcut="⌘\" onClick={toggleSidebar} className="mr-1">
          <PanelLeftOpen size={16} strokeWidth={1.75} />
        </IconButton>
      )}

      <div role="tablist" className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        <button
          type="button"
          role="tab"
          aria-selected={activeId === HOME}
          title="Library  ⇧⌘L"
          onMouseDown={(e) => e.button === 0 && activate(HOME)}
          className={clsx(
            "flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors",
            activeId === HOME ? "bg-surface text-ink shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.05)]" : "text-ink-2 hover:bg-hover hover:text-ink",
          )}
        >
          <LayoutGrid size={14} strokeWidth={1.75} className={activeId === HOME ? "text-accent" : "text-ink-3"} />
          Library
        </button>
        {tabs.length > 0 && <span className="mx-0.5 h-4 w-px shrink-0 bg-line-strong" />}
        {tabs.map((t) => (
          <DocTab key={t.id} tab={t} active={t.id === activeId} />
        ))}
      </div>

      <div data-tauri-drag-region className="h-full min-w-6 flex-1" />

      {active && (
        <div className="flex shrink-0 items-center gap-1.5">
          <Presence tabId={active.id} />
          {active.share && ROLE_NOTE[active.share.role] && (
            <span className="flex items-center gap-1 rounded-md bg-hover px-2 py-1 text-[11.5px] font-medium text-ink-2">
              <Users size={12} /> {ROLE_NOTE[active.share.role]}
            </span>
          )}
          {(!active.share || active.share.role === "owner") && (
            <button
              type="button"
              title="Share  ⇧⌘S"
              onClick={() => useCloud.getState().openShareDialog({ path: active.path, name: active.name })}
              className={clsx(
                "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors",
                active.share ? "border border-line-strong text-ink hover:bg-hover" : "bg-accent text-accent-fg hover:bg-accent-hover",
              )}
            >
              {active.share ? <Users size={13.5} strokeWidth={2} /> : <Share2 size={13.5} strokeWidth={2} />}
              {active.share ? "Shared" : "Share"}
            </button>
          )}
          <Segmented items={MODES} value={active.mode} onChange={(m) => void setMode(active.id, m)} labels />
          <span className="mx-0.5 h-4 w-px bg-line-strong" />
          <Segmented items={VIEWPORTS} value={viewport} onChange={setViewport} />
          {active.share && <CommentsButton tabId={active.id} />}
          <IconButton label="Version history" shortcut="⇧⌘H" active={historyOpen} onClick={toggleHistory}>
            <History size={15} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Reload" shortcut="⌘R" onClick={() => reload()}>
            <RotateCw size={15} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="More" onClick={moreMenu}>
            <MoreHorizontal size={16} strokeWidth={1.75} />
          </IconButton>
        </div>
      )}
    </header>
  );
}
