import { useEffect, useState } from "react";
import { create } from "zustand";

interface PromptState {
  request: { title: string; label: string; initial: string; confirm: string; resolve: (v: string | null) => void } | null;
  ask: (title: string, opts?: { label?: string; initial?: string; confirm?: string }) => Promise<string | null>;
}

/** A small "name this" dialog, e.g. New Folder. Resolves to the text, or null if cancelled. */
export const usePrompt = create<PromptState>((set) => ({
  request: null,
  ask: (title, opts = {}) =>
    new Promise((resolve) =>
      set({ request: { title, label: opts.label ?? "Name", initial: opts.initial ?? "", confirm: opts.confirm ?? "Create", resolve } }),
    ),
}));

export function PromptDialog() {
  const request = usePrompt((s) => s.request);
  const [value, setValue] = useState("");
  useEffect(() => setValue(request?.initial ?? ""), [request]);
  if (!request) return null;
  const done = (v: string | null) => {
    usePrompt.setState({ request: null });
    request.resolve(v);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onMouseDown={(e) => e.target === e.currentTarget && done(null)}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) done(value.trim());
        }}
        className="w-full max-w-[360px] rounded-2xl border border-line bg-surface p-5 shadow-[0_24px_64px_-12px_rgb(0_0_0/0.35)]"
      >
        <h2 id="prompt-title" className="text-[15px] font-semibold text-ink">
          {request.title}
        </h2>
        <label className="mt-3 block">
          <span className="mb-1 block text-[11.5px] text-ink-2">{request.label}</span>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && done(null)}
            className="h-8 w-full rounded-md border border-line-strong bg-bg px-2.5 text-[13px] text-ink outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => done(null)} className="h-8 rounded-lg px-3 text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink">
            Cancel
          </button>
          <button type="submit" disabled={!value.trim()} className="h-8 rounded-lg bg-accent px-4 text-[12.5px] font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50">
            {request.confirm}
          </button>
        </div>
      </form>
    </div>
  );
}
