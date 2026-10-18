import { useEffect, useState } from "react";
import { KeyRound, Loader2, Sparkles, X } from "lucide-react";
import { useAi } from "../store/ai";
import { DiffLines } from "./doc/DiffLines";

const EXAMPLES = ["Make the header sticky", "Add a totals row to the table", "Switch to a dark colour scheme", "Make it work on phones"];

/** ⌘J: describe a change, review Claude's edits as a diff, accept or discard. */
export function AiDialog() {
  const { open, phase, focus, review, error, lastPrompt } = useAi();
  const { close, ask, accept, saveKey, removeKey } = useAi.getState();
  const [prompt, setPrompt] = useState("");
  const [key, setKey] = useState("");

  useEffect(() => {
    if (!open) return;
    // Other parts of the app (e.g. Live data → Wire up) can suggest a prompt.
    setPrompt(useAi.getState().prefill);
    useAi.setState({ prefill: "" });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && phase !== "asking" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, phase, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/25 px-6 pt-[10vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && phase !== "asking" && close()}>
      <div role="dialog" aria-modal="true" aria-label="Edit with AI" className="flex max-h-[76vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_64px_-12px_rgb(0_0_0/0.4)]">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Sparkles size={16} className="text-accent" />
          <span className="flex-1 text-[13.5px] font-semibold text-ink">Edit with AI</span>
          {phase !== "key" && (
            <button type="button" onClick={() => void removeKey()} className="text-[11.5px] text-ink-3 hover:text-ink" title="Remove or replace your Anthropic API key">
              API key
            </button>
          )}
          <button type="button" aria-label="Close" onClick={close} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
            <X size={15} />
          </button>
        </div>

        {phase === "key" ? (
          <form
            className="p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void saveKey(key).then((ok) => ok && setKey(""));
            }}
          >
            <div className="flex items-start gap-3">
              <KeyRound size={18} className="mt-0.5 shrink-0 text-ink-3" />
              <div>
                <p className="text-[13.5px] font-medium text-ink">Add your Anthropic API key</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                  AI edit uses Claude with your own key, so you pay Anthropic directly for what you use. The key is stored in your Mac's
                  Keychain and only sent to Anthropic. Create one at console.anthropic.com → API Keys.
                </p>
              </div>
            </div>
            <input
              autoFocus
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
              className="mt-4 h-9 w-full rounded-lg border border-line-strong bg-bg px-3 font-mono text-[12.5px] text-ink outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
            />
            {error && <p className="mt-2 text-[12px] text-accent">{error}</p>}
            <div className="mt-4 flex justify-end">
              <button type="submit" disabled={!key.trim()} className="h-8 rounded-lg bg-accent px-4 text-[12.5px] font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40">
                Save key
              </button>
            </div>
          </form>
        ) : phase === "review" && review ? (
          <>
            <div className="border-b border-line px-4 py-3">
              <p className="text-[13px] leading-relaxed text-ink">{review.summary}</p>
              <p className="mt-1 text-[11.5px] tabular-nums text-ink-3">
                <span className="text-emerald-600">+{review.added}</span> <span className="text-accent">−{review.removed}</span> lines · “{lastPrompt}”
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-surface">
              <DiffLines rows={review.rows} />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
              <button type="button" onClick={() => useAi.setState({ phase: "idle", review: null })} className="h-8 rounded-lg px-3 text-[12.5px] font-medium text-ink-2 hover:bg-hover">
                Discard
              </button>
              <button type="button" autoFocus onClick={accept} className="h-8 rounded-lg bg-accent px-4 text-[12.5px] font-medium text-accent-fg hover:bg-accent-hover">
                Apply changes
              </button>
            </div>
          </>
        ) : (
          <form
            className="p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(prompt);
            }}
          >
            {focus && (
              <p className="mb-2 truncate text-[11.5px] text-ink-3">
                Focused on the selected <span className="font-mono text-ink-2">&lt;{focus.tag}&gt;</span>
                {focus.snippet && ` · “${focus.snippet}”`}
              </p>
            )}
            <textarea
              autoFocus
              rows={3}
              value={prompt}
              disabled={phase === "asking"}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(prompt);
                }
              }}
              placeholder="Describe the change… e.g. “Make the chart colours match our brand red”"
              className="w-full resize-none rounded-lg border border-line-strong bg-bg px-3 py-2.5 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] disabled:opacity-60"
            />
            {error && <p className="mt-2 text-[12.5px] text-accent">{error}</p>}
            <div className="mt-3 flex items-center gap-2">
              {phase === "asking" ? (
                <span className="flex items-center gap-2 text-[12.5px] text-ink-2">
                  <Loader2 size={14} className="animate-spin" /> Claude is working on it…
                </span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {EXAMPLES.map((ex) => (
                    <button key={ex} type="button" onClick={() => setPrompt(ex)} className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-2 hover:bg-hover hover:text-ink">
                      {ex}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="submit"
                disabled={!prompt.trim() || phase === "asking"}
                className="ml-auto h-8 shrink-0 rounded-lg bg-accent px-4 text-[12.5px] font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
              >
                Suggest edits
              </button>
            </div>
            <p className="mt-3 text-[11px] text-ink-3">You'll review every change before it's applied. Uses Claude Opus 5.5 with your API key.</p>
          </form>
        )}
      </div>
    </div>
  );
}
