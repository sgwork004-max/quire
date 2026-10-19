import { useEffect, useRef, useState } from "react";
import { FileCode2 } from "lucide-react";
import { ipc } from "../../lib/ipc";

const PAGE_WIDTH = 1280;
const PAGE_HEIGHT = 800;
const urls = new Map<string, string>();

/**
 * A live, scaled-down render of the page. Mounted as it nears the screen and
 * kept until it is far away, so scrolling back and forth doesn't blank and
 * reload it, while a big library still stays light. Runs in the same sandbox
 * as the viewer, with fewer permissions (no forms, popups or dialogs).
 */
export function Thumbnail({ path, version, disabled }: { path: string; version: number; disabled?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(() => urls.get(path) ?? null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(0.2);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const near = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "800px" });
    const far = new IntersectionObserver(([e]) => !e.isIntersecting && setVisible(false), { rootMargin: "4000px" });
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / PAGE_WIDTH));
    near.observe(el);
    far.observe(el);
    ro.observe(el);
    return () => {
      near.disconnect();
      far.disconnect();
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!visible || url || disabled) return;
    let cancelled = false;
    ipc
      .previewUrl(path)
      .then((u) => {
        urls.set(path, u);
        if (!cancelled) setUrl(u);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [visible, url, path, disabled]);

  const src = url ? `${url}?t=${version}` : null;
  useEffect(() => setLoaded(false), [src, visible]);

  return (
    <div ref={box} className="relative aspect-[16/10] w-full overflow-hidden bg-white">
      {(!loaded || failed || disabled) && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface text-ink-3">
          <FileCode2 size={22} strokeWidth={1.25} />
        </div>
      )}
      {visible && src && !failed && !disabled && (
        <iframe
          name="quire-thumb"
          title=""
          aria-hidden
          tabIndex={-1}
          src={src}
          sandbox="allow-scripts allow-same-origin"
          onLoad={() => setLoaded(true)}
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-white transition-opacity duration-300"
          style={{
            width: PAGE_WIDTH,
            height: PAGE_HEIGHT,
            transform: `scale(${scale})`,
            opacity: loaded ? 1 : 0,
          }}
        />
      )}
    </div>
  );
}
