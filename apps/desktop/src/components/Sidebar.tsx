import clsx from "clsx";
import { useState, type ReactNode } from "react";
import { Clock, Download, EyeOff, Folder, FolderPlus, HardDrive, Library, PanelLeftClose, PanelLeftOpen, Plus, Settings, Star, Trash2, Users } from "lucide-react";
import { useCloud } from "../store/cloud";
import { HOME, useApp } from "../store/app";
import { useLibrary, type DropTarget, type LibraryView } from "../store/library";
import type { Tag } from "../lib/ipc";
import { useSettings } from "../store/settings";
import { useImport } from "../store/import";
import { IconButton } from "./IconButton";
import { AccountButton } from "./Account";
import { NotificationsBell } from "./Notifications";
import { Logo, Wordmark } from "./Logo";

const same = (a: LibraryView, b: LibraryView) =>
  a.kind === b.kind && ("id" in a ? a.id : null) === ("id" in b ? b.id : null);

export function Sidebar() {
  const overview = useLibrary((s) => s.overview);
  const view = useLibrary((s) => s.view);
  const onHome = useApp((s) => s.activeId === HOME);
  const open = useApp((s) => s.sidebarOpen);
  const { setView, addFolder, folderMenu, newFolder, folderContextMenu } = useLibrary.getState();
  const { toggleSidebar } = useApp.getState();
  const [creatingTag, setCreatingTag] = useState(false);
  const sharedCount = useCloud((s) => s.overview?.documents.filter((d) => d.role !== "owner").length);
  const compact = !open;

  const isActive = (v: LibraryView) => onHome && same(view, v);
  const nav = (props: Omit<Parameters<typeof NavItem>[0], "compact">) => <NavItem compact={compact} {...props} />;

  return (
    // z-30 keeps the account and notification popovers above the open document.
    <aside className={clsx("paper relative z-30 flex shrink-0 flex-col border-r border-line bg-sidebar", compact ? "w-[78px]" : "w-60")}>
      {/* The window's traffic lights sit in this strip. */}
      <div data-tauri-drag-region className="flex h-[44px] shrink-0 items-start justify-end px-2.5 pt-[17px]">
        {!compact && (
          <IconButton label="Collapse sidebar" shortcut="⌘\" onClick={toggleSidebar}>
            <PanelLeftClose size={16} strokeWidth={1.75} />
          </IconButton>
        )}
      </div>
      <div data-tauri-drag-region className={clsx("shrink-0", compact ? "flex flex-col items-center gap-2 pb-2" : "px-4 pb-3 pt-1")}>
        {compact ? (
          <>
            <span title="Quire">
              <Logo size={30} />
            </span>
            <IconButton label="Expand sidebar" shortcut="⌘\" onClick={toggleSidebar}>
              <PanelLeftOpen size={16} strokeWidth={1.75} />
            </IconButton>
          </>
        ) : (
          <span className="pointer-events-none">
            <Wordmark size={24} />
          </span>
        )}
      </div>

      <div className={clsx("pb-2", compact ? "flex justify-center px-2" : "px-2.5")}>
        <button
          type="button"
          title={compact ? "Import HTML  ⇧⌘I" : undefined}
          aria-label="Import HTML"
          onClick={() => useImport.getState().show()}
          className={clsx(
            "flex h-8 items-center gap-2 rounded-lg border border-line-strong bg-surface text-[13px] font-medium text-ink shadow-[0_1px_1px_rgb(0_0_0/0.04)] transition-colors hover:bg-hover",
            compact ? "w-10 justify-center" : "w-full px-2.5",
          )}
        >
          <Download size={15} strokeWidth={2} className="text-accent" />
          {!compact && (
            <>
              Import
              <kbd className="ml-auto font-sans text-[11px] text-ink-3">⇧⌘I</kbd>
            </>
          )}
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 [scrollbar-width:thin]">
        {nav({ icon: <Library size={15} strokeWidth={1.75} />, label: "All files", count: overview?.all, active: isActive({ kind: "all" }), onClick: () => setView({ kind: "all" }) })}
        {nav({ icon: <Clock size={15} strokeWidth={1.75} />, label: "Recent", active: isActive({ kind: "recent" }), onClick: () => setView({ kind: "recent" }) })}
        {nav({ icon: <Users size={15} strokeWidth={1.75} />, label: "Shared with me", count: sharedCount || undefined, active: isActive({ kind: "shared" }), onClick: () => setView({ kind: "shared" }) })}
        {nav({ icon: <Star size={15} strokeWidth={1.75} />, label: "Starred", count: overview?.starred || undefined, active: isActive({ kind: "starred" }), onClick: () => setView({ kind: "starred" }) })}

        <Section compact={compact} title="Folders" action={{ label: "New folder", onClick: () => void newFolder(), icon: <FolderPlus size={13} strokeWidth={2} /> }}>
          {overview?.folders.map((f) => (
            <NavItem
              key={f.id}
              compact={compact}
              icon={<Folder size={15} strokeWidth={1.75} />}
              label={f.name}
              count={f.count || undefined}
              active={isActive({ kind: "folder", id: f.id })}
              onClick={() => setView({ kind: "folder", id: f.id })}
              onContextMenu={() => folderContextMenu(f)}
              dropTarget={{ kind: "folder", id: f.id }}
            />
          ))}
          {compact
            ? nav({ icon: <FolderPlus size={15} strokeWidth={1.75} />, label: "New folder", active: false, onClick: () => void newFolder() })
            : !overview?.folders.length && (
                <button type="button" onClick={() => void newFolder()} className="w-full rounded-md px-2 py-1.5 text-left text-[12px] leading-relaxed text-ink-3 hover:bg-hover hover:text-ink-2">
                  New folder. Drag files into it to keep projects together.
                </button>
              )}
        </Section>

        <Section compact={compact} title="Tags" action={{ label: "New tag", onClick: () => setCreatingTag(true), icon: <Plus size={13} strokeWidth={2.25} /> }}>
          {overview?.tags.map((t) => <TagItem key={t.id} tag={t} compact={compact} active={isActive({ kind: "tag", id: t.id })} />)}
          {creatingTag && !compact && <TagInput onDone={() => setCreatingTag(false)} />}
          {!creatingTag && !compact && !overview?.tags.length && <p className="px-2 py-1 text-[12px] text-ink-3">Group files across folders.</p>}
        </Section>

        <Section compact={compact} title="On this Mac" action={{ label: "Watch a folder on this Mac", onClick: () => void addFolder(), icon: <Plus size={13} strokeWidth={2.25} /> }}>
          {overview?.locations.map((l) => (
            <NavItem
              key={l.id}
              compact={compact}
              icon={<HardDrive size={15} strokeWidth={1.75} />}
              label={l.name}
              title={l.path}
              count={l.count}
              active={isActive({ kind: "location", id: l.id })}
              onClick={() => setView({ kind: "location", id: l.id })}
              onContextMenu={() => folderMenu(l)}
            />
          ))}
        </Section>
      </nav>

      <div className="border-t border-line px-2 py-2">
        {nav({ icon: <EyeOff size={15} strokeWidth={1.75} />, label: "Hidden", count: overview?.hidden || undefined, active: isActive({ kind: "hidden" }), onClick: () => setView({ kind: "hidden" }) })}
        {nav({ icon: <Trash2 size={15} strokeWidth={1.75} />, label: "Trash", count: overview?.trash || undefined, active: isActive({ kind: "trash" }), onClick: () => setView({ kind: "trash" }) })}
        <div className={clsx("mt-1 flex items-center gap-0.5 border-t border-line pt-1", compact && "flex-col")}>
          <div className={clsx("min-w-0", !compact && "flex-1")}>
            <AccountButton compact={compact} />
          </div>
          <NotificationsBell />
          <IconButton label="Settings" shortcut="⌘," onClick={() => useSettings.getState().show()} className="h-9 w-9">
            <Settings size={16} strokeWidth={1.75} />
          </IconButton>
        </div>
      </div>
    </aside>
  );
}

