import clsx from "clsx";
import { useState, type ReactNode } from "react";
import { Clock, Folder, FolderPlus, Library, PanelLeftClose, Plus, Star, Trash2, Users } from "lucide-react";
import { useCloud } from "../store/cloud";
import { HOME, useApp } from "../store/app";
import { useLibrary, type LibraryView } from "../store/library";
import { popupMenu } from "../lib/menu";
import type { Tag } from "../lib/ipc";
import { IconButton } from "./IconButton";
import { AccountButton } from "./Account";
import { NotificationsBell } from "./Notifications";

const same = (a: LibraryView, b: LibraryView) =>
  a.kind === b.kind && ("id" in a ? a.id : null) === ("id" in b ? b.id : null);

export function Sidebar() {
  const overview = useLibrary((s) => s.overview);
  const view = useLibrary((s) => s.view);
  const onHome = useApp((s) => s.activeId === HOME);
  const { setView, addFolder, folderMenu, newFile } = useLibrary.getState();
  const { toggleSidebar, openDialog } = useApp.getState();
  const [creatingTag, setCreatingTag] = useState(false);
  const sharedCount = useCloud((s) => s.overview?.documents.filter((d) => d.role !== "owner").length);

  const isActive = (v: LibraryView) => onHome && same(view, v);

  const showNewMenu = () =>
    void popupMenu([
      { text: "New HTML File", action: () => void newFile() },
      {
        text: "New from Template",
        items: [
          { text: "Dashboard", action: () => void newFile("dashboard") },
          { text: "Report", action: () => void newFile("report") },
          { text: "Landing page", action: () => void newFile("landing") },
          { text: "One-pager", action: () => void newFile("one-pager") },
        ],
      },
      { text: "Open File…", action: () => void openDialog() },
      null,
      { text: "Add Folder to Library…", action: () => void addFolder() },
    ]);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-sidebar">
      <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center justify-end px-2.5">
        <IconButton label="Hide sidebar" shortcut="⌘\" onClick={toggleSidebar}>
          <PanelLeftClose size={16} strokeWidth={1.75} />
        </IconButton>
      </div>

      <div className="px-2.5 pb-2">
        <button
          type="button"
          onClick={showNewMenu}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-medium text-ink shadow-[0_1px_1px_rgb(0_0_0/0.04)] transition-colors hover:bg-hover"
        >
          <Plus size={15} strokeWidth={2} className="text-accent" />
          New
          <kbd className="ml-auto font-sans text-[11px] text-ink-3">⌘N</kbd>
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 [scrollbar-width:thin]">
        <NavItem icon={<Library size={15} strokeWidth={1.75} />} label="All files" count={overview?.all} active={isActive({ kind: "all" })} onClick={() => setView({ kind: "all" })} />
        <NavItem icon={<Clock size={15} strokeWidth={1.75} />} label="Recent" active={isActive({ kind: "recent" })} onClick={() => setView({ kind: "recent" })} />
        <NavItem icon={<Users size={15} strokeWidth={1.75} />} label="Shared with me" count={sharedCount || undefined} active={isActive({ kind: "shared" })} onClick={() => setView({ kind: "shared" })} />
        <NavItem icon={<Star size={15} strokeWidth={1.75} />} label="Starred" count={overview?.starred || undefined} active={isActive({ kind: "starred" })} onClick={() => setView({ kind: "starred" })} />

        <Section title="Folders" action={{ label: "Add folder", onClick: () => void addFolder(), icon: <FolderPlus size={13} strokeWidth={2} /> }}>
          {overview?.locations.length ? (
            overview.locations.map((l) => (
              <NavItem
                key={l.id}
                icon={<Folder size={15} strokeWidth={1.75} />}
                label={l.name}
                title={l.path}
                count={l.count}
                active={isActive({ kind: "location", id: l.id })}
                onClick={() => setView({ kind: "location", id: l.id })}
                onContextMenu={() => folderMenu(l)}
              />
            ))
          ) : (
            <button
              type="button"
              onClick={() => void addFolder()}
              className="w-full rounded-md px-2 py-1.5 text-left text-[12px] leading-relaxed text-ink-3 hover:bg-hover hover:text-ink-2"
            >
              Add a folder and Quire keeps every HTML file in it organised.
            </button>
          )}
        </Section>

        <Section title="Tags" action={{ label: "New tag", onClick: () => setCreatingTag(true), icon: <Plus size={13} strokeWidth={2.25} /> }}>
          {overview?.tags.map((t) => <TagItem key={t.id} tag={t} active={isActive({ kind: "tag", id: t.id })} />)}
          {creatingTag && <TagInput onDone={() => setCreatingTag(false)} />}
          {!creatingTag && !overview?.tags.length && (
            <p className="px-2 py-1 text-[12px] text-ink-3">Group files across folders.</p>
          )}
        </Section>
      </nav>

      <div className="border-t border-line px-2 py-2">
        <NavItem icon={<Trash2 size={15} strokeWidth={1.75} />} label="Trash" count={overview?.trash || undefined} active={isActive({ kind: "trash" })} onClick={() => setView({ kind: "trash" })} />
        <div className="mt-1 flex items-center gap-1 border-t border-line pt-1">
          <div className="min-w-0 flex-1">
            <AccountButton />
          </div>
          <NotificationsBell />
        </div>
      </div>
    </aside>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action: { label: string; onClick: () => void; icon: ReactNode };
  children: ReactNode;
}) {
  return (
    <section className="mt-4">
      <div className="group flex h-6 items-center px-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {title}
        <button
          type="button"
          aria-label={action.label}
          title={action.label}
          onClick={action.onClick}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-ink-3 opacity-0 transition-opacity hover:bg-active hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
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
  onClick,
  onContextMenu,
}: {
  icon: ReactNode;
  label: ReactNode;
  count?: number;
  active: boolean;
  title?: string;
  onClick: () => void;
  onContextMenu?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        onContextMenu();
      }}
      className={clsx(
        "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors",
        active ? "bg-active font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
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

function TagItem({ tag, active }: { tag: Tag; active: boolean }) {
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
