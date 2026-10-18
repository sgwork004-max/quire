import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, LogOut, UserRound, WifiOff, X } from "lucide-react";
import { useAccount } from "../store/account";
import type { Account } from "../lib/ipc";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function Avatar({ account, size = 24 }: { account: Account; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (account.image && !broken) {
    return (
      <img
        src={account.image}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full"
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-fg"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(account.name)}
    </span>
  );
}

/** Bottom of the sidebar: who you are, or a way to sign in. */
export function AccountButton() {
  const { status, account, offline, signIn } = useAccount();
  const [open, setOpen] = useState(false);

  if (status === "loading") return <div className="h-9" />;

  if (!account) {
    return (
      <button
        type="button"
        onClick={() => void signIn()}
        className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
      >
        <UserRound size={16} strokeWidth={1.75} className="text-ink-3" />
        <span className="flex-1">Sign in to share</span>
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={clsx("flex h-9 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-hover", open && "bg-hover")}
      >
        <Avatar account={account} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-ink">{account.name}</span>
        </span>
        {offline && <WifiOff size={13} className="shrink-0 text-ink-3" aria-label="Offline" />}
      </button>
      {open && <ProfilePopover account={account} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ProfilePopover({ account, onClose }: { account: Account; onClose: () => void }) {
  const { rename, signOut } = useAccount.getState();
  const [name, setName] = useState(account.name);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const save = () => {
    if (name.trim() && name.trim() !== account.name) void rename(name.trim());
  };

  return (
    <div
      ref={ref}
      className="absolute bottom-11 left-0 z-40 w-[260px] rounded-xl border border-line-strong bg-surface p-3 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.25)]"
    >
      <div className="flex items-center gap-2.5">
        <Avatar account={account} size={36} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{account.name}</div>
          <div className="truncate text-[11.5px] text-ink-3">{account.email}</div>
        </div>
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-[11px] text-ink-2">Display name</span>
        <input
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="h-7 w-full rounded-md border border-line-strong bg-bg px-2 text-[12.5px] text-ink outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
        />
        <span className="mt-1 block text-[11px] text-ink-3">People you share with see this name.</span>
      </label>
      <button
        type="button"
        onClick={() => {
          onClose();
          void signOut();
        }}
        className="mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-line-strong text-[12.5px] font-medium text-ink hover:bg-hover"
      >
        <LogOut size={14} /> Sign out
      </button>
    </div>
  );
}

/** Shown while the browser finishes signing in. */
export function SignInDialog() {
  const { status, pending, error } = useAccount();
  const { cancelSignIn, reopenBrowser, signIn } = useAccount.getState();
  if (status !== "signing-in") return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-[2px]">
      <div role="dialog" aria-modal="true" aria-labelledby="sign-in-title" className="relative w-full max-w-[380px] rounded-2xl border border-line bg-surface p-6 shadow-[0_24px_64px_-12px_rgb(0_0_0/0.35)]">
        <button type="button" aria-label="Cancel sign-in" onClick={cancelSignIn} className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
          <X size={15} />
        </button>
        <h2 id="sign-in-title" className="text-[16px] font-semibold text-ink">Finish signing in in your browser</h2>

        {error ? (
          <>
            <p className="mt-2 text-[13px] text-accent">{error}</p>
            <button type="button" onClick={() => void signIn()} className="mt-5 h-9 w-full rounded-lg bg-accent text-[13px] font-medium text-accent-fg hover:bg-accent-hover">
              Try again
            </button>
          </>
        ) : !pending ? (
          <div className="flex items-center gap-2 py-6 text-[13px] text-ink-2">
            <Loader2 size={15} className="animate-spin" /> Contacting Quire Cloud…
          </div>
        ) : (
          <>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
              Sign in on the page that just opened, then confirm this code matches:
            </p>
            <div className="mt-4 rounded-xl border border-dashed border-line-strong bg-bg py-4 text-center font-mono text-[24px] font-semibold tracking-[0.14em] text-ink [user-select:text]">
              {pending.userCode}
            </div>
            <div className="mt-4 flex items-center gap-2 text-[12px] text-ink-3">
              <Loader2 size={13} className="animate-spin" /> Waiting for you to approve…
            </div>
            <button type="button" onClick={reopenBrowser} className="mt-4 flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-line-strong text-[12.5px] font-medium text-ink hover:bg-hover">
              <ExternalLink size={13} /> Open the page again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