function Section({
  title,
  action,
  compact,
  children,
}: {
  title: string;
  action: { label: string; onClick: () => void; icon: ReactNode };
  compact: boolean;
  children: ReactNode;
}) {
  if (compact) return <section className="mt-2 space-y-px border-t border-line pt-2">{children}</section>;
  return (
    <section className="mt-4">
      <div className="group flex h-6 items-center px-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {title}
        <button
          type="button"
          aria-label={action.label}
          title={action.label}
          onClick={action.onClick}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-ink-3 opacity-60 transition-opacity hover:bg-active hover:text-ink hover:opacity-100 group-hover:opacity-100"
        >
          {action.icon}
        </button>
      </div>
      <div className="space-y-px">{children}</div>
    </section>
  );
}

function NavItem({
  icon,
  label,
  count,
  active,
  title,
  compact,
  dropTarget,
  onClick,
  onContextMenu,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  active: boolean;
  title?: string;
  compact?: boolean;
  /** Folder or tag that accepts files dragged from the library or Finder. */
  dropTarget?: DropTarget;
  onClick: () => void;
  onContextMenu?: () => void;
}) {
  // Library files are dropped here by lib/fileDrag.ts; Finder files by App.tsx. Both find the target through data-drop.
  const drop = dropTarget ? { "data-drop": `${dropTarget.kind}:${dropTarget.id}`, "data-label": label } : {};
  if (compact) {
    return (
      <button
        type="button"
        title={count !== undefined ? `${label} (${count})` : label}
        aria-label={label}
        onClick={onClick}
        onContextMenu={(e) => {
          if (!onContextMenu) return;
          e.preventDefault();
          onContextMenu();
        }}
        {...drop}
        className={clsx(
          "relative mx-auto flex h-8 w-9 items-center justify-center rounded-md transition-colors",
          active ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-hover hover:text-ink",
          "data-[drop-hover]:bg-accent-soft data-[drop-hover]:ring-2 data-[drop-hover]:ring-accent",
        )}
      >
        {icon}
      </button>
    );
  }
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      {...drop}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        onContextMenu();
      }}
      className={clsx(
        "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors",
        active ? "bg-accent-soft font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
        "data-[drop-hover]:bg-accent-soft data-[drop-hover]:ring-2 data-[drop-hover]:ring-accent",
      )}
    >
      <span className={clsx("shrink-0", active ? "text-accent" : "text-ink-3")}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[11px] tabular-nums text-ink-3">{count}</span>}
    </button>
  );
}

