import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { FileCode2, MoreHorizontal, Star, Users } from "lucide-react";
import { useCloud } from "../../store/cloud";
import type { FileEntry, Tag } from "../../lib/ipc";
import { formatBytes, parentFolder, relativeTime } from "../../lib/format";
import { useLibrary } from "../../store/library";
import { Thumbnail } from "./Thumbnail";

function displayName(f: FileEntry) {
  return f.title && f.title !== f.name ? f.title : f.name;
}

/** Search excerpt with matches highlighted (\u0001 ... \u0002 from SQLite). */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/);
  return (
    <span className="line-clamp-2 text-[12px] leading-snug text-ink-2">
      {parts.map((p, i) =>
        p.startsWith("\u0001") ? (
          <mark key={i} className="rounded-[3px] bg-accent-soft px-0.5 text-ink">
            {p.slice(1, -1)}
          </mark>
        ) : (
          p
        ),
      )}
    </span>
  );
}

function SharedBadge({ path }: { path: string }) {
  const shared = useCloud((s) => s.overview?.links.some((l) => l.path === path && l.role === "owner"));
  if (!shared) return null;
  return (
    <span title="Shared" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-others text-others-fg">
      <Users size={10} strokeWidth={2.25} />
    </span>
  );
}

function TagDots({ ids, tags }: { ids: number[]; tags: Tag[] }) {
  const list = tags.filter((t) => ids.includes(t.id));
  if (!list.length) return null;
  return (
    <span className="flex shrink-0 items-center -space-x-0.5" title={list.map((t) => t.name).join(", ")}>
      {list.slice(0, 4).map((t) => (
        <span key={t.id} className="h-2 w-2 rounded-full ring-2 ring-bg" style={{ background: t.color }} />
      ))}
    </span>
  );
}

function RenameInput({ file }: { file: FileEntry }) {
  const rename = useLibrary((s) => s.rename);
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(file.name);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = file.name.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : file.name.length);
  }, [file.name]);
  return (
    <input
      ref={ref}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void rename(file, value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") void rename(file, value);
        if (e.key === "Escape") useLibrary.getState().startRename(null);
      }}
      className="w-full rounded-[5px] bg-surface px-1 py-0.5 text-[13px] font-medium text-ink outline-none ring-2 ring-accent"
    />
  );
}

/** Drag payload for library files (comma-separated ids), dropped on sidebar folders. */
export const FILE_DRAG = "application/x-quire-files";

function useFileActions(file: FileEntry) {
  const { openFile, fileMenu, select, clearSelection } = useLibrary.getState();
  const selected = useLibrary((s) => s.selected.includes(file.id));
  return {
    selected,
    props: {
      "aria-selected": selected,
      draggable: !file.trashedMs,
      onDragStart: (e: React.DragEvent) => {
        const { selected: ids } = useLibrary.getState();
        const dragged = ids.includes(file.id) ? ids : [file.id];
        e.dataTransfer.setData(FILE_DRAG, dragged.join(","));
        e.dataTransfer.effectAllowed = "copyMove";
      },
      onClick: (e: React.MouseEvent) => {
        if (e.metaKey || e.ctrlKey) return select(file, "toggle");
        if (e.shiftKey) return select(file, "range");
        clearSelection();
        openFile(file);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter") openFile(file);
        if (e.key === " ") {
          e.preventDefault();
          select(file, "toggle");
        }
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        fileMenu(file);
      },
    },
  };
}

function StarButton({ file, className }: { file: FileEntry; className?: string }) {
  return (
    <button
      type="button"
      aria-label={file.starred ? "Remove star" : "Star"}
      aria-pressed={file.starred}
      onClick={(e) => {
        e.stopPropagation();
        void useLibrary.getState().toggleStar(file);
      }}
      className={clsx(
        "flex items-center justify-center rounded-md transition",
        file.starred ? "text-accent" : "text-ink-3 opacity-0 group-hover:opacity-100 hover:text-ink",
        className,
      )}
    >
      <Star size={14} strokeWidth={1.75} fill={file.starred ? "currentColor" : "none"} />
    </button>
  );
}

