import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow, type Theme } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2, LogOut, X } from "lucide-react";
import { errorMessage, ipc, type ImportSource } from "../lib/ipc";
import { useLibrary } from "../store/library";
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

type ClaudeApp = "desktop" | "code";
const CLAUDE_APPS: { id: ClaudeApp; name: string; restart: string }[] = [
  { id: "desktop", name: "Claude app", restart: "Quit and reopen the Claude app to start using it." },
  { id: "code", name: "Claude Code", restart: "Start a new Claude Code session to use it." },
];

/** Connects Quire's built-in MCP server to the Claude app and Claude Code. */
function ClaudeConnect() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof ipc.claudeStatus>> | null>(null);
  const [busy, setBusy] = useState<ClaudeApp | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = () => void ipc.claudeStatus().then(setStatus).catch(() => setStatus(null));
  useEffect(load, []);

  const toggle = async (app: (typeof CLAUDE_APPS)[number], connect: boolean) => {
    setBusy(app.id);
    setNote(null);
    try {
      await ipc.connectClaude(app.id, connect);
      setNote(connect ? `Connected. ${app.restart}` : `Disconnected from ${app.name}.`);
    } catch (e) {
      setNote(`Couldn't change ${app.name}: ${errorMessage(e)}`);
    }
    setBusy(null);
    load();
  };

  return (
    <div className="pt-1">
      {CLAUDE_APPS.map((app) => {
        const s = status?.[app.id];
        return (
          <div key={app.id} className="flex h-9 items-center gap-2">
            <span className="flex-1 text-[12.5px] text-ink">{app.name}</span>
            {s?.connected && <span className="text-[11.5px] text-success">Connected</span>}
            {!s?.connected && s && !s.installed && <span className="text-[11.5px] text-ink-3">Not installed</span>}
            <button
              type="button"
              disabled={!status || busy !== null}
              onClick={() => void toggle(app, !s?.connected)}
              className={clsx(
                "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] disabled:opacity-50",
                s?.connected ? "border border-line-strong text-ink hover:bg-hover" : "bg-accent font-medium text-accent-fg hover:bg-accent-hover",
              )}
            >
              {busy === app.id && <Loader2 size={12} className="animate-spin" />}
              {s?.connected ? "Disconnect" : "Connect"}
            </button>
          </div>
        );
      })}
      {note && <p className="mt-1 text-[11.5px] leading-snug text-ink-2">{note}</p>}
      <p className="mt-1.5 text-[11px] leading-snug text-ink-3">Then just ask, for example “make a dashboard of these numbers and save it to Quire”.</p>
    </div>
  );
}

function SettingsPanel() {
  const hide = useSettings((s) => s.hide);
  const { account, offline } = useAccount();
  const { signIn, signOut, rename } = useAccount.getState();
  const [name, setName] = useState(account?.name ?? "");
  const [appearance, setAppearance] = useState<Appearance>("system");
  const [sources, setSources] = useState<ImportSource[] | null>(null);
  const overview = useLibrary((st) => st.overview);
  const [version, setVersion] = useState("");

  useEffect(() => {
    void loadPref<Appearance>("appearance").then((a) => a && setAppearance(a));
    void ipc.inboxStatus().then((s) => setSources(s.sources)).catch(() => setSources([]));
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

  const stopWatching = (path: string) => {
    const next = (sources ?? []).filter((x) => x.path !== path);
    setSources(next);
    void ipc.setImportSources(next);
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

          <Row label="Import" hint="Quire only looks in places you chose.">
            <p className="pt-1.5 text-[12.5px] leading-snug text-ink-2">
              {sources?.length ? "New HTML saved here is imported automatically:" : "Quire isn't watching any folders. Choose some with Import, and tick “Keep importing new files”."}
            </p>
            {!!sources?.length && (
              <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line">
                {sources.map((src) => {
                  const folder = overview?.folders.find((f) => f.id === src.folderId);
                  return (
                    <li key={src.path} className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]">
                      <span className="min-w-0 flex-1 truncate text-ink" title={src.path}>
                        {src.path.replace(/^\/Users\/[^/]+/, "~")}
                        {folder && <span className="text-ink-3"> → {folder.name}</span>}
                      </span>
                      <button type="button" onClick={() => stopWatching(src.path)} className="shrink-0 rounded px-1.5 py-0.5 text-ink-3 hover:bg-hover hover:text-ink">
                        Stop
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <button
              type="button"
              onClick={() => {
                hide();
                useImport.getState().show();
              }}
              className="mt-2.5 h-7 rounded-md border border-line-strong px-2.5 text-[12px] text-ink hover:bg-hover"
            >
              Import HTML…
            </button>
          </Row>

          <Row label="Claude" hint="Claude can save the pages it makes straight into Quire, and update them when you ask for changes.">
            <ClaudeConnect />
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
            <p className="mt-2.5 flex flex-wrap gap-x-3 text-[11.5px] text-ink-3">
              {[
                ["Terms", "https://quire-cloud.quire-cloud.workers.dev/terms"],
                ["Privacy", "https://quire-cloud.quire-cloud.workers.dev/privacy"],
                ["Licences", "https://github.com/sgwork004-max/quire/blob/main/THIRD_PARTY_LICENSES.md"],
                ["Contact", "mailto:sg.work004+quire@gmail.com?subject=Quire"],
              ].map(([label, url]) => (
                <button key={label} type="button" onClick={() => void openUrl(url)} className="underline-offset-2 hover:text-ink hover:underline">
                  {label}
                </button>
              ))}
            </p>
          </Row>
        </div>
      </div>
    </div>
  );
}
