import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { useApp, type Tab } from "../../store/app";
import { getSession } from "../../editor/session";
import { lineDiff } from "../../editor/diff";
import { errorMessage, ipc, type DocumentInfo } from "../../lib/ipc";
import { DiffLines } from "./DiffLines";

/** Compares an old version with the current file and lets the user restore it. */
export function VersionView({ tab, versionId, onClose }: { tab: Tab; versionId: number; onClose: () => void }) {
  const [view, setView] = useState<"changes" | "preview">("changes");
  const [old, setOld] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocumentInfo | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOld(null);
    void ipc.versionContent(versionId).then((c) => !cancelled && setOld(c));
    const session = getSession(tab.id);
    if (session) setCurrent(session.text);
    else void ipc.readDocument(tab.id).then((d) => !cancelled && setCurrent(d.content));
    return () => {
      cancelled = true;
    };
  }, [versionId, tab.id]);

  useEffect(() => {
    if (view !== "preview") return;
    let doc: DocumentInfo | null = null;
    void ipc.previewVersion(versionId).then((d) => {
      doc = d;
      setPreview(d);
    });
    return () => {
      setPreview(null);
      if (doc) void ipc.closeDocument(doc.id);
    };
  }, [view, versionId]);

  const diff = useMemo(() => (old !== null && current !== null ? lineDiff(old, current) : null), [old, current]);

  const restore = async () => {
    setRestoring(true);
    try {
      const content = await ipc.restoreVersion(tab.id, versionId);
      const session = getSession(tab.id);
      if (session) session.loadFromDisk(content);
      else useApp.getState().reload(tab.id);
      useApp.getState().toast("Version restored. The previous state is still in history.");
      onClose();
    } catch (e) {
      useApp.getState().toast(`Couldn't restore: ${errorMessage(e)}`);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-bg">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
        <span className="text-[13px] font-semibold text-ink">Comparing with current</span>
        {diff && (
          <span className="text-[12px] tabular-nums text-ink-3">
            <span className="text-emerald-600">+{diff.added}</span> <span className="text-accent">−{diff.removed}</span> lines since this version
          </span>
        )}
        <div className="ml-auto flex items-center rounded-lg bg-hover p-0.5">
          {(["changes", "preview"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={clsx(
                "h-6 rounded-md px-2.5 text-[12px] font-medium capitalize",
                view === v ? "bg-surface text-ink shadow-[0_0_0_1px_var(--border)]" : "text-ink-3 hover:text-ink",
              )}
            >
              {v === "changes" ? "Changes" : "Preview old version"}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={restoring}
          onClick={() => void restore()}
          className="flex h-7 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
        >
          <RotateCcw size={13} strokeWidth={2} /> Restore this version
        </button>
        <button type="button" aria-label="Close comparison" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
          <X size={15} />
        </button>
      </div>

      {view === "preview" ? (
        preview ? (
          <iframe title="Old version" src={preview.url} sandbox="allow-scripts allow-same-origin" className="min-h-0 flex-1 border-0 bg-white" />
        ) : (
          <div className="flex-1 bg-canvas" />
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-surface">
          {diff && <DiffLines rows={diff.rows} />}
          {diff && diff.added + diff.removed === 0 && (
            <p className="p-6 font-sans text-[13px] text-ink-3">This version is identical to the current file.</p>
          )}
        </div>
      )}
      <div className="shrink-0 border-t border-line px-4 py-1.5 text-[11px] text-ink-3">
        <span className="text-accent">−</span> this version · <span className="text-emerald-600">+</span> current file
      </div>
    </div>
  );
}
