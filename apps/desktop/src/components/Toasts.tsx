import { useApp } from "../store";

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-10 z-50 flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="max-w-[520px] rounded-lg bg-ink px-3.5 py-2 text-[12.5px] text-bg shadow-lg [animation:toast-in_160ms_ease-out]"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
