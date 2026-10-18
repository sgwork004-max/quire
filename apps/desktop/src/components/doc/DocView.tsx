import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useApp, VIEWPORT_WIDTHS, type Tab } from "../../store/app";
import { getSession } from "../../editor/session";
import { postToFrame, registerFrame } from "../../editor/frames";
import { formatBytes, parentFolder } from "../../lib/format";
import { Inspector } from "./Inspector";
import { HistoryPanel } from "./HistoryPanel";
import { VersionView } from "./VersionView";
import { CommentsPanel } from "./CommentsPanel";
import { frameMode, syncPins, useComments } from "../../store/comments";

/**
 * Sandbox flags for documents. `allow-same-origin` is safe here because each
 * document is served from its own `quire://<id>` origin, never the app's.
 * Deliberately missing: `allow-top-navigation` (a page cannot take over the app).
 */
const SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads";

export function DocView({ tab, visible }: { tab: Tab; visible: boolean }) {
  const historyOpen = useApp((s) => s.historyOpen);
  const commentsOpen = useComments((s) => s.panelOpen);
  const status = useApp((s) => s.status[tab.id]);
  const [versionId, setVersionId] = useState<number | null>(null);

  return (
    <div className={clsx("min-h-0 flex-1 flex-col", visible ? "flex" : "hidden")}>
      <div className="flex min-h-0 flex-1">
        {tab.mode === "code" && <CodePane tab={tab} />}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {status === "conflict" && <ConflictBanner id={tab.id} />}
          <Preview tab={tab} />
          {versionId !== null && <VersionView tab={tab} versionId={versionId} onClose={() => setVersionId(null)} />}
        </div>
        {tab.mode === "visual" && <Inspector tab={tab} />}
        {historyOpen && visible && <HistoryPanel tab={tab} selected={versionId} onSelect={setVersionId} />}
        {commentsOpen && visible && !historyOpen && <CommentsPanel tab={tab} />}
      </div>
      <StatusBar tab={tab} />
    </div>
  );
}

function Preview({ tab }: { tab: Tab }) {
  const reloadKey = useApp((s) => s.reloadKeys[tab.id] ?? 0);
  const viewport = useApp((s) => s.viewport);
  const [loading, setLoading] = useState(true);
  const width = VIEWPORT_WIDTHS[viewport];
  const src = reloadKey ? `${tab.url}?r=${reloadKey}` : tab.url;
  const ref = useCallback((el: HTMLIFrameElement | null) => registerFrame(tab.id, el), [tab.id]);

  useEffect(() => setLoading(true), [src]);

  return (
    <div className={clsx("relative min-h-0 flex-1 overflow-auto bg-canvas", width && "flex justify-center p-6")}>
      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 bg-accent [animation:progress_0.9s_ease-in-out_infinite]" />
        </div>
      )}
      <iframe
        ref={ref}
        name="quire-view"
        title={tab.name}
        src={src}
        sandbox={SANDBOX}
        onLoad={() => setLoading(false)}
        style={width ? { width, minWidth: width } : undefined}
        className={clsx("block border-0 bg-white", width ? "h-full shrink-0 rounded-[10px] shadow-page" : "h-full w-full")}
      />
    </div>
  );
}

function CodePane({ tab }: { tab: Tab }) {
  const width = useApp((s) => s.codeWidth);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const session = getSession(tab.id);
    const el = host.current;
    if (!session || !el) return;
    el.appendChild(session.view.dom);
    const qid = useApp.getState().selection[tab.id]?.qid;
    if (qid != null) session.revealElement(qid);
    session.view.requestMeasure();
    session.view.focus();
    return () => {
      session.view.dom.remove();
    };
  }, [tab.id]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const frame = host.current?.parentElement?.parentElement;
    // Iframes swallow mouse events mid-drag; disable them while resizing.
    frame?.classList.add("[&_iframe]:pointer-events-none");
    const move = (ev: MouseEvent) => {
      const max = window.innerWidth - 420;
      useApp.getState().setCodeWidth(Math.max(320, Math.min(max, startW + ev.clientX - startX)));
    };
    const up = () => {
      frame?.classList.remove("[&_iframe]:pointer-events-none");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="relative flex shrink-0 border-r border-line" style={{ width }}>
      <div ref={host} className="min-w-0 flex-1 [&_.cm-editor]:h-full [&_.cm-editor]:outline-none" />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize code editor"
        onMouseDown={startResize}
        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/30"
      />
    </div>
  );
}

function ConflictBanner({ id }: { id: string }) {
  const resolve = (keep: "mine" | "theirs") => getSession(id)?.resolveConflict(keep);
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-others/40 bg-others-soft px-4 py-2 text-[12.5px] text-ink">
      <AlertTriangle size={15} className="shrink-0 text-others-ink" />
      <span className="flex-1">This file was changed outside Quire while you were editing.</span>
      <button type="button" onClick={() => resolve("theirs")} className="rounded-md px-2.5 py-1 font-medium text-ink-2 hover:bg-hover hover:text-ink">
        Use the file on disk
      </button>
      <button type="button" onClick={() => resolve("mine")} className="rounded-md bg-ink px-2.5 py-1 font-medium text-bg hover:opacity-90">
        Keep my edits
      </button>
    </div>
  );
}

const STATUS_LABEL = {
  saved: "Saved",
  saving: "Saving…",
  dirty: "Edited",
  conflict: "Changed on disk",
  error: "Couldn't save",
} as const;

function StatusBar({ tab }: { tab: Tab }) {
  const viewport = useApp((s) => s.viewport);
  const status = useApp((s) => s.status[tab.id]);
  const width = VIEWPORT_WIDTHS[viewport];
  const editing = tab.mode !== "view";

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-bg px-3 text-[11px] text-ink-3">
      {editing && status ? (
        <span
          className={clsx(
            "flex items-center gap-1.5",
            status === "error" ? "text-danger" : status === "conflict" ? "text-others-ink" : "text-ink-2",
          )}
        >
          <span className={clsx("h-1.5 w-1.5 rounded-full", status === "saved" ? "bg-success" : status === "error" ? "bg-danger" : status === "conflict" ? "bg-others" : "bg-ink-3")} />
          {STATUS_LABEL[status]}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-ink-2" title="Reloads automatically when the file changes on disk">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-50" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          Live
        </span>
      )}
      <span className="min-w-0 truncate" title={tab.path}>
        {parentFolder(tab.path)}/{tab.name}
      </span>
      {tab.mode === "visual" && <span className="shrink-0 text-ink-3">Click to select · Double-click text to edit</span>}
      <span className="ml-auto shrink-0 tabular-nums">{formatBytes(tab.sizeBytes)}</span>
      <span className="shrink-0 tabular-nums">{width ? `${width}px` : "Fit"}</span>
    </footer>
  );
}

/** Re-sends Visual mode state after the preview reloads. */
export function onFrameReady(id: string) {
  const { tabs, selection } = useApp.getState();
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  postToFrame(id, { type: "mode", mode: frameMode(id) });
  const qid = selection[id]?.qid;
  if (tab.mode === "visual" && qid != null) postToFrame(id, { type: "select", qid });
  syncPins(id);
}
