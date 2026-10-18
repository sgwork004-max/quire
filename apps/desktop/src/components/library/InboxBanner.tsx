import { Download, X } from "lucide-react";
import { useEffect } from "react";
import { ipc } from "../../lib/ipc";
import { loadPref, savePref } from "../../lib/prefs";
import { useLibrary } from "../../store/library";
import { useImport } from "../../store/import";

/** One-time offer to bring in AI-made HTML that's already in Downloads. */
export function InboxBanner() {
  const count = useLibrary((s) => s.inboxBanner);

  useEffect(() => {
    void (async () => {
      if (await loadPref<boolean>("inboxBannerDismissed")) return;
      const status = await ipc.inboxStatus().catch(() => null);
      if (status?.enabled && status.pastCount > 0) useLibrary.setState({ inboxBanner: status.pastCount });
    })();
  }, []);

  if (!count) return null;
  const dismiss = () => {
    savePref("inboxBannerDismissed", true);
    useLibrary.setState({ inboxBanner: null });
  };

  return (
    <div className="mx-8 mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <Download size={18} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink-2">
        <strong className="font-semibold text-ink">HTML you download now lands in Quire.</strong> Download a page from ChatGPT, Claude or Gemini, or save one to your
        Desktop, and it appears in Quire › Inbox. Save it again after changes and the same file updates. You have {count} HTML file{count === 1 ? "" : "s"} in
        Downloads and on your Desktop already.
      </div>
      <button type="button" onClick={() => useImport.getState().show()} className="h-8 shrink-0 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-accent-fg hover:bg-accent-hover">
        Import…
      </button>
      <button type="button" aria-label="Dismiss" onClick={dismiss} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
        <X size={14} />
      </button>
    </div>
  );
}
