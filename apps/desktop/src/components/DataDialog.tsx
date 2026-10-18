import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { Database, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { errorMessage, ipc, type DataSource } from "../lib/ipc";
import { relativeTime } from "../lib/format";
import type { Tab } from "../store/app";

export const useDataDialog = create<{ tab: Tab | null; show: (tab: Tab) => void; close: () => void }>((set) => ({
  tab: null,
  show: (tab) => set({ tab }),
  close: () => set({ tab: null }),
}));

const INTERVALS = [
  { min: 5, label: "Every 5 minutes" },
  { min: 15, label: "Every 15 minutes" },
  { min: 60, label: "Every hour" },
  { min: 360, label: "Every 6 hours" },
  { min: 1440, label: "Every day" },
];

/** A file name guessed from a link: sales.csv, data.json… */
function guessName(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "docs.google.com") return "sheet.csv";
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    if (/\.(csv|tsv|json|txt)$/i.test(last)) return last.toLowerCase();
    return u.searchParams.get("format") === "csv" || u.searchParams.get("output") === "csv" ? "data.csv" : "data.json";
  } catch {
    return "";
  }
}

/** Connect a page to live CSV/JSON that Quire keeps fresh in data/<name>. */
export function DataDialog() {
  const tab = useDataDialog((s) => s.tab);
  const close = useDataDialog((s) => s.close);
  const [sources, setSources] = useState<DataSource[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [interval, setInterval] = useState(60);
  const [busy, setBusy] = useState<number | "add" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (tab) setSources(await ipc.listDataSources(tab.path));
  }, [tab]);

  useEffect(() => {
    setUrl("");
    setName("");
    setError(null);
    void load();
  }, [load]);

  if (!tab) return null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("add");
    setError(null);
    try {
      const src = await ipc.addDataSource(tab.path, url, name || guessName(url), interval);
      setUrl("");
      setName("");
      if (src.lastError) setError(src.lastError);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (id: number) => {
    setBusy(id);
    await ipc.refreshDataSource(id).catch((e) => setError(errorMessage(e)));
    await load();
    setBusy(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-labelledby="data-title" className="flex max-h-[80vh] w-full max-w-[560px] flex-col rounded-2xl border border-line bg-surface shadow-[0_24px_64px_-12px_rgb(0_0_0/0.35)]">
        <div className="flex items-start gap-3 px-6 pt-5">
          <Database size={18} className="mt-0.5 text-accent" />
          <div className="min-w-0 flex-1">
            <h2 id="data-title" className="text-[16px] font-semibold text-ink">Live data for “{tab.name}”</h2>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">
              Quire downloads each link into the page's <span className="font-mono">data/</span> folder and keeps it fresh. The page reads it with{" "}
              <span className="font-mono">fetch("data/…")</span>. Google Sheets links work if the sheet is shared with “Anyone with the link”.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={close} className="-mr-2 flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={add} className="space-y-2 px-6 pt-4">
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… (CSV or JSON, or a Google Sheets link)"
            className="h-8 w-full rounded-md border border-line-strong bg-bg px-2.5 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={guessName(url) || "sales.csv"}
              className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-bg px-2.5 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
            />
            <select value={interval} onChange={(e) => setInterval(Number(e.target.value))} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] text-ink">
              {INTERVALS.map((i) => (
                <option key={i.min} value={i.min}>
                  {i.label}
                </option>
              ))}
            </select>
            <button type="submit" disabled={!url.trim() || busy === "add"} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40">
              {busy === "add" && <Loader2 size={13} className="animate-spin" />} Connect
            </button>
          </div>
          {error && <p className="text-[12px] text-danger">{error}</p>}
        </form>

        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto px-6 py-3">
          {sources.length === 0 && <li className="py-4 text-center text-[12.5px] text-ink-3">No data connected yet.</li>}
          {sources.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[12.5px] text-ink">data/{s.name}</div>
                <div className="truncate text-[11.5px] text-ink-3" title={s.url}>
                  {s.lastError ? (
                    <span className="text-danger">{s.lastError}</span>
                  ) : (
                    <>
                      {INTERVALS.find((i) => i.min === s.intervalMin)?.label ?? `Every ${s.intervalMin} min`} · updated {s.lastFetchedMs ? relativeTime(s.lastFetchedMs) : "never"}
                    </>
                  )}
                </div>
              </div>
              <button type="button" aria-label="Refresh now" onClick={() => void refresh(s.id)} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
                <RefreshCw size={13} className={busy === s.id ? "animate-spin" : ""} />
              </button>
              <button
                type="button"
                aria-label="Disconnect"
                title="Stop refreshing (the last download stays)"
                onClick={() => void ipc.removeDataSource(s.id).then(load)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
