import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow, type Theme } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LogOut, X } from "lucide-react";
import { ipc } from "../lib/ipc";
import { loadPref, savePref } from "../lib/prefs";
import { checkForUpdates } from "../lib/updates";
import { useAccount } from "../store/account";
import { useImport } from "../store/import";
import { useSettings } from "../store/settings";
import { Avatar, StorageMeter } from "./Account";

type Appearance = "system" | "light" | "dark";

/** Applies the saved appearance; the whole UI follows the window's theme. */
export async function applyAppearance(value?: Appearance) {
  const appearance = value ?? (await loadPref<Appearance>("appearance")) ?? "system";
  await getCurrentWindow()
    .setTheme(appearance === "system" ? null : (appearance as Theme))
    .catch(() => undefined);
}

export function SettingsDialog() {
  const open = useSettings((s) => s.open);
  return open ? <SettingsPanel /> : null;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3">
      <div className="w-[150px] shrink-0 pt-1.5">
        <div className="text-[12.5px] font-medium text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-ink-3">{hint}</div>}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function SettingsPanel() {
  const hide = useSettings((s) => s.hide);
  const { account, offline } = useAccount();
  const { signIn, signOut, rename } = useAccount.getState();
  const [name, setName] = useState(account?.name ?? "");
  const [appearance, setAppearance] = useState<Appearance>("system");
  const [auto, setAuto] = useState<boolean | null>(null);
  const [version, setVersion] = useState("");

  useEffect(() => {
    void loadPref<Appearance>("appearance").then((a) => a && setAppearance(a));
    void ipc.inboxStatus().then((s) => setAuto(s.enabled)).catch(() => setAuto(null));
    void getVersion().then(setVersion);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hide]);

  useEffect(() => setName(account?.name ?? ""), [account?.name]);

  const pickAppearance = (a: Appearance) => {
    setAppearance(a);
    savePref("appearance", a);
    void applyAppearance(a);
  };

  const toggleAuto = (on: boolean) => {
    setAuto(on);
    void ipc.setInboxEnabled(on).catch(() => setAuto(!on));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && hide()}>
      <div role="dialog" aria-modal="true" aria-labelledby="settings-title" className="flex max-h-[86vh] w-full max-w-[560px] flex-col rounded-2xl border border-line bg-surface shadow-[0_24px_64px_-12px_rgb(0_0_0/0.35)]">
        <div className="flex items-center px-6 pt-5">
          <h2 id="settings-title" className="flex-1 font-display text-[19px] font-bold tracking-[-0.02em] text-ink">
            Settings
          </h2>
          <button type="button" aria-label="Close" onClick={hide} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto px-6 pb-4 pt-2">
          <Row label="Account" hint={account ? undefined : "Sign in to share files and comment together."}>
            {account ? (
              <div>
                <div className="flex items-center gap-2.5">
                  <Avatar account={account} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink">{account.name}</div>
                    <div className="truncate text-[11.5px] text-ink-3">
                      {account.email}
                      {offline && " · offline"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[12px] text-ink hover:bg-hover"
                  >
                    <LogOut size={13} /> Sign out
                  </button>
                </div>
                <label className="mt-3 block">
                  <span className="mb-1 block text-[11px] text-ink-2">Display name (people you share with see it)</span>
                  <input
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => name.trim() && name.trim() !== account.name && void rename(name.trim())}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    className="h-8 w-full rounded-md border border-line-strong bg-bg px-2.5 text-[12.5px] text-ink outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                  />
                </label>
                <StorageMeter />
              </div>
            ) : (
              <button type="button" onClick={() => void signIn()} className="h-8 rounded-lg bg-accent px-4 text-[12.5px] font-medium text-accent-fg hover:bg-accent-hover">
                Sign in with Google
              </button>
            )}
          </Row>

          <Row label="Appearance">
            <div className="inline-flex rounded-lg bg-hover p-0.5">
              {(["system", "light", "dark"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-pressed={appearance === a}
                  onClick={() => pickAppearance(a)}
                  className={clsx(
                    "h-7 rounded-md px-3 text-[12.5px] capitalize transition-colors",
                    appearance === a ? "bg-surface text-ink shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.06)]" : "text-ink-2 hover:text-ink",
                  )}
                >
                  {a === "system" ? "Match Mac" : a}
                </button>
              ))}
            </div>
          </Row>

          <Row label="Import" hint="HTML from AI chats usually lands in Downloads.">
            <label className="flex items-start gap-2.5 pt-1.5 text-[12.5px] leading-snug text-ink-2">
              <input type="checkbox" disabled={auto === null} checked={!!auto} onChange={(e) => toggleAuto(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
              <span>Automatically import new HTML from Downloads and Desktop into Quire › Inbox</span>
            </label>
            <button
              type="button"
              onClick={() => {
                hide();
                useImport.getState().show();
              }}
              className="mt-2.5 h-7 rounded-md border border-line-strong px-2.5 text-[12px] text-ink hover:bg-hover"
            >
              Import HTML now…
            </button>
          </Row>

          <Row label="Updates" hint={version ? `You have Quire ${version}.` : undefined}>
            <p className="pt-1.5 text-[12.5px] leading-snug text-ink-2">Quire checks for updates when it starts and installs them after you restart.</p>
            <button type="button" onClick={() => void checkForUpdates(true)} className="mt-2.5 h-7 rounded-md border border-line-strong px-2.5 text-[12px] text-ink hover:bg-hover">
              Check for updates
            </button>
          </Row>

          <Row label="About">
            <p className="pt-1.5 text-[12.5px] leading-snug text-ink-2">Quire is free and open source (AGPL-3.0). Files you don't share never leave this Mac.</p>
            <div className="mt-2.5 flex gap-2">
              <button type="button" onClick={() => void openUrl("https://github.com/sgwork004-max/quire")} className="h-7 rounded-md border border-line-strong px-2.5 text-[12px] text-ink hover:bg-hover">
                Source code
              </button>
              <button type="button" onClick={() => void openUrl("https://github.com/sgwork004-max/quire/issues/new")} className="h-7 rounded-md border border-line-strong px-2.5 text-[12px] text-ink hover:bg-hover">
                Report an issue
              </button>
            </div>
          </Row>
        </div>
      </div>
    </div>
  );
}
