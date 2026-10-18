import type { Change } from "./sourcemap";

export interface AiEdit {
  find: string;
  replace: string;
}

/**
 * Turns Claude's find/replace edits into exact changes. Every `find` must
 * occur exactly once and edits may not overlap; otherwise nothing is applied,
 * so a page is never left half-edited.
 */
export function planChanges(source: string, edits: AiEdit[]): { changes: Change[]; result: string } {
  const changes: Change[] = [];
  for (const [i, e] of edits.entries()) {
    if (!e.find) throw new Error(`Edit ${i + 1} is empty.`);
    const at = source.indexOf(e.find);
    if (at === -1) throw new Error("Claude's edit didn't match the current page (it may have changed). Try again.");
    if (source.indexOf(e.find, at + 1) !== -1) throw new Error("Claude's edit matched more than one place. Try a more specific request.");
    changes.push({ from: at, to: at + e.find.length, insert: e.replace });
  }
  changes.sort((a, b) => a.from - b.from);
  for (let i = 1; i < changes.length; i++) {
    if (changes[i].from < changes[i - 1].to) throw new Error("Claude's edits overlapped. Try again.");
  }
  let result = "";
  let last = 0;
  for (const c of changes) {
    result += source.slice(last, c.from) + c.insert;
    last = c.to;
  }
  return { changes, result: result + source.slice(last) };
}
