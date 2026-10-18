import { FileDown } from "lucide-react";

/** Shown while files are dragged in from Finder. Over a sidebar folder or tag, only that target lights up. */
export function DropOverlay({ target, left }: { target: string | null; left: number }) {
  if (target) return null;
  return (
    <div style={{ left }} className="pointer-events-none fixed inset-y-0 right-0 z-50 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-[2px]">
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent bg-accent-soft">
        <FileDown size={28} strokeWidth={1.5} className="text-accent" />
        <p className="text-[14px] font-medium text-ink">Drop to open</p>
        <p className="text-[12px] text-ink-2">HTML files open in a tab. Folders are added to your library. Drop on a folder or tag in the sidebar to file them there.</p>
      </div>
    </div>
  );
}
