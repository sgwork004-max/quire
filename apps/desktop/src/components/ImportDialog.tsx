import clsx from "clsx";
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, FileCode2, Folder, Loader2, Monitor, Plus, X } from "lucide-react";
import { errorMessage, ipc, type ImportCandidate } from "../lib/ipc";
import { savePref } from "../lib/prefs";
import { useApp } from "../store/app";
import { useLibrary } from "../store/library";
import { useImport } from "../store/import";

interface Source {
  path: string;
  label: string;
  kind: "downloads" | "desktop" | "documents" | "folder";
  on: boolean;
}

const ICONS = { downloads: Download, desktop: Monitor, documents: Folder, folder: Folder };
const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

/** Import HTML: pick where to look (folders, files) and where the copies go, every time. */
export function ImportDialog() {
  const isOpen = useImport((s) => s.open);
  return isOpen ? <ImportPanel /> : null;
}

function ImportPanel() {
  const hide = useImport((s) => s.hide);
  const overview = useLibrary((s) => s.overview);
  const locations = overview?.locations ?? [];
  const [sources, setSources] = useState<Source[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [found, setFound] = useState<ImportCandidate[] | null>(null);
  const [inbox, setInbox] = useState("");
  const [dest, setDest] = useState("");
  const [auto, setAuto] = useState(true);
  const [autoWas, setAutoWas] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ipc.inboxStatus().then((s) => {
      setInbox(s.inbox);
      setDest(s.inbox);
      setAuto(s.enabled);
      setAutoWas(s.enabled);
      setSources([
        { path: s.downloads, label: "Downloads", kind: "downloads", on: true },
        { path: s.desktop, label: "Desktop", kind: "desktop", on: true },
        { path: s.documents, label: "Documents", kind: "documents", on: false },
      ]);
    });
  }, []);

  // Rescan whenever the chosen sources change.
  useEffect(() => {
    const folders = sources.filter((s) => s.on).map((s) => s.path);
    if (!folders.length && !files.length) return setFound([]);
    setFound(null);
    let stale = false;
    void ipc
      .importScan(folders, files)
      .then((r) => !stale && setFound(r))
      .catch((e) => !stale && setError(errorMessage(e)));
    return () => {
      stale = true;
    };
  }, [sources, files]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hide]);

  const addFolders = async () => {
    const picked = await open({ directory: true, multiple: true, title: "Choose folders to import HTML from" });
    const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
    setSources((s) => [
      ...s,
      ...list.filter((p) => !s.some((x) => x.path === p)).map((p) => ({ path: p, label: p.split(/[\\/]/).pop() || p, kind: "folder" as const, on: true })),
    ]);
  };

  const addFiles = async () => {
    const picked = await open({ multiple: true, title: "Choose HTML files to import", filters: [{ name: "HTML", extensions: ["html", "htm"] }] });
    const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
    setFiles((f) => [...new Set([...f, ...list])]);
  };

  const run = async () => {
    if (!found?.length) return;
    setBusy(true);
    setError(null);
    try {
      if (auto !== autoWas) await ipc.setInboxEnabled(auto).catch(() => undefined);
      const r = await ipc.importPaths(
        found.map((f) => f.path),
        dest === inbox ? null : dest,
      );
      savePref("inboxBannerDismissed", true);
      useLibrary.setState({ inboxBanner: null });
      void useLibrary.getState().refresh();
      const parts = [r.added && `${r.added} added`, r.updated && `${r.updated} updated`, r.unchanged && `${r.unchanged} already in Quire`].filter(Boolean);
      useApp.getState().toast(`Import done: ${parts.join(", ") || "nothing to import"}`);
      hide();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const destinations = [{ path: inbox, name: "Quire › Inbox" }, ...locations.filter((l) => l.path !== inbox).map((l) => ({ path: l.path, name: l.name }))];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && hide()}>
      <div role="dialog" aria-modal="true" aria-labelledby="import-title" className="flex max-h-[84vh] w-full max-w-[520px] flex-col rounded-2xl border border-line bg-surface shadow-[0_24px_64px_-12px_rgb(0_0_0/0.35)]">
        <div className="flex items-start gap-3 px-6 pt-5">
          <div className="min-w-0 flex-1">
            <h2 id="import-title" className="font-display text-[19px] font-bold tracking-[-0.02em] text-ink">Import HTML</h2>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">Quire copies the HTML it finds. Your original files stay where they are.</p>
          </div>
          <button type="button" aria-label="Close" onClick={hide} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4">
          <h3 className="mb-1.5 text-[11.5px] font-semibold text-ink-2">Look in</h3>
          <ul className="overflow-hidden rounded-xl border border-line">
            {sources.map((s, i) => {
              const Icon = ICONS[s.kind];
              return (
                <li key={s.path} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
                  <input
                    type="checkbox"
                    checked={s.on}
                    onChange={(e) => setSources((all) => all.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
                    className="accent-[var(--accent)]"
                    aria-label={`Look in ${s.label}`}
                  />
                  <Icon size={15} className="shrink-0 text-ink-3" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-ink">{s.label}</div>
                    <div className="truncate text-[11px] text-ink-3">{home(s.path)}</div>
                  </div>
                  {s.kind === "folder" && (
                    <button type="button" aria-label={`Remove ${s.label}`} onClick={() => setSources((all) => all.filter((_, j) => j !== i))} className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
                      <X size={13} />
                    </button>
                  )}
                </li>
              );
            })}
            {files.map((f) => (
              <li key={f} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
                <FileCode2 size={15} className="ml-[22px] shrink-0 text-ink-3" />
                <div className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{home(f)}</div>
                <button type="button" aria-label="Remove file" onClick={() => setFiles((all) => all.filter((x) => x !== f))} className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void addFolders()} className="flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[12px] text-ink hover:bg-hover">
              <Plus size={13} /> Folders…
            </button>
            <button type="button" onClick={() => void addFiles()} className="flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[12px] text-ink hover:bg-hover">
              <Plus size={13} /> Files…
            </button>
          </div>

          <label className="mt-5 flex items-center gap-3">
            <span className="text-[11.5px] font-semibold text-ink-2">Put copies in</span>
            <select value={dest} onChange={(e) => setDest(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] text-ink outline-none focus:border-accent">
              {destinations.map((d) => (
                <option key={d.path} value={d.path}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 flex items-start gap-2.5 text-[12.5px] leading-snug text-ink-2">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
            <span>Keep importing new HTML from Downloads and Desktop automatically (into Quire › Inbox)</span>
          </label>
          {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
        </div>

        <div className="mt-5 flex items-center gap-3 border-t border-line px-6 py-4">
          <span className={clsx("flex-1 text-[12.5px]", found?.length ? "text-ink-2" : "text-ink-3")}>
            {found === null ? (
              <span className="flex items-center gap-1.5">
                <Loader2 size={13} className="animate-spin" /> Looking for HTML…
              </span>
            ) : found.length ? (
              `Found ${found.length.toLocaleString()} HTML file${found.length === 1 ? "" : "s"}`
            ) : (
              "No HTML files in the chosen places"
            )}
          </span>
          <button type="button" onClick={hide} className="h-8 rounded-lg px-3 text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink">
            Cancel
          </button>
          <button
            type="button"
            disabled={!found?.length || busy}
            onClick={() => void run()}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-4 text-[12.5px] font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            Import{found?.length ? ` ${found.length.toLocaleString()}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