export function FileCard({ file, tags }: { file: FileEntry; tags: Tag[] }) {
  const renaming = useLibrary((s) => s.renamingId === file.id);
  const { selected, props } = useFileActions(file);
  return (
    <div
      role="button"
      tabIndex={0}
      title={file.path}
      {...props}
      className={clsx("group rounded-xl p-1.5 outline-none transition-colors focus-visible:bg-hover", selected ? "bg-accent-soft" : "hover:bg-hover")}
    >
      <div
        className={clsx(
          "relative overflow-hidden rounded-lg transition-shadow",
          selected
            ? "shadow-[0_0_0_2px_var(--accent)]"
            : "shadow-[0_0_0_1px_var(--border),0_1px_3px_rgb(0_0_0/0.06)] group-hover:shadow-[0_0_0_1px_var(--border-strong),0_6px_20px_-6px_rgb(0_0_0/0.18)]",
        )}
      >
        <Thumbnail path={file.path} version={file.modifiedMs} disabled={!!file.trashedMs} />
        <StarButton
          file={file}
          className="absolute right-1.5 top-1.5 h-7 w-7 bg-surface/90 shadow-[0_0_0_1px_var(--border)] backdrop-blur"
        />
      </div>
      <div className="flex items-start gap-2 px-1 pb-0.5 pt-2.5">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <RenameInput file={file} />
          ) : (
            <div className="truncate text-[13px] font-medium text-ink">{displayName(file)}</div>
          )}
          {file.snippet ? (
            <Snippet text={file.snippet} />
          ) : (
            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-3">
              <span className="truncate">{file.title && file.title !== file.name ? file.name : parentFolder(file.path)}</span>
              <span>·</span>
              <span className="shrink-0">{relativeTime(file.trashedMs ?? file.modifiedMs)}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 pt-1">
          <SharedBadge path={file.path} />
          <TagDots ids={file.tagIds} tags={tags} />
          <button
            type="button"
            aria-label="More actions"
            onClick={(e) => {
              e.stopPropagation();
              useLibrary.getState().fileMenu(file);
            }}
            className="-mr-1 -mt-1 flex h-6 w-6 items-center justify-center rounded-md text-ink-3 opacity-0 hover:bg-active hover:text-ink group-hover:opacity-100"
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function FileRow({ file, tags }: { file: FileEntry; tags: Tag[] }) {
  const renaming = useLibrary((s) => s.renamingId === file.id);
  const { selected, props } = useFileActions(file);
  return (
    <div
      role="button"
      tabIndex={0}
      title={file.path}
      {...props}
      className={clsx(
        "group grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_110px_70px_28px] items-center gap-4 border-b border-line px-3 py-2 outline-none transition-colors last:border-0 focus-visible:bg-hover",
        selected ? "bg-accent-soft" : "hover:bg-hover",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <FileCode2 size={16} strokeWidth={1.6} className="shrink-0 text-ink-3" />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <RenameInput file={file} />
          ) : (
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] text-ink">{displayName(file)}</span>
              <SharedBadge path={file.path} />
              <TagDots ids={file.tagIds} tags={tags} />
            </div>
          )}
          {file.snippet ? (
            <Snippet text={file.snippet} />
          ) : (
            file.title &&
            file.title !== file.name && <div className="truncate text-[11.5px] text-ink-3">{file.name}</div>
          )}
        </div>
      </div>
      <span className="truncate text-[12px] text-ink-3">{parentFolder(file.path)}</span>
      <span className="text-[12px] text-ink-3">{relativeTime(file.trashedMs ?? file.modifiedMs)}</span>
      <span className="text-right text-[12px] tabular-nums text-ink-3">{formatBytes(file.sizeBytes)}</span>
      <StarButton file={file} className="h-6 w-6" />
    </div>
  );
}
