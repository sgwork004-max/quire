import { FileDown } from "lucide-react";

export function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-[2px]">
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent bg-accent-soft">
        <FileDown size={28} strokeWidth={1.5} className="text-accent" />
        <p className="text-[14px] font-medium text-ink">Drop to open</p>
        <p className="text-[12px] text-ink-2">HTML files open in a tab. Folders are added to your library.</p>
      </div>
    </div>
  );
}
