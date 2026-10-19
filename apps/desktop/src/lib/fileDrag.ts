import { dropOn, useLibrary, type DropTarget } from "../store/library";

/**
 * Dragging library files onto sidebar folders and tags. Built on pointer
 * events because HTML5 drag and drop doesn't work inside the app window
 * (the native window takes drags for files coming from Finder).
 */
const THRESHOLD = 6;
let suppressClick = false;

/** True right after a drag ended, so the card's click doesn't also open the file. */
export function consumeDragClick(): boolean {
  const was = suppressClick;
  suppressClick = false;
  return was;
}

function targetAt(x: number, y: number): { el: Element; target: DropTarget } | null {
  const el = document.elementFromPoint(x, y)?.closest("[data-drop]");
  const [kind, id] = el?.getAttribute("data-drop")?.split(":") ?? [];
  if (!el || (kind !== "folder" && kind !== "tag")) return null;
  return { el, target: { kind, id: Number(id) } };
}

export function startFileDrag(e: React.PointerEvent, fileId: number) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let ghost: HTMLDivElement | null = null;
  let hover: Element | null = null;
  const ids = () => {
    const { selected } = useLibrary.getState();
    return selected.includes(fileId) ? selected : [fileId];
  };

  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
      const n = ids().length;
      ghost = document.createElement("div");
      ghost.className = "file-drag-ghost";
      ghost.textContent = n === 1 ? "1 file" : `${n} files`;
      document.body.appendChild(ghost);
      document.body.classList.add("dragging-files");
    }
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 10}px)`;
    const t = targetAt(ev.clientX, ev.clientY);
    if (hover !== (t?.el ?? null)) {
      hover?.removeAttribute("data-drop-hover");
      hover = t?.el ?? null;
      hover?.setAttribute("data-drop-hover", "");
    }
  };

  const end = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    hover?.removeAttribute("data-drop-hover");
    if (!ghost) return;
    ghost.remove();
    document.body.classList.remove("dragging-files");
    suppressClick = true;
    const t = ev.type === "pointerup" ? targetAt(ev.clientX, ev.clientY) : null;
    if (t) void dropOn(t.target, ids());
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}
