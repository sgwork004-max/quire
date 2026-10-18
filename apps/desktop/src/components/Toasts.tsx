import { useApp } from "../store/app";

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-10 z-50 flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex max-w-[560px] items-center gap-3 rounded-lg bg-ink py-2 pl-3.5 pr-2 text-[12.5px] text-bg shadow-lg [animation:toast-in_160ms_ease-out]"
        >
          <span className="py-0.5">{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
              className="shrink-0 rounded-md px-2 py-0.5 font-semibold text-bg underline decoration-from-font underline-offset-2 hover:bg-white/10"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
