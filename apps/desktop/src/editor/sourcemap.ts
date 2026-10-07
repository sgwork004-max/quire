import { parse } from "parse5";

/**
 * Maps elements in an HTML source string to their exact character ranges, so
 * visual edits change only the bytes they touch and the rest of the file
 * (formatting, comments, attribute order) stays exactly as the author wrote it.
 *
 * Each mappable element gets a `qid` (its index in document order). Quire
 * serves a copy of the source with `data-qid` attributes added, and the bridge
 * inside the preview reports edits by qid.
 */

export interface MappedElement {
  qid: number;
  tag: string;
  /** Offset of `<` of the start tag. */
  start: number;
  /** Offset just after `>` of the start tag. */
  startTagEnd: number;
  /** Offset where the content ends (start of the end tag), or null for void elements. */
  innerEnd: number | null;
  /** Offset just after the whole element. */
  end: number;
  attrs: Record<string, { start: number; end: number }>;
}

export interface Change {
  from: number;
  to: number;
  insert: string;
}

/** Elements whose content is not visible page content. */
const SKIP_SUBTREE = new Set(["head", "script", "style", "template", "noscript", "title"]);
const NOT_MAPPED = new Set(["html", "body", "#document", "#document-fragment"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

interface P5Node {
  nodeName: string;
  tagName?: string;
  childNodes?: P5Node[];
  sourceCodeLocation?: {
    startOffset: number;
    endOffset: number;
    startTag?: { startOffset: number; endOffset: number };
    endTag?: { startOffset: number; endOffset: number };
    attrs?: Record<string, { startOffset: number; endOffset: number }>;
  } | null;
}

export function buildMap(source: string): MappedElement[] {
  const doc = parse(source, { sourceCodeLocationInfo: true }) as unknown as P5Node;
  const out: MappedElement[] = [];

  const walk = (node: P5Node, inSvg: boolean) => {
    for (const child of node.childNodes ?? []) {
      if (!child.tagName) continue;
      const tag = child.tagName;
      if (SKIP_SUBTREE.has(tag)) continue;
      const loc = child.sourceCodeLocation;
      const mappable = !inSvg && !NOT_MAPPED.has(tag) && loc?.startTag;
      if (mappable && loc?.startTag) {
        const isVoid = VOID.has(tag);
        const attrs: MappedElement["attrs"] = {};
        for (const [name, a] of Object.entries(loc.attrs ?? {})) attrs[name] = { start: a.startOffset, end: a.endOffset };
        out.push({
          qid: out.length,
          tag,
          start: loc.startTag.startOffset,
          startTagEnd: loc.startTag.endOffset,
          innerEnd: isVoid ? null : (loc.endTag?.startOffset ?? loc.endOffset),
          end: loc.endTag?.endOffset ?? loc.endOffset,
          attrs,
        });
      }
      // Only the <svg> element itself is editable, not its drawing primitives.
      walk(child, inSvg || tag === "svg");
    }
  };
  walk(doc, false);
  return out;
}

/** The source with `data-qid="N"` added to every mapped start tag. */
export function annotate(source: string, map: MappedElement[]): string {
  let out = "";
  let last = 0;
  for (const el of map) {
    const name = /^<([^\s/>]+)/.exec(source.slice(el.start, el.startTagEnd));
    if (!name) continue;
    const at = el.start + name[0].length;
    out += source.slice(last, at) + ` data-qid="${el.qid}"`;
    last = at;
  }
  return out + source.slice(last);
}

export function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function replaceInner(el: MappedElement, html: string): Change | null {
  if (el.innerEnd === null) return null;
  return { from: el.startTagEnd, to: el.innerEnd, insert: html };
}

/** Sets, replaces or (with `value === null`) removes one attribute. */
export function setAttr(source: string, el: MappedElement, name: string, value: string | null): Change | null {
  const existing = el.attrs[name.toLowerCase()];
  if (existing) {
    if (value === null) {
      let from = existing.start;
      while (from > el.start && /\s/.test(source[from - 1])) from--;
      return { from, to: existing.end, insert: "" };
    }
    return { from: existing.start, to: existing.end, insert: `${name}="${escapeAttr(value)}"` };
  }
  if (value === null) return null;
  let at = el.startTagEnd - 1;
  if (source[at - 1] === "/") at--;
  while (at > el.start && /\s/.test(source[at - 1])) at--;
  return { from: at, to: at, insert: ` ${name}="${escapeAttr(value)}"` };
}

/** If the element sits alone on its line(s), the range of those whole lines. */
function ownLines(source: string, el: MappedElement): { from: number; to: number; indent: string } | null {
  const lineStart = source.lastIndexOf("\n", el.start - 1) + 1;
  const before = source.slice(lineStart, el.start);
  const nl = source.indexOf("\n", el.end);
  const lineEnd = nl === -1 ? source.length : nl;
  if (before.trim() || source.slice(el.end, lineEnd).trim()) return null;
  return { from: lineStart, to: nl === -1 ? lineEnd : nl + 1, indent: before };
}

export function removeElement(source: string, el: MappedElement): Change {
  const lines = ownLines(source, el);
  return lines ? { from: lines.from, to: lines.to, insert: "" } : { from: el.start, to: el.end, insert: "" };
}

export function duplicateElement(source: string, el: MappedElement): Change {
  const html = source.slice(el.start, el.end);
  const lines = ownLines(source, el);
  return lines
    ? { from: el.end, to: el.end, insert: `\n${lines.indent}${html}` }
    : { from: el.end, to: el.end, insert: html };
}
