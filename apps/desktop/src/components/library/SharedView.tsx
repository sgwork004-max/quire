import { FileCode2, MoreHorizontal, Users } from "lucide-react";
import { useCloud } from "../../store/cloud";
import { useAccount } from "../../store/account";
import { popupMenu } from "../../lib/menu";
import { relativeTime } from "../../lib/format";
import type { CloudDocument } from "../../lib/ipc";

const ROLE = { owner: "Owner", editor: "Can edit", commenter: "Can comment", viewer: "Can view" } as const;

/** Files other people shared with you. They open from a synced copy on this Mac. */
export function SharedView() {
  const account = useAccount((s) => s.account);
  const overview = useCloud((s) => s.overview);
  const error = useCloud((s) => s.error);
  const { openShared, leave } = useCloud.getState();
  const docs = overview?.documents.filter((d) => d.role !== "owner") ?? [];

  if (!account) {
    return (
      <Empty title="Sign in to see files shared with you" body="When someone shares a file with your email, it appears here.">
        <button
          type="button"
          onClick={() => void useAccount.getState().signIn()}
          className="mt-4 h-9 rounded-lg bg-accent px-4 text-[13px] font-medium text-accent-fg hover:bg-accent-hover"
        >
          Sign in
        </button>
      </Empty>
    );
  }
  if (error && !overview) return <Empty title="Can't load shared files" body={error} />;
  if (!overview) return null;
  if (!docs.length) return <Empty title="Nothing shared with you yet" body={`Files people share with ${account.email} show up here.`} />;

  const menu = (d: CloudDocument) =>
    void popupMenu([
      { text: "Open", action: () => void openShared(d) },
      null,
      { text: "Remove Myself", action: () => void leave(d) },
    ]);

  return (
    <div className="mx-2 overflow-hidden rounded-xl border border-line bg-surface">
      {docs.map((d) => (
        <div
          key={d.id}
          role="button"
          tabIndex={0}
          onClick={() => void openShared(d)}
          onKeyDown={(e) => e.key === "Enter" && void openShared(d)}
          onContextMenu={(e) => {
            e.preventDefault();
            menu(d);
          }}
          className="group grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_100px_110px_28px] items-center gap-4 border-b border-line px-3 py-2.5 outline-none transition-colors last:border-0 hover:bg-hover focus-visible:bg-hover"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <FileCode2 size={16} strokeWidth={1.6} className="shrink-0 text-ink-3" />
            <div className="min-w-0">
              <div className="truncate text-[13px] text-ink">{d.title}</div>
              <div className="truncate text-[11.5px] text-ink-3">{d.fileName}</div>
            </div>
          </div>
          <span className="truncate text-[12px] text-ink-2" title={d.ownerEmail}>
            {d.ownerName}
          </span>
          <span className="flex items-center gap-1 text-[12px] text-ink-3">
            <Users size={12} /> {ROLE[d.role]}
          </span>
          <span className="text-[12px] text-ink-3">{relativeTime(d.updatedAt)}</span>
          <button
            type="button"
            aria-label="More"
            onClick={(e) => {
              e.stopPropagation();
              menu(d);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 opacity-0 hover:bg-active hover:text-ink group-hover:opacity-100"
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Empty({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center pt-[12vh] text-center">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-[340px] text-[12.5px] leading-relaxed text-ink-3">{body}</p>
      {children}
    </div>
  );
}
