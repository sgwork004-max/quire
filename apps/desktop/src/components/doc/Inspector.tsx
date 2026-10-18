import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Code2, Copy, ImageUp, MessageSquarePlus, MousePointerClick, Trash2, Type } from "lucide-react";
import { useComments } from "../../store/comments";
import { open } from "@tauri-apps/plugin-dialog";
import { useApp, type ElementInfo, type Tab } from "../../store/app";
import { getSession } from "../../editor/session";
import { postToFrame } from "../../editor/frames";
import { errorMessage, ipc } from "../../lib/ipc";

/** Converts `rgb(…)`/`rgba(…)` from getComputedStyle to `#rrggbb`. */
function toHex(color: string | undefined): string {
  if (!color) return "#000000";
  if (color.startsWith("#")) return color.length === 4 ? "#" + [...color.slice(1)].map((c) => c + c).join("") : color.slice(0, 7);
  const m = color.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return "#000000";
  return "#" + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("");
}

const isTransparent = (c?: string) => !c || c === "transparent" || /rgba\(.*,\s*0\)$/.test(c);

/** Bare numbers become px for length properties. */
function normalise(prop: string, value: string): string {
  const v = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(v) && !["font-weight", "opacity", "line-height"].includes(prop)) return v + "px";
  return v;
}

export function Inspector({ tab }: { tab: Tab }) {
  const info = useApp((s) => s.selection[tab.id] ?? null);
  return (
    <aside className="flex w-[272px] shrink-0 flex-col overflow-y-auto border-l border-line bg-sidebar [scrollbar-width:thin]">
      {info ? <ElementPanel tab={tab} info={info} /> : <EmptyPanel />}
    </aside>
  );
}

function EmptyPanel() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-accent">
        <MousePointerClick size={18} strokeWidth={1.75} />
      </div>
      <p className="text-[13px] font-medium text-ink">Select something on the page</p>
      <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-ink-3">
        <li>Click to select and style it</li>
        <li>Double-click text to edit it</li>
        <li>Delete removes it, ⌘Z undoes</li>
      </ul>
    </div>
  );
}

