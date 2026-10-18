import clsx from "clsx";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useApp, type Tab } from "../../store/app";
import { ipc, type VersionMeta } from "../../lib/ipc";
import { formatBytes } from "../../lib/format";

export const SOURCE_LABEL: Record<string, string> = {
  opened: "Opened in Quire",
  disk: "Changed outside Quire",
  edit: "Edited in Quire",
  restore: "Restored",
  remote: "Changed by a collaborator",
  claude: "Changed by Claude",
  import: "Imported",
};

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
export const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function dayLabel(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return dayFormat.format(d);
}

export function HistoryPanel({ tab, selected, onSelect }: { tab: Tab; selected: number | null; onSelect: (id: number | null) => void }) {
  const status = useApp((s) => s.status[tab.id]);
  const reloadKey = useApp((s) => s.reloadKeys[tab.id]);
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    ipc.listVersions(tab.path).then((v) => !cancelled && setVersions(v)).catch(() => setVersions([]));
    return () => {
      cancelled = true;
    };
  }, [tab.path, status, reloadKey]);

  const groups: { day: string; items: { v: VersionMeta; prev?: VersionMeta; current: boolean }[] }[] = [];
  versions?.forEach((v, i) => {
    const day = dayLabel(v.updatedMs);
    if (groups[groups.length - 1]?.day !== day) groups.push({ day, items: [] });
    groups[groups.length - 1].items.push({ v, prev: versions[i + 1], current: i === 0 });
  });

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-l border-line bg-sidebar">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pl-4 pr-2">
        <h2 className="text-[13px] font-semibold text-ink">Version history</h2>
        <button
          type="button"
          aria-label="Close history"
          onClick={() => {
            onSelect(null);
            useApp.getState().toggleHistory();
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:thin]">
        {versions?.length === 0 && <p className="px-2 py-3 text-[12px] text-ink-3">No versions yet. Quire saves one every time this file changes.</p>}
        {groups.map((g) => (
          <div key={g.day} className="mb-2">
            <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{g.day}</div>
            {g.items.map(({ v, prev, current }) => {
              const delta = prev ? v.sizeBytes - prev.sizeBytes : null;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onSelect(current ? null : v.id === selected ? null : v.id)}
                  className={clsx(
                    "relative w-full rounded-lg px-2.5 py-2 text-left transition-colors",
                    v.id === selected ? "bg-surface shadow-[0_0_0_1px_var(--accent)]" : "hover:bg-hover",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium tabular-nums text-ink">{timeFormat.format(v.updatedMs)}</span>
                    {current && <span className="rounded bg-accent-soft px-1.5 py-px text-[10.5px] font-semibold text-accent">Current</span>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-3">
                    <span>{SOURCE_LABEL[v.source] ?? v.source}</span>
                    <span>·</span>
                    <span className="tabular-nums">
                      {delta === null ? formatBytes(v.sizeBytes) : `${delta >= 0 ? "+" : "−"}${formatBytes(Math.abs(delta))}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-ink-3">
        Every change is kept, including ones made by other apps. ⌘S starts a new version.
      </p>
    </aside>
  );
}
