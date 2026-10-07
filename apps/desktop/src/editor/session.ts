import { Annotation, EditorState, Transaction } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { html } from "@codemirror/lang-html";
import { errorMessage, ipc, type DocumentInfo } from "../lib/ipc";
import { useApp, type SaveStatus } from "../store/app";
import { annotate, buildMap, duplicateElement, removeElement, replaceInner, setAttr, type Change, type MappedElement } from "./sourcemap";
import { quireTheme } from "./theme";

const SAVE_DELAY = 600;
const PREVIEW_DELAY = 250;

/**
 * How a change should reach the preview. Visual edits that the bridge has
 * already applied to the live page skip the reload so the user keeps their
 * place; everything else reloads.
 */
const PreviewUpdate = Annotation.define<"reload" | "silent">();
const FromDisk = Annotation.define<boolean>();

/**
 * The editing state of one open document: a CodeMirror buffer that is the
 * single source of truth for both Code and Visual mode, autosave, the
 * in-memory preview overlay, and conflict handling for changes made on disk.
 */
export class EditorSession {
  readonly view: EditorView;
  readonly id: string;
  /** Content last known to be on disk. */
  private saved: string;
  /** Disk content waiting for the user to resolve a conflict. */
  private theirs: string | null = null;
  /** The annotated source currently served to the preview, and its map. */
  private served: { source: string; map: MappedElement[] } | null = null;
  private live = false;
  private saveTimer = 0;
  private previewTimer = 0;
  private saving: Promise<void> | null = null;

