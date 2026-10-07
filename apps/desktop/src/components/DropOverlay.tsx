import { FileDown } from "lucide-react";

export function DropOverlay({ valid }: { valid: boolean }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-[2px]">
      <div
        className={
          "flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed " +
          (valid ? "border-accent bg-accent-soft" : "border-line-strong")
        }
      >
        <FileDown size={28} strokeWidth={1.5} className={valid ? "text-accent" : "text-ink-3"} />
        <p className="text-[14px] font-medium text-ink">{valid ? "Drop to open" : "Only .html files can be opened"}</p>
      </div>
    </div>
  );
}
