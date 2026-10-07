import clsx from "clsx";
import { useEffect, useState } from "react";
import { useApp, VIEWPORT_WIDTHS } from "../store";
import type { DocumentInfo } from "../lib/ipc";
import { formatBytes, parentFolder } from "../lib/format";

/**
 * Sandbox flags for documents. `allow-same-origin` is safe here because each
 * document is served from its own `quire://<id>` origin, never the app's.
 * Deliberately missing: `allow-top-navigation` (a page cannot take over the app).
 */
const SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads";

export function Viewer() {
  const tabs = useApp((s) => s.tabs);
  const activeId = useApp((s) => s.activeId);
  const active = tabs.find((t) => t.id === activeId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 bg-canvas">
        {/* Every open tab stays mounted so switching tabs keeps scroll and page state. */}
        {tabs.map((t) => (
          <Frame key={t.id} doc={t} visible={t.id === activeId} />
        ))}
      </div>
      {active && <StatusBar doc={active} />}
    </div>
  );
}

function Frame({ doc, visible }: { doc: DocumentInfo; visible: boolean }) {
  const reloadKey = useApp((s) => s.reloadKeys[doc.id] ?? 0);
  const viewport = useApp((s) => s.viewport);
  const [loading, setLoading] = useState(true);
  const width = VIEWPORT_WIDTHS[viewport];
  const src = reloadKey ? `${doc.url}?r=${reloadKey}` : doc.url;

  useEffect(() => setLoading(true), [src]);

  return (
    <div
      className={clsx(
        "absolute inset-0 overflow-auto",
        visible ? "block" : "hidden",
        width && "flex justify-center p-6",
      )}
    >
      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 bg-accent [animation:progress_0.9s_ease-in-out_infinite]" />
        </div>
      )}
      <iframe
        key={doc.id}
        title={doc.name}
        src={src}
        sandbox={SANDBOX}
        onLoad={() => setLoading(false)}
        style={width ? { width, minWidth: width } : undefined}
        className={clsx(
          "block border-0 bg-white",
          width ? "h-full shrink-0 rounded-[10px] shadow-page" : "h-full w-full",
        )}
      />
    </div>
  );
}

function StatusBar({ doc }: { doc: DocumentInfo }) {
  const viewport = useApp((s) => s.viewport);
  const width = VIEWPORT_WIDTHS[viewport];
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-bg px-3 text-[11px] text-ink-3">
      <span className="flex items-center gap-1.5 text-ink-2" title="Reloads automatically when the file changes on disk">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-50" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        Live
      </span>
      <span className="min-w-0 truncate" title={doc.path}>
        {parentFolder(doc.path)}/{doc.name}
      </span>
      <span className="ml-auto shrink-0 tabular-nums">{formatBytes(doc.sizeBytes)}</span>
      <span className="shrink-0 tabular-nums">{width ? `${width}px` : "Fit"}</span>
    </footer>
  );
}
