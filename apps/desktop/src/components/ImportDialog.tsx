import clsx from "clsx";
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, Eye, FileCode2, Folder, FolderOpen, Loader2, Monitor, Plus, Tag as TagIcon, X } from "lucide-react";
import { errorMessage, ipc, type ImportCandidate, type ImportSource } from "../lib/ipc";
import { popupMenu } from "../lib/menu";
import { savePref } from "../lib/prefs";
import { useApp } from "../store/app";
import { useImport } from "../store/import";
import { useLibrary } from "../store/library";
import { useSettings } from "../store/settings";
import { usePrompt } from "./PromptDialog";
import { Logo } from "./Logo";

/** One thing to import: a folder (optionally watched for new files) or a set of files. */
interface Row {
  key: string;
  kind: "folder" | "files";
  label: string;
  paths: string[];
  found: ImportCandidate[] | null;
  watch: boolean;
  folderId: number | null;
  tagIds: number[];
}

const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~").replace(/^C:\\Users\\[^\\]+/i, "~");
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
let seq = 0;

/**
 * Import HTML, and Quire's first-run onboarding. Everything is chosen with the
 * system file picker, which macOS counts as permission, so Quire never shows
 * a wall of "would like to access…" prompts and never reads anything you
 * didn't pick.
 */
export function ImportDialog() {
  const mode = useImport((s) => s.mode);
  return mode ? <ImportFlow onboarding={mode === "onboarding"} /> : null;
}

