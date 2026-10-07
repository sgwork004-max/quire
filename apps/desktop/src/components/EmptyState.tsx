import { FileCode2 } from "lucide-react";
import { useApp } from "../store";
import { parentFolder } from "../lib/format";
import { Logo } from "./Logo";

export function EmptyState() {
  const recents = useApp((s) => s.recents);
  const { openDialog, openPaths } = useApp.getState();

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-bg p-8">
      <div className="w-full max-w-[400px] text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface text-ink-2 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
          <Logo size={30} />
        </div>
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Open an HTML file</h1>
        <p className="mx-auto mt-1.5 max-w-[300px] text-[13px] leading-relaxed text-ink-2">
          Drop it anywhere in this window, or pick one from your Mac. Edits on disk show up live.
        </p>
        <button
          type="button"
          onClick={openDialog}
          className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-medium text-accent-fg shadow-[0_1px_2px_rgb(0_0_0/0.12)] transition-colors hover:bg-accent-hover"
        >
          Choose file…
          <kbd className="font-sans text-[11px] opacity-75">⌘O</kbd>
        </button>

        {recents.length > 0 && (
          <div className="mt-10 text-left">
            <div className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              Jump back in
            </div>
            <ul className="overflow-hidden rounded-xl border border-line bg-surface">
              {recents.slice(0, 5).map((r) => (
                <li key={r.path} className="border-b border-line last:border-0">
                  <button
                    type="button"
                    onClick={() => openPaths([r.path])}
                    title={r.path}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-hover"
                  >
                    <FileCode2 size={15} strokeWidth={1.75} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{r.name}</span>
                    <span className="max-w-[45%] shrink-0 truncate text-[11px] text-ink-3">{parentFolder(r.path)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
