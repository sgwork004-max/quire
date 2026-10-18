import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, MessageSquarePlus, MoreHorizontal, RotateCcw, X } from "lucide-react";
import type { Tab } from "../../store/app";
import { useComments } from "../../store/comments";
import { useAccount } from "../../store/account";
import { getSession } from "../../editor/session";
import { popupMenu } from "../../lib/menu";
import { relativeTime } from "../../lib/format";
import type { CommentItem, Thread } from "../../lib/ipc";
import { Avatar } from "../Account";

type People = { email: string; name: string }[];

/** Comment text with @mentions of people on the file highlighted. */
function Body({ text, people }: { text: string; people: People }) {
  // Mentions are written as @Name, or @email for people who haven't signed up yet.
  const names = [...new Set(people.flatMap((p) => [p.name, p.email]))].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">{text}</p>;
  const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "g");
  return (
    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink [user-select:text]">
      {text.split(re).map((part, i) =>
        part.startsWith("@") && names.includes(part.slice(1)) ? (
          <span key={i} className="rounded bg-accent-soft px-0.5 font-medium text-accent">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}

/**
 * Textarea with @mention autocomplete over the people on the file. Reports the
 * emails of people still mentioned in the text when submitted (⌘↩).
 */
function Composer({
  people,
  placeholder,
  initial = "",
  autoFocus,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  people: People;
  placeholder: string;
  initial?: string;
  autoFocus?: boolean;
  submitLabel: string;
  onSubmit: (body: string, mentions: string[]) => Promise<boolean | void>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [query, setQuery] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const me = useAccount((s) => s.account?.email.toLowerCase());

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return people.filter((p) => p.email !== me && (p.name.toLowerCase().includes(q) || p.email.includes(q))).slice(0, 5);
  }, [query, people, me]);

  const updateQuery = (value: string, caret: number) => {
    const m = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    setQuery(m ? m[2] : null);
    setIndex(0);
  };

  const insert = (person: { name: string }) => {
    const el = ref.current!;
    const caret = el.selectionStart;
    const before = text.slice(0, caret).replace(/@([^\s@]*)$/, `@${person.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || busy) return;
    const mentions = people.filter((p) => body.includes(`@${p.name}`)).map((p) => p.email);
    setBusy(true);
    const ok = await onSubmit(body, mentions);
    setBusy(false);
    if (ok !== false) setText("");
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        value={text}
        rows={Math.min(6, Math.max(2, text.split("\n").length))}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          updateQuery(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === "ArrowDown") return e.preventDefault(), setIndex((i) => (i + 1) % matches.length);
            if (e.key === "ArrowUp") return e.preventDefault(), setIndex((i) => (i - 1 + matches.length) % matches.length);
            if (e.key === "Enter" || e.key === "Tab") return e.preventDefault(), insert(matches[index]);
            if (e.key === "Escape") return e.preventDefault(), setQuery(null);
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape" && onCancel) onCancel();
        }}
        className="w-full resize-none rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
      />
      {matches.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-line-strong bg-surface shadow-lg">
          {matches.map((p, i) => (
            <li key={p.email}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(p);
                }}
                className={clsx("flex w-full flex-col px-2.5 py-1.5 text-left", i === index ? "bg-accent-soft" : "hover:bg-hover")}
              >
                <span className="text-[12.5px] font-medium text-ink">{p.name}</span>
                <span className="text-[11px] text-ink-3">{p.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-7 rounded-md px-2.5 text-[12px] font-medium text-ink-2 hover:bg-hover">
            Cancel
          </button>
        )}
        <button
          type="button"
          disabled={!text.trim() || busy}
          onClick={() => void submit()}
          title="⌘↩"
          className="h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function CommentView({ tabId, comment, people, isRoot, thread }: { tabId: string; comment: CommentItem; people: People; isRoot: boolean; thread: Thread }) {
  const me = useAccount((s) => s.account?.id);
  const canComment = useComments((s) => s.byTab[tabId]?.canComment);
  const [editing, setEditing] = useState(false);
  const { edit, remove, resolve } = useComments.getState();
  const mine = comment.author.id === me;

  const menu = () =>
    void popupMenu([
      ...(isRoot && canComment ? [{ text: thread.resolved ? "Reopen" : "Resolve", action: () => void resolve(tabId, thread.id, !thread.resolved) }] : []),
      ...(mine ? [{ text: "Edit", action: () => setEditing(true) }] : []),
      ...(mine ? [{ text: isRoot ? "Delete Thread" : "Delete", action: () => void remove(tabId, comment.id) }] : []),
    ]);

  return (
    <div className="group/c">
      <div className="flex items-center gap-2">
        <Avatar account={{ id: comment.author.id, name: comment.author.name, email: comment.author.email, image: comment.author.image ?? null }} size={22} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{comment.author.name}</span>
        <span className="shrink-0 text-[11px] text-ink-3">
          {relativeTime(comment.createdAt)}
          {comment.updatedAt > comment.createdAt + 1000 && !isRoot ? " · edited" : ""}
        </span>
        {(mine || (isRoot && canComment)) && (
          <button type="button" aria-label="Comment actions" onClick={menu} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-3 opacity-0 hover:bg-active hover:text-ink group-hover/c:opacity-100">
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>
      <div className="mt-1 pl-[30px]">
        {editing ? (
          <Composer
            people={people}
            initial={comment.body}
            autoFocus
            placeholder="Edit comment"
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              await edit(tabId, comment.id, body);
              setEditing(false);
            }}
          />
        ) : (
          <Body text={comment.body} people={people} />
        )}
      </div>
    </div>
  );
}

function ThreadCard({ tab, thread, n, people }: { tab: Tab; thread: Thread; n: number; people: People }) {
  const active = useComments((s) => s.activeThread[tab.id] === thread.id);
  const canComment = useComments((s) => s.byTab[tab.id]?.canComment);
  const { focus, reply, resolve } = useComments.getState();
  const ref = useRef<HTMLDivElement>(null);
  const orphaned = thread.anchor && getSession(tab.id)?.qidForAnchor(thread.anchor) == null;

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <div
      ref={ref}
      onMouseDown={() => !active && focus(tab.id, thread.id)}
      className={clsx(
        "rounded-xl border bg-surface p-3 transition-shadow",
        active ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]" : "border-line hover:border-line-strong",
        thread.resolved && !active && "opacity-70",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-[11px] text-ink-3">
        <span className={clsx("flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white", thread.resolved ? "bg-ink-3" : "bg-accent")}>{n}</span>
        <span className="min-w-0 flex-1 truncate">
          {orphaned ? "The element this was on was removed" : thread.anchor ? `${thread.anchor.tag}${thread.anchor.snippet ? ` · “${thread.anchor.snippet}”` : ""}` : "Whole page"}
        </span>
        {canComment && (
          <button
            type="button"
            title={thread.resolved ? "Reopen" : "Resolve"}
            aria-label={thread.resolved ? "Reopen thread" : "Resolve thread"}
            onClick={(e) => {
              e.stopPropagation();
              void resolve(tab.id, thread.id, !thread.resolved);
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-emerald-600"
          >
            {thread.resolved ? <RotateCcw size={13} /> : <Check size={14} />}
          </button>
        )}
      </div>
      <div className="space-y-3">
        <CommentView tabId={tab.id} comment={thread} thread={thread} people={people} isRoot />
        {thread.replies.map((r) => (
          <CommentView key={r.id} tabId={tab.id} comment={r} thread={thread} people={people} isRoot={false} />
        ))}
      </div>
      {active && canComment && (
        <div className="mt-3 border-t border-line pt-3">
          <Composer people={people} placeholder="Reply… @ to mention" submitLabel="Reply" onSubmit={(body, mentions) => reply(tab.id, thread.id, body, mentions)} />
        </div>
      )}
    </div>
  );
}

export function CommentsPanel({ tab }: { tab: Tab }) {
  const data = useComments((s) => s.byTab[tab.id]);
  const draft = useComments((s) => s.draft[tab.id]);
  const picking = useComments((s) => s.picking[tab.id]);
  const showResolved = useComments((s) => s.showResolved);
  const { togglePanel, startPick, stopPick, cancelDraft, post, setShowResolved } = useComments.getState();

  const threads = data?.threads ?? [];
  const visible = threads.filter((t) => showResolved || !t.resolved);
  const resolvedCount = threads.filter((t) => t.resolved).length;

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-sidebar">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pl-4 pr-2">
        <h2 className="flex-1 text-[13px] font-semibold text-ink">Comments</h2>
        {data?.canComment && (
          <button
            type="button"
            onClick={() => (picking ? stopPick(tab.id) : startPick(tab.id))}
            className={clsx(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium",
              picking ? "bg-accent text-accent-fg" : "text-ink-2 hover:bg-hover hover:text-ink",
            )}
            title="Add a comment  ⌥⌘M"
          >
            <MessageSquarePlus size={14} /> {picking ? "Pick an element…" : "Add"}
          </button>
        )}
        <button type="button" aria-label="Close comments" onClick={() => togglePanel(false)} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
          <X size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 [scrollbar-width:thin]">
        {!tab.share ? (
          <p className="px-1 py-6 text-center text-[12.5px] leading-relaxed text-ink-3">Comments are for shared files. Share this file to discuss it with others.</p>
        ) : !data ? (
          <p className="px-1 py-6 text-center text-[12px] text-ink-3">Loading comments…</p>
        ) : (
          <>
            {draft && (
              <div className="rounded-xl border border-accent bg-surface p-3 shadow-[0_0_0_3px_var(--accent-soft)]">
                <div className="mb-2 truncate text-[11px] text-ink-3">
                  New comment on {draft.anchor.tag}
                  {draft.anchor.snippet && ` · “${draft.anchor.snippet}”`}
                </div>
                <Composer
                  people={data.people}
                  autoFocus
                  placeholder="Add a comment… @ to mention"
                  submitLabel="Comment"
                  onCancel={() => cancelDraft(tab.id)}
                  onSubmit={(body, mentions) => post(tab.id, body, mentions)}
                />
              </div>
            )}
            {picking && !draft && (
              <p className="rounded-lg bg-accent-soft px-3 py-2 text-[12px] text-ink">Click anything on the page to comment on it. Press Esc to cancel.</p>
            )}
            {visible.map((t) => (
              <ThreadCard key={t.id} tab={tab} thread={t} n={threads.indexOf(t) + 1} people={data.people} />
            ))}
            {!visible.length && !draft && !picking && (
              <div className="px-2 py-8 text-center">
                <p className="text-[13px] font-medium text-ink">{resolvedCount ? "No open comments" : "No comments yet"}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
                  {data.canComment ? "Click Add, then click anything on the page to start a discussion." : "Comments from people on this file show up here."}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {resolvedCount > 0 && (
        <label className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[12px] text-ink-2">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} className="accent-[var(--accent)]" />
          Show {resolvedCount} resolved
        </label>
      )}
    </aside>
  );
}
