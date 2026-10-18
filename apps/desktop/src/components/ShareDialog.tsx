import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import { Cloud, Loader2, Lock, X } from "lucide-react";
import { useCloud, afterShared } from "../store/cloud";
import { useAccount } from "../store/account";
import { errorMessage, ipc, type Member, type ShareDetails } from "../lib/ipc";
import { formatBytes } from "../lib/format";
import { Avatar } from "./Account";

const ROLE_LABEL = { editor: "Can edit", commenter: "Can comment", viewer: "Can view" } as const;
type Role = keyof typeof ROLE_LABEL;

function RoleSelect({ value, onChange, disabled }: { value: Role; onChange: (r: Role) => void; disabled?: boolean }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Role)}
      className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] text-ink outline-none focus:border-accent disabled:opacity-60"
    >
      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );
}

function Person({ name, email, image, right }: { name: string | null; email: string; image: string | null; right: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <Avatar account={{ id: email, name: name ?? email, email, image }} size={30} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink">{name ?? email}</div>
        <div className="truncate text-[11.5px] text-ink-3">{name ? email : "Invited · hasn't signed in yet"}</div>
      </div>
      {right}
    </li>
  );
}

/**
 * Share a file the Google Docs way: invite people by email with a role. The
 * file is uploaded only when you invite the first person.
 */
export function ShareDialog() {
  const target = useCloud((s) => s.dialog);
  const overview = useCloud((s) => s.overview);
  const { closeShareDialog, stopSharing, refresh } = useCloud.getState();
  const account = useAccount((s) => s.account);
  const link = overview?.links.find((l) => l.path === target?.path);

  const [details, setDetails] = useState<ShareDetails | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    try {
      setDetails(await ipc.shareDetails(id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    setDetails(null);
    setError(null);
    setEmail("");
    if (link) void load(link.documentId);
  }, [target?.path, link?.documentId, load]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && closeShareDialog();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [closeShareDialog]);

  if (!target || !account) return null;
  const isOwner = !link || link.role === "owner";

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // First invite shares the file: only now does anything leave this Mac.
      const id = link?.documentId ?? (await ipc.shareFile(target.path));
      const { members } = await ipc.shareInvite(id, email.trim(), role);
      setEmail("");
      if (!link) await afterShared(target.path);
      setDetails((d) => (d ? { ...d, members } : d));
      await load(id);
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const update = async (fn: () => Promise<{ members: Member[] }>) => {
    try {
      const { members } = await fn();
      setDetails((d) => (d ? { ...d, members } : d));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const usage = overview?.usage;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && closeShareDialog()}>
      <div role="dialog" aria-modal="true" aria-labelledby="share-title" className="flex max-h-[80vh] w-full max-w-[460px] flex-col rounded-2xl border border-line bg-surface shadow-[0_24px_64px_-12px_rgb(0_0_0/0.35)]">
        <div className="flex items-start gap-3 px-6 pt-5">
          <div className="min-w-0 flex-1">
            <h2 id="share-title" className="truncate text-[16px] font-semibold text-ink">
              Share “{link?.title ?? target.name}”
            </h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
              {link ? (
                <>
                  <Cloud size={12} /> Shared · syncs live with everyone below
                </>
              ) : (
                <>
                  <Lock size={12} /> Only on this Mac. Inviting someone uploads this file and the files it uses.
                </>
              )}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={closeShareDialog} className="-mr-2 flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
            <X size={15} />
          </button>
        </div>

        {isOwner && (
          <form onSubmit={invite} className="flex gap-2 px-6 pt-4">
            <input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Add people by email"
              className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-bg px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
            />
            <RoleSelect value={role} onChange={setRole} />
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              {link ? "Invite" : "Share"}
            </button>
          </form>
        )}
        {error && <p className="px-6 pt-2 text-[12px] text-danger">{error}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 pt-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">People with access</h3>
          <ul className="divide-y divide-line">
            <Person
              name={details?.owner.name ?? account.name}
              email={details?.owner.email ?? account.email}
              image={details?.owner.image ?? account.image}
              right={<span className="text-[12px] text-ink-3">Owner</span>}
            />
            {details?.members.map((m) => (
              <Person
                key={m.email}
                name={m.name}
                email={m.email}
                image={m.image}
                right={
                  isOwner ? (
                    <div className="flex items-center gap-1">
                      <RoleSelect value={m.role} onChange={(r) => void update(() => ipc.shareSetRole(details.id, m.email, r))} />
                      <button
                        type="button"
                        aria-label={`Remove ${m.email}`}
                        onClick={() => void update(() => ipc.shareRemove(details.id, m.email))}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-danger-soft hover:text-danger"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <span className="text-[12px] text-ink-3">{ROLE_LABEL[m.role]}</span>
                  )
                }
              />
            ))}
          </ul>
          {link && !details && !error && (
            <div className="flex items-center gap-2 py-3 text-[12px] text-ink-3">
              <Loader2 size={13} className="animate-spin" /> Loading…
            </div>
          )}
        </div>

        <div className={clsx("flex items-center gap-3 border-t border-line px-6 py-3", !link && "text-ink-3")}>
          {usage && (
            <span className="text-[11.5px] text-ink-3" title="Shared files count toward your storage. Files that aren't shared don't.">
              {formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)} used
            </span>
          )}
          {link && isOwner && (
            <button
              type="button"
              onClick={() => void stopSharing(link.documentId, link.title).then((ok) => ok && closeShareDialog())}
              className="ml-auto text-[12.5px] font-medium text-accent hover:underline"
            >
              Stop sharing
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
