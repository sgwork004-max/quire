import clsx from "clsx";
import { useEffect, useRef } from "react";
import { ArrowDownUp, FolderPlus, LayoutGrid, List, Search, Trash2, X } from "lucide-react";
import { useLibrary, type LibraryView as View } from "../../store/library";
import { useApp } from "../../store/app";
import type { Overview, SortKey } from "../../lib/ipc";
import { popupMenu } from "../../lib/menu";
import { IconButton } from "../IconButton";
import { Logo } from "../Logo";
import { FileCard, FileRow } from "./FileItems";
import { SharedView } from "./SharedView";
import { InboxBanner } from "./InboxBanner";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "modified", label: "Last modified" },
  { id: "opened", label: "Last opened" },
  { id: "name", label: "Name" },
];

function viewTitle(view: View, overview: Overview | null): string {
  switch (view.kind) {
    case "all":
      return "All files";
    case "recent":
      return "Recent";
    case "starred":
      return "Starred";
    case "trash":
      return "Trash";
    case "shared":
      return "Shared with me";
    case "location":
      return overview?.locations.find((l) => l.id === view.id)?.name ?? "Folder";
    case "tag":
      return overview?.tags.find((t) => t.id === view.id)?.name ?? "Tag";
  }
}

export function LibraryView() {
  const { view, search, sort, layout, overview, files, loaded, searchFocus } = useLibrary();
  const { setSearch, setSort, setLayout, emptyTrash } = useLibrary.getState();
  const searchRef = useRef<HTMLInputElement>(null);
  const searching = search.trim().length > 0;
  const showList = layout === "list" || searching;

  useEffect(() => {
    if (searchFocus) searchRef.current?.select();
  }, [searchFocus]);

  const showSortMenu = () =>
    void popupMenu(SORTS.map((s) => ({ text: s.label, checked: sort === s.id, action: () => setSort(s.id) })));

  const tag = view.kind === "tag" ? overview?.tags.find((t) => t.id === view.id) : undefined;
  const location = view.kind === "location" ? overview?.locations.find((l) => l.id === view.id) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-8 pb-4 pt-6">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-[-0.015em] text-ink">
            {tag && <span className="h-3 w-3 rounded-full" style={{ background: tag.color }} />}
            <span className="truncate">{viewTitle(view, overview)}</span>
          </h1>
          <p className="mt-0.5 truncate text-[12px] text-ink-3" title={location?.path}>
            {view.kind === "shared"
              ? "Files other people shared with you. They stay in sync."
              : loaded
                ? `${files.length} file${files.length === 1 ? "" : "s"}`
                : "Loading…"}
            {location && ` · ${location.path}`}
            {view.kind === "trash" && " · Files are kept for 30 days"}
          </p>
        </div>

        <label className="flex h-8 w-[260px] items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5 text-ink-3 transition-shadow focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
          <Search size={14} strokeWidth={2} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSearch("")}
            placeholder="Search names and content"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
          {searching ? (
            <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="rounded p-0.5 hover:bg-hover hover:text-ink">
              <X size={13} />
            </button>
          ) : (
            <kbd className="font-sans text-[11px]">⌘K</kbd>
          )}
        </label>

        {view.kind === "shared" ? null : view.kind === "trash" ? (
          <button
            type="button"
            disabled={!files.length}
            onClick={() => void emptyTrash()}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[12.5px] font-medium text-ink transition-colors hover:bg-hover disabled:opacity-40"
          >
            <Trash2 size={14} strokeWidth={1.75} /> Empty Trash
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <IconButton label="Sort" onClick={showSortMenu} disabled={searching}>
              <ArrowDownUp size={15} strokeWidth={1.75} />
            </IconButton>
            <div className="flex items-center rounded-lg bg-hover p-0.5">
              {(["grid", "list"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-label={l === "grid" ? "Grid view" : "List view"}
                  aria-pressed={layout === l}
                  title={l === "grid" ? "Grid view" : "List view"}
                  onClick={() => setLayout(l)}
                  className={clsx(
                    "flex h-6 w-7 items-center justify-center rounded-md transition-colors",
                    layout === l ? "bg-surface text-ink shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.06)]" : "text-ink-3 hover:text-ink",
                  )}
                >
                  {l === "grid" ? <LayoutGrid size={14} strokeWidth={1.75} /> : <List size={14} strokeWidth={1.75} />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <InboxBanner />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        {view.kind === "shared" ? (
          <SharedView />
        ) : !loaded ? null : files.length === 0 ? (
          <EmptyView view={view} searching={searching} search={search} overview={overview} />
        ) : showList ? (
          <div className="mx-2 overflow-hidden rounded-xl border border-line bg-surface">
            {files.map((f) => (
              <FileRow key={f.id} file={f} tags={overview?.tags ?? []} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-3 gap-y-4">
            {files.map((f) => (
              <FileCard key={f.id} file={f} tags={overview?.tags ?? []} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyView({ view, searching, search, overview }: { view: View; searching: boolean; search: string; overview: Overview | null }) {
  const { addFolder } = useLibrary.getState();
  const { openDialog } = useApp.getState();

  if (searching) return <Message title={`No matches for “${search.trim()}”`} body="Search looks at file names, page titles and the text on each page." />;

  if (view.kind === "all" && !overview?.locations.length) {
    return (
      <div className="flex justify-center pt-[8vh]">
        <div className="w-full max-w-[420px] text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
            <Logo size={30} />
          </div>
          <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Your HTML, in one place</h2>
          <p className="mx-auto mt-1.5 max-w-[340px] text-[13px] leading-relaxed text-ink-2">
            Add the folders where your reports, dashboards and pages live. Quire finds every HTML file, keeps them in sync and makes them searchable.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => void addFolder()}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-medium text-accent-fg shadow-[0_1px_2px_rgb(0_0_0/0.12)] transition-colors hover:bg-accent-hover"
            >
              <FolderPlus size={15} strokeWidth={2} /> Add folder
            </button>
            <button
              type="button"
              onClick={() => void openDialog()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-[13px] font-medium text-ink transition-colors hover:bg-hover"
            >
              Open a file
            </button>
          </div>
          <p className="mt-4 text-[12px] text-ink-3">Or drop files and folders anywhere in this window.</p>
        </div>
      </div>
    );
  }

  const copy: Record<View["kind"], [string, string]> = {
    all: ["No HTML files yet", "Files in your folders show up here as soon as they're created."],
    recent: ["Nothing opened yet", "Files you open show up here."],
    starred: ["No starred files", "Star a file to keep it one click away."],
    trash: ["Trash is empty", "Files you delete stay here for 30 days."],
    location: ["No HTML files in this folder", "Quire is watching it. New files show up automatically."],
    shared: ["", ""],
    tag: ["Nothing tagged yet", "Right-click a file and choose Tags."],
  };
  const [title, body] = copy[view.kind];
  return <Message title={title} body={body} />;
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center pt-[12vh] text-center">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-[320px] text-[12.5px] leading-relaxed text-ink-3">{body}</p>
    </div>
  );
}