function ImportFlow({ onboarding }: { onboarding: boolean }) {
  const hide = useImport((s) => s.hide);
  const overview = useLibrary((s) => s.overview);
  const [step, setStep] = useState<"welcome" | "choose" | "done">(onboarding ? "welcome" : "choose");
  const [rows, setRows] = useState<Row[]>([]);
  const [places, setPlaces] = useState<{ downloads: string; desktop: string; documents: string } | null>(null);
  const [existing, setExisting] = useState<ImportSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; updated: number; watching: number } | null>(null);
  const folders = overview?.folders ?? [];
  const tags = overview?.tags ?? [];

  useEffect(() => {
    void ipc.inboxStatus().then((s) => {
      setPlaces(s);
      setExisting(s.sources);
    });
  }, []);

  const finish = () => {
    if (onboarding) savePref("onboarded", true);
    hide();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !usePrompt.getState().request && finish();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const update = (key: string, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const scan = (row: Row) =>
    void ipc
      .importScan(row.kind === "folder" ? row.paths : [], row.kind === "files" ? row.paths : [])
      .then((found) => update(row.key, { found }))
      .catch((e) => {
        update(row.key, { found: [] });
        setError(errorMessage(e));
      });

  const addRows = (fresh: Row[]) => {
    const known = new Set(rows.flatMap((r) => r.paths));
    const add = fresh.filter((r) => !r.paths.every((p) => known.has(p)));
    setRows((all) => [...all, ...add]);
    add.forEach(scan);
  };

  /** Opens the system picker (at `start`, if given). Picking is macOS's permission, so no extra prompts. */
  const pickFolders = async (start?: string) => {
    const picked = await open({ directory: true, multiple: true, defaultPath: start, title: "Choose folders with HTML files" });
    const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
    // A well-known folder (Downloads, Desktop) is where AI tools save files, so watch it by default.
    const watched = new Set([places?.downloads, places?.desktop]);
    addRows(list.map((p) => ({ key: `r${++seq}`, kind: "folder", label: baseName(p), paths: [p], found: null, watch: watched.has(p), folderId: null, tagIds: [] })));
  };

  const pickFiles = async () => {
    const picked = await open({ multiple: true, title: "Choose HTML files", filters: [{ name: "HTML", extensions: ["html", "htm"] }] });
    const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (list.length)
      addRows([{ key: `r${++seq}`, kind: "files", label: list.length === 1 ? baseName(list[0]) : `${list.length} files`, paths: list, found: null, watch: false, folderId: null, tagIds: [] }]);
  };

  const folderMenu = (row: Row) =>
    void popupMenu([
      { text: "No folder", checked: row.folderId === null, action: () => update(row.key, { folderId: null }) },
      ...(folders.length ? [null] : []),
      ...folders.map((f) => ({ text: f.name, checked: row.folderId === f.id, action: () => update(row.key, { folderId: f.id }) })),
      null,
      {
        text: "New Folder…",
        action: () =>
          void usePrompt
            .getState()
            .ask("New Folder", { label: "Folder name" })
            .then(async (name) => {
              if (!name) return;
              try {
                const id = await ipc.createFolder(name);
                await useLibrary.getState().refresh();
                update(row.key, { folderId: id });
              } catch (e) {
                setError(errorMessage(e));
              }
            }),
      },
    ]);

  const tagMenu = (row: Row) =>
    void popupMenu([
      ...tags.map((t) => ({
        text: t.name,
        checked: row.tagIds.includes(t.id),
        action: () => update(row.key, { tagIds: row.tagIds.includes(t.id) ? row.tagIds.filter((x) => x !== t.id) : [...row.tagIds, t.id] }),
      })),
      ...(tags.length ? [null] : []),
      {
        text: "New Tag…",
        action: () =>
          void usePrompt
            .getState()
            .ask("New Tag", { label: "Tag name" })
            .then(async (name) => {
              if (!name) return;
              const id = await useLibrary.getState().createTag(name);
              if (id !== null) update(row.key, { tagIds: [...row.tagIds, id] });
            }),
      },
    ]);

  const total = rows.reduce((n, r) => n + (r.found?.length ?? 0), 0);
  const scanning = rows.some((r) => r.found === null);
  const watching = rows.filter((r) => r.kind === "folder" && r.watch);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      let added = 0;
      let updated = 0;
      for (const r of rows) {
        if (!r.found?.length) continue;
        const res = await ipc.importPaths(
          r.found.map((f) => f.path),
          null,
          r.folderId,
          r.tagIds,
        );
        added += res.added;
        updated += res.updated;
      }
      if (watching.length) {
        const next = [...existing.filter((s) => !watching.some((w) => w.paths[0] === s.path)), ...watching.map((w) => ({ path: w.paths[0], folderId: w.folderId, tagIds: w.tagIds }))];
        await ipc.setImportSources(next);
      }
      void useLibrary.getState().refresh();
      if (onboarding) {
        setResult({ added, updated, watching: watching.length });
        setStep("done");
      } else {
        const parts = [added && `${added} added`, updated && `${updated} updated`].filter(Boolean);
        useApp.getState().toast(`Imported: ${parts.join(", ") || "nothing new"}${watching.length ? ". New files will keep arriving." : ""}`);
        hide();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const quick = places
    ? [
        { label: "Downloads", icon: Download, path: places.downloads, hint: "Where AI chats save files" },
        { label: "Desktop", icon: Monitor, path: places.desktop },
        { label: "Documents", icon: Folder, path: places.documents },
      ]
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-[2px]">
      <div role="dialog" aria-modal="true" aria-labelledby="import-title" className="flex max-h-[88vh] w-full max-w-[640px] flex-col rounded-2xl border border-line bg-surface shadow-[0_24px_64px_-12px_rgb(0_0_0/0.35)]">
        {step === "welcome" && (
          <div className="px-10 pb-9 pt-10 text-center">
            <div className="mx-auto w-fit drop-shadow-[0_6px_14px_rgb(20_23_28/0.18)]">
              <Logo size={60} />
            </div>
            <h2 id="import-title" className="mt-5 font-display text-[28px] font-bold tracking-[-0.025em] text-ink">
              Welcome to Quire
            </h2>
            <p className="mx-auto mt-2 max-w-[420px] text-[14px] leading-relaxed text-ink-2">
              Bring in your HTML files and organise them your way. Quire only looks in the places you choose.
            </p>
            <div className="mt-7 flex justify-center gap-2">
              <button type="button" onClick={finish} className="h-10 rounded-lg px-4 text-[13.5px] text-ink-2 hover:bg-hover hover:text-ink">
                Skip for now
              </button>
              <button type="button" autoFocus onClick={() => setStep("choose")} className="h-10 rounded-lg bg-accent px-5 text-[13.5px] font-medium text-accent-fg hover:bg-accent-hover">
                Choose files to import
              </button>
            </div>
          </div>
        )}

        {step === "choose" && (
          <>
            <div className="flex items-start gap-3 px-6 pt-5">
              <div className="min-w-0 flex-1">
                <h2 id="import-title" className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">
                  {onboarding ? "What should Quire bring in?" : "Import HTML"}
                </h2>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">Pick places or files, then choose a folder and tags for each. Quire copies them; originals stay put.</p>
              </div>
              <button type="button" aria-label="Close" onClick={finish} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
                <X size={15} />
              </button>
            </div>

            <div className="flex flex-wrap gap-2 px-6 pt-4">
              {quick.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  title={q.hint}
                  onClick={() => void pickFolders(q.path)}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[12.5px] text-ink hover:bg-hover"
                >
                  <q.icon size={14} className="text-ink-3" /> {q.label}
                </button>
              ))}
              <button type="button" onClick={() => void pickFolders()} className="flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[12.5px] text-ink hover:bg-hover">
                <FolderOpen size={14} className="text-ink-3" /> Another folder…
              </button>
              <button type="button" onClick={() => void pickFiles()} className="flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[12.5px] text-ink hover:bg-hover">
                <FileCode2 size={14} className="text-ink-3" /> Files…
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4">
              {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-[12.5px] leading-relaxed text-ink-3">
                  Choose a place above. macOS opens it in a picker; click <b className="text-ink-2">Open</b> to let Quire look there.
                </div>
              ) : (
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                  {rows.map((r) => {
                    const folder = folders.find((f) => f.id === r.folderId);
                    const rowTags = tags.filter((t) => r.tagIds.includes(t.id));
                    return (
                      <li key={r.key} className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {r.kind === "folder" ? <Folder size={16} className="shrink-0 text-ink-3" /> : <FileCode2 size={16} className="shrink-0 text-ink-3" />}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium text-ink">{r.label}</div>
                            <div className="truncate text-[11px] text-ink-3">
                              {r.kind === "folder" ? home(r.paths[0]) : "Chosen files"} ·{" "}
                              {r.found === null ? "looking…" : `${r.found.length} HTML file${r.found.length === 1 ? "" : "s"}`}
                            </div>
                          </div>
                          <button type="button" aria-label={`Remove ${r.label}`} onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))} className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
                            <X size={13} />
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[26px]">
                          <button type="button" onClick={() => folderMenu(r)} className={clsx("flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px]", folder ? "border-accent/50 bg-accent-soft text-ink" : "border-line-strong text-ink-2 hover:bg-hover")}>
                            <Folder size={12.5} /> {folder ? folder.name : "Add to folder"}
                          </button>
                          <button type="button" onClick={() => tagMenu(r)} className={clsx("flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px]", rowTags.length ? "border-accent/50 bg-accent-soft text-ink" : "border-line-strong text-ink-2 hover:bg-hover")}>
                            {rowTags.length ? (
                              <>
                                {rowTags.map((t) => (
                                  <span key={t.id} className="h-2 w-2 rounded-full" style={{ background: t.color }} />
                                ))}
                                {rowTags.map((t) => t.name).join(", ")}
                              </>
                            ) : (
                              <>
                                <TagIcon size={12.5} /> Tag
                              </>
                            )}
                          </button>
                          {r.kind === "folder" && (
                            <label className="ml-auto flex cursor-default items-center gap-1.5 text-[12px] text-ink-2" title="Files saved here later are imported automatically, into the same folder and tags">
                              <input type="checkbox" checked={r.watch} onChange={(e) => update(r.key, { watch: e.target.checked })} className="accent-[var(--accent)]" />
                              <Eye size={12.5} className="text-ink-3" /> Keep importing new files
                            </label>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
            </div>

            <div className="mt-5 flex items-center gap-3 border-t border-line px-6 py-4">
              <span className="flex-1 text-[12.5px] text-ink-2">
                {scanning ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={13} className="animate-spin" /> Looking for HTML…
                  </span>
                ) : rows.length ? (
                  `${total.toLocaleString()} file${total === 1 ? "" : "s"} to import`
                ) : null}
              </span>
              {onboarding && (
                <button type="button" onClick={finish} className="h-8 rounded-lg px-3 text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink">
                  Skip
                </button>
              )}
              <button
                type="button"
                disabled={busy || scanning || (total === 0 && watching.length === 0)}
                onClick={() => void run()}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-4 text-[12.5px] font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
              >
                {busy && <Loader2 size={13} className="animate-spin" />}
                {total ? `Import ${total.toLocaleString()}` : "Save"}
              </button>
            </div>
          </>
        )}

        {step === "done" && result && (
          <div className="px-10 pb-9 pt-10 text-center">
            <h2 id="import-title" className="font-display text-[26px] font-bold tracking-[-0.025em] text-ink">
              You're all set
            </h2>
            <p className="mx-auto mt-2 max-w-[420px] text-[14px] leading-relaxed text-ink-2">
              {result.added + result.updated
                ? `${(result.added + result.updated).toLocaleString()} file${result.added + result.updated === 1 ? "" : "s"} imported.`
                : "Nothing to import yet."}{" "}
              {result.watching ? "New HTML saved to the places you chose will appear on its own." : "Use Import in the sidebar whenever you want more."}
            </p>
            <div className="mx-auto mt-6 grid max-w-[380px] gap-2 text-left">
              <button
                type="button"
                onClick={() => {
                  finish();
                  useSettings.getState().show();
                }}
                className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 hover:bg-hover"
              >
                <Plus size={16} className="text-accent" />
                <span className="text-[13px] text-ink">
                  Connect Claude <span className="text-ink-3">· it saves pages straight into Quire</span>
                </span>
              </button>
            </div>
            <button type="button" autoFocus onClick={finish} className="mt-6 h-10 rounded-lg bg-accent px-6 text-[13.5px] font-medium text-accent-fg hover:bg-accent-hover">
              Open my library
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