function TagDot({ color }: { color: string }) {
  return <span className="block h-2.5 w-2.5 rounded-full" style={{ background: color }} />;
}

function TagItem({ tag, active, compact }: { tag: Tag; active: boolean; compact: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const { setView, tagMenu, updateTag } = useLibrary.getState();
  if (renaming) {
    return (
      <InlineInput
        icon={<TagDot color={tag.color} />}
        initial={tag.name}
        onSubmit={(name) => void updateTag(tag, { name })}
        onDone={() => setRenaming(false)}
      />
    );
  }
  return (
    <NavItem
      compact={compact}
      dropTarget={{ kind: "tag", id: tag.id }}
      icon={<span className="flex h-[15px] w-[15px] items-center justify-center"><TagDot color={tag.color} /></span>}
      label={tag.name}
      count={tag.count}
      active={active}
      onClick={() => setView({ kind: "tag", id: tag.id })}
      onContextMenu={() => tagMenu(tag, () => setRenaming(true))}
    />
  );
}

function TagInput({ onDone }: { onDone: () => void }) {
  const createTag = useLibrary((s) => s.createTag);
  return (
    <InlineInput
      icon={<TagDot color="var(--text-3)" />}
      initial=""
      placeholder="Tag name"
      onSubmit={(name) => void createTag(name)}
      onDone={onDone}
    />
  );
}

function InlineInput({
  icon,
  initial,
  placeholder,
  onSubmit,
  onDone,
}: {
  icon: ReactNode;
  initial: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(initial);
  const commit = () => {
    if (value.trim() && value.trim() !== initial) onSubmit(value.trim());
    onDone();
  };
  return (
    <div className="flex h-7 items-center gap-2 rounded-md bg-surface px-2 shadow-[0_0_0_1px_var(--accent)]">
      <span className="flex h-[15px] w-[15px] shrink-0 items-center justify-center">{icon}</span>
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onDone();
        }}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
      />
    </div>
  );
}
