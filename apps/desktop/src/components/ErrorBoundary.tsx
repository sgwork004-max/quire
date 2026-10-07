import { Component, type ReactNode } from "react";

/** Shows what went wrong instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center bg-bg p-8">
        <div className="max-w-[560px]">
          <h1 className="text-[17px] font-semibold text-ink">Quire hit an error</h1>
          <p className="mt-1 text-[13px] text-ink-2">Your files are safe. Reload to continue, and please report this if it keeps happening.</p>
          <pre className="mt-4 max-h-[280px] overflow-auto rounded-lg border border-line bg-surface p-3 font-mono text-[11.5px] text-ink-2 [user-select:text]">
            {error.message}
            {"\n"}
            {error.stack}
          </pre>
          <button
            type="button"
            onClick={() => location.reload()}
            className="mt-4 h-8 rounded-lg bg-accent px-4 text-[13px] font-medium text-accent-fg hover:bg-accent-hover"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