  constructor(doc: DocumentInfo, content: string) {
    this.id = doc.id;
    this.saved = content;
    this.view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          html({ autoCloseTags: true, matchClosingTags: true }),
          EditorView.lineWrapping,
          quireTheme,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            const tr = u.transactions.find((t) => t.docChanged);
            if (!tr?.annotation(FromDisk)) this.markDirty();
            this.onChange(tr?.annotation(PreviewUpdate) ?? "typing");
          }),
        ],
      }),
    });
  }

  get text(): string {
    return this.view.state.doc.toString();
  }

  private setStatus(status: SaveStatus) {
    useApp.setState((s) => (s.status[this.id] === status ? s : { status: { ...s.status, [this.id]: status } }));
  }

  private markDirty() {
    if (this.theirs === null) this.setStatus("dirty");
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), SAVE_DELAY);
  }

  private onChange(update: "reload" | "silent" | "typing") {
    if (!this.live) return;
    window.clearTimeout(this.previewTimer);
    if (update === "typing") {
      this.previewTimer = window.setTimeout(() => void this.serve(true), PREVIEW_DELAY);
    } else {
      // "silent": the page already shows this change, keep the served copy in sync.
      void this.serve(update === "reload");
    }
  }

  /** Serves the current buffer (annotated for Visual mode) to the preview. */
  private async serve(reload: boolean) {
    const source = this.text;
    const map = buildMap(source);
    this.served = { source, map };
    await ipc.setOverlay(this.id, annotate(source, map));
    if (reload) useApp.getState().reload(this.id);
  }

  async setLive(live: boolean) {
    this.live = live;
    window.clearTimeout(this.previewTimer);
    if (live) {
      await this.serve(true);
    } else {
      this.served = null;
      await ipc.setOverlay(this.id, null);
      useApp.getState().reload(this.id);
    }
  }

  async save(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    if (this.theirs !== null) return; // never overwrite a conflict silently
    if (this.saving) await this.saving;
    const content = this.text;
    if (content === this.saved) {
      this.setStatus("saved");
      return;
    }
    this.setStatus("saving");
    this.saving = ipc
      .writeDocument(this.id, content)
      .then(() => {
        this.saved = content;
        this.setStatus(this.text === content ? "saved" : "dirty");
      })
      .catch((e) => {
        this.setStatus("error");
        useApp.getState().toast(`Couldn't save: ${errorMessage(e)}`);
      })
      .finally(() => {
        this.saving = null;
      });
    await this.saving;
  }

  async flush() {
    await this.save();
  }

  /** The file changed on disk (another editor, an AI tool, a restore). */
  async onDiskChange() {
    if (this.saving) await this.saving;
    const { content } = await ipc.readDocument(this.id);
    if (content === this.saved || content === this.text) {
      this.saved = content;
      return;
    }
    if (this.text === this.saved) {
      this.loadFromDisk(content);
    } else {
      this.theirs = content;
      this.setStatus("conflict");
    }
  }

  /** Replaces the buffer with content that is already on disk. Undoable. */
  loadFromDisk(content: string) {
    this.saved = content;
    this.theirs = null;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: content },
      annotations: [FromDisk.of(true), Transaction.userEvent.of("input.disk")],
    });
    this.setStatus("saved");
  }

  resolveConflict(keep: "mine" | "theirs") {
    const theirs = this.theirs;
    if (theirs === null) return;
    if (keep === "theirs") {
      this.loadFromDisk(theirs);
    } else {
      this.theirs = null;
      this.saved = theirs;
      void this.save();
    }
  }

  undo() {
    undo(this.view);
  }

  redo() {
    redo(this.view);
  }

  // ------------------------------------------------------------ visual edits

  /**
   * Looks up an element the preview reported. Returns null if the buffer
   * changed since the preview was served (the ids would be stale).
   */
  private element(qid: number): MappedElement | null {
    if (!this.served || this.served.source !== this.text) return null;
    return this.served.map[qid] ?? null;
  }

  private apply(change: Change | null, update: "reload" | "silent", event: string): boolean {
    if (!change) return false;
    this.view.dispatch({
      changes: change,
      annotations: [PreviewUpdate.of(update), Transaction.userEvent.of(event)],
      scrollIntoView: false,
    });
    return true;
  }

  private withElement(qid: number, fn: (el: MappedElement, source: string) => boolean): boolean {
    const el = this.element(qid);
    if (!el) {
      useApp.getState().toast("The preview was still updating. Try that again.");
      return false;
    }
    return fn(el, this.text);
  }

  replaceText(qid: number, html: string, structureChanged: boolean) {
    return this.withElement(qid, (el) =>
      this.apply(replaceInner(el, html), structureChanged ? "reload" : "silent", "input.visual.text"),
    );
  }

  setAttribute(qid: number, name: string, value: string | null, update: "reload" | "silent" = "silent") {
    return this.withElement(qid, (el, src) => this.apply(setAttr(src, el, name, value), update, "input.visual.attr"));
  }

  remove(qid: number) {
    return this.withElement(qid, (el, src) => this.apply(removeElement(src, el), "reload", "delete.visual"));
  }

  duplicate(qid: number) {
    return this.withElement(qid, (el, src) => this.apply(duplicateElement(src, el), "reload", "input.visual.duplicate"));
  }

  /** Puts the code cursor on an element (used when switching Visual -> Code). */
  revealElement(qid: number) {
    const el = this.element(qid);
    if (!el) return;
    this.view.dispatch({ selection: { anchor: el.start }, scrollIntoView: true });
  }

  destroy() {
    window.clearTimeout(this.saveTimer);
    window.clearTimeout(this.previewTimer);
    this.view.destroy();
  }
}

const sessions = new Map<string, EditorSession>();

export function getSession(id: string): EditorSession | undefined {
  return sessions.get(id);
}

export async function ensureSession(doc: DocumentInfo): Promise<EditorSession> {
  const existing = sessions.get(doc.id);
  if (existing) return existing;
  const { content } = await ipc.readDocument(doc.id);
  const session = sessions.get(doc.id) ?? new EditorSession(doc, content);
  sessions.set(doc.id, session);
  useApp.setState((s) => ({ status: { ...s.status, [doc.id]: "saved" } }));
  return session;
}

export async function closeSession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  await session.flush();
  session.destroy();
  sessions.delete(id);
}

/** Saves every open editor (used before quitting). */
export async function flushAll() {
  await Promise.all([...sessions.values()].map((s) => s.flush()));
}