function ElementPanel({ tab, info }: { tab: Tab; info: ElementInfo }) {
  const { qid } = info;
  const session = getSession(tab.id);
  const toast = useApp((s) => s.toast);

  if (qid === null) {
    return (
      <div className="p-4">
        <Header info={info} tabId={tab.id} />
        <p className="mt-3 rounded-lg border border-line bg-surface p-3 text-[12px] leading-relaxed text-ink-2">
          A script on this page creates this element while it runs, so it isn't in the file itself. Edit the script in Code mode to change it.
        </p>
      </div>
    );
  }

  const style = (prop: string, value: string) => postToFrame(tab.id, { type: "set-style", qid, prop, value: value ? normalise(prop, value) : "" });
  const attr = (name: string, value: string | null) => {
    if (session?.setAttribute(qid, name, value)) postToFrame(tab.id, { type: "set-attr", qid, name, value });
  };
  const val = (p: string) => info.inline[p] ?? "";
  const ph = (p: string) => info.computed[p] ?? "";

  const replaceImage = async () => {
    const picked = await open({ filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"] }] });
    if (typeof picked !== "string") return;
    try {
      attr("src", await ipc.importImage(tab.id, picked));
    } catch (e) {
      toast(`Couldn't add image: ${errorMessage(e)}`);
    }
  };

  const showInCode = async () => {
    await useApp.getState().setMode(tab.id, "code");
  };

  return (
    <div className="pb-6">
      <div className="border-b border-line p-4">
        <Header info={info} tabId={tab.id} />
        {info.text && (
          <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-ink-3">
            <Type size={12} /> Double-click the text on the page to edit it
          </p>
        )}
      </div>

      {info.tag === "img" && (
        <Section title="Image">
          <button
            type="button"
            onClick={() => void replaceImage()}
            className="flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface text-[12.5px] font-medium text-ink hover:bg-hover"
          >
            <ImageUp size={14} strokeWidth={1.75} /> Replace image…
          </button>
          <TextField label="Alt text" value={info.attrs.alt ?? ""} placeholder="Describe the image" onCommit={(v) => attr("alt", v || null)} />
        </Section>
      )}

      {(info.tag === "a" || info.attrs.href !== undefined) && (
        <Section title="Link">
          <TextField label="URL" value={info.attrs.href ?? ""} placeholder="https://" onCommit={(v) => attr("href", v || null)} />
          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            <input
              type="checkbox"
              checked={info.attrs.target === "_blank"}
              onChange={(e) => attr("target", e.target.checked ? "_blank" : null)}
              className="accent-[var(--accent)]"
            />
            Open in a new tab
          </label>
        </Section>
      )}

      <Section title="Text">
        <ColorField label="Colour" value={val("color")} fallback={ph("color")} onChange={(v) => style("color", v)} />
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Size" value={val("font-size")} placeholder={ph("font-size")} onCommit={(v) => style("font-size", v)} />
          <SelectField
            label="Weight"
            value={val("font-weight")}
            placeholder={ph("font-weight")}
            options={["300", "400", "500", "600", "700", "800"]}
            onChange={(v) => style("font-weight", v)}
          />
          <TextField label="Line height" value={val("line-height")} placeholder={ph("line-height")} onCommit={(v) => style("line-height", v)} />
          <TextField label="Letter spacing" value={val("letter-spacing")} placeholder={ph("letter-spacing")} onCommit={(v) => style("letter-spacing", v)} />
        </div>
        <AlignField value={val("text-align") || ph("text-align")} onChange={(v) => style("text-align", v)} />
      </Section>

      <Section title="Fill">
        <ColorField
          label="Background"
          value={val("background-color")}
          fallback={isTransparent(ph("background-color")) ? "" : ph("background-color")}
          onChange={(v) => style("background-color", v)}
        />
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Radius" value={val("border-radius")} placeholder={ph("border-radius")} onCommit={(v) => style("border-radius", v)} />
          <TextField label="Opacity" value={val("opacity")} placeholder={ph("opacity")} onCommit={(v) => style("opacity", v)} />
        </div>
      </Section>

      <Section title="Spacing">
        <BoxField label="Padding" prop="padding" info={info} onCommit={style} />
        <BoxField label="Margin" prop="margin" info={info} onCommit={style} />
      </Section>

      <Section title="Size">
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Width" value={val("width")} placeholder={ph("width")} onCommit={(v) => style("width", v)} />
          <TextField label="Max width" value={val("max-width")} placeholder={ph("max-width")} onCommit={(v) => style("max-width", v)} />
        </div>
      </Section>

      <div className="mt-1 flex gap-1.5 px-4">
        <ActionButton icon={<Copy size={13.5} />} label="Duplicate" onClick={() => session?.duplicate(qid)} />
        <ActionButton icon={<Code2 size={13.5} />} label="Code" onClick={() => void showInCode()} />
        {tab.share && <ActionButton icon={<MessageSquarePlus size={13.5} />} label="Comment" onClick={() => useComments.getState().draftFromSelection(tab.id, info)} />}
        <ActionButton icon={<Trash2 size={13.5} />} label="Delete" danger onClick={() => session?.remove(qid)} />
      </div>
    </div>
  );
}

function Header({ info, tabId }: { info: ElementInfo; tabId: string }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 text-[11px] text-ink-3">
        {info.crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span>›</span>}
            <button
              type="button"
              disabled={c.qid === null || i === info.crumbs.length - 1}
              onClick={() => postToFrame(tabId, { type: "select", qid: c.qid, scroll: true })}
              className={clsx("rounded px-1 font-mono", i === info.crumbs.length - 1 ? "bg-accent-soft text-accent" : "hover:bg-hover hover:text-ink")}
            >
              {c.tag}
            </button>
          </span>
        ))}
      </div>
      {(info.id || info.classes.length > 0) && (
        <div className="mt-1.5 truncate font-mono text-[11px] text-ink-3">
          {info.id && `#${info.id} `}
          {info.classes.map((c) => `.${c}`).join(" ")}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5 border-b border-line px-4 py-3.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

const inputClass =
  "h-7 w-full min-w-0 rounded-md border border-line-strong bg-surface px-2 text-[12px] text-ink outline-none transition-shadow placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]";

function Label({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-[11px] text-ink-2">{children}</span>;
}

/** Text input that commits on Enter or blur, and resets when the selection changes. */
function TextField({ label, value, placeholder, onCommit }: { label?: string; value: string; placeholder?: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return (
    <label className="block min-w-0">
      {label && <Label>{label}</Label>}
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(value);
        }}
        className={inputClass}
      />
    </label>
  );
}

function SelectField({ label, value, placeholder, options, onChange }: { label: string; value: string; placeholder: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="block min-w-0">
      <Label>{label}</Label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={clsx(inputClass, "pr-1")}>
        <option value="">{placeholder ? `Auto (${placeholder})` : "Auto"}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function ColorField({ label, value, fallback, onChange }: { label: string; value: string; fallback: string; onChange: (v: string) => void }) {
  const shown = value || fallback;
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <label
          className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--border-strong)]"
          style={{ background: shown || "repeating-conic-gradient(var(--hover) 0 25%, transparent 0 50%) 0 0/8px 8px" }}
        >
          <input type="color" value={toHex(shown)} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
        <TextField value={value} placeholder={shown ? toHex(shown) : "None"} onCommit={onChange} />
      </div>
    </div>
  );
}

function AlignField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const items = [
    { v: "left", Icon: AlignLeft },
    { v: "center", Icon: AlignCenter },
    { v: "right", Icon: AlignRight },
    { v: "justify", Icon: AlignJustify },
  ];
  const current = value === "start" ? "left" : value === "end" ? "right" : value;
  return (
    <div className="flex rounded-md bg-hover p-0.5">
      {items.map(({ v, Icon }) => (
        <button
          key={v}
          type="button"
          aria-label={`Align ${v}`}
          aria-pressed={current === v}
          onClick={() => onChange(v)}
          className={clsx("flex h-6 flex-1 items-center justify-center rounded", current === v ? "bg-surface text-ink shadow-[0_0_0_1px_var(--border)]" : "text-ink-3 hover:text-ink")}
        >
          <Icon size={13} />
        </button>
      ))}
    </div>
  );
}

function BoxField({ label, prop, info, onCommit }: { label: string; prop: "padding" | "margin"; info: ElementInfo; onCommit: (p: string, v: string) => void }) {
  const sides = ["top", "right", "bottom", "left"] as const;
  return (
    <div>
      <Label>{label}</Label>
      <div className="grid grid-cols-4 gap-1.5">
        {sides.map((side) => {
          const p = `${prop}-${side}`;
          return (
            <div key={side} title={`${label} ${side}`}>
              <TextField value={info.inline[p] ?? ""} placeholder={(info.computed[p] ?? "").replace("px", "")} onCommit={(v) => onCommit(p, v)} />
              <span className="mt-0.5 block text-center text-[10px] uppercase text-ink-3">{side[0]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionButton({ icon, label, onClick, danger }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface text-[12px] font-medium transition-colors",
        danger ? "text-danger hover:bg-danger-soft" : "text-ink hover:bg-hover",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
