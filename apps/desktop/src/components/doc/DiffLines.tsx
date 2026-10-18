import clsx from "clsx";
import type { DiffRow } from "../../editor/diff";

/** Line-by-line diff with old/new line numbers and folded unchanged runs. */
export function DiffLines({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="font-mono text-[12px] leading-[1.6]">
      {rows.map((r, i) =>
        r.kind === "skip" ? (
          <div key={i} className="border-y border-line bg-bg px-4 py-1 text-[11px] text-ink-3">
            ⋯ {r.count} unchanged line{r.count === 1 ? "" : "s"}
          </div>
        ) : (
          <div
            key={i}
            className={clsx(
              "grid grid-cols-[44px_44px_16px_1fr]",
              r.kind === "add" && "bg-[var(--diff-add)]",
              r.kind === "del" && "bg-[var(--diff-del)]",
            )}
          >
            <span className="select-none pr-2 text-right text-ink-3">{r.oldNo ?? ""}</span>
            <span className="select-none pr-2 text-right text-ink-3">{r.newNo ?? ""}</span>
            <span className={clsx("select-none", r.kind === "add" ? "text-emerald-600" : r.kind === "del" ? "text-accent" : "text-ink-3")}>
              {r.kind === "add" ? "+" : r.kind === "del" ? "−" : ""}
            </span>
            <span className="whitespace-pre-wrap break-all pr-4 text-ink [user-select:text]">{r.text || " "}</span>
          </div>
        ),
      )}
    </div>
  );
}
