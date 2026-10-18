import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useComments } from "../store/comments";
import { useAccount } from "../store/account";
import { relativeTime } from "../lib/format";
import type { AppNotification } from "../lib/ipc";
import { Avatar } from "./Account";

const VERB: Record<AppNotification["kind"], string> = {
  mention: "mentioned you in",
  reply: "replied in",
  comment: "commented on",
};

/** Mentions, replies, and comments on your files. */
export function NotificationsBell() {
  const account = useAccount((s) => s.account);
  const unread = useComments((s) => s.unread);
  const items = useComments((s) => s.notifications);
  const { loadNotifications, markAllRead, openNotification } = useComments.getState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (account) void loadNotifications();
  }, [account, loadNotifications]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);

  if (!account) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        onClick={() => {
          setOpen((o) => !o);
          void loadNotifications();
        }}
        className={clsx("relative flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink", open && "bg-hover")}
      >
        <Bell size={16} strokeWidth={1.75} />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9.5px] font-bold text-accent-fg">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute bottom-11 left-0 z-40 w-[320px] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[0_12px_40px_-8px_rgb(0_0_0/0.25)]">
          <div className="flex items-center border-b border-line px-3.5 py-2.5">
            <span className="flex-1 text-[13px] font-semibold text-ink">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={() => void markAllRead()} className="text-[12px] font-medium text-accent hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[360px] overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-[12.5px] text-ink-3">Mentions and replies show up here.</li>}
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void markAllRead();
                    void openNotification(n);
                  }}
                  className="flex w-full gap-2.5 border-b border-line px-3.5 py-2.5 text-left last:border-0 hover:bg-hover"
                >
                  <Avatar account={{ id: n.actorName, name: n.actorName, email: "", image: n.actorImage }} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] leading-snug text-ink">
                      <strong className="font-semibold">{n.actorName}</strong> {VERB[n.kind]} <strong className="font-semibold">{n.documentTitle}</strong>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[12px] text-ink-2">{n.excerpt}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-3">{relativeTime(n.createdAt)}</span>
                  </span>
                  {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
