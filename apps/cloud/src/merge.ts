import DiffMatchPatch from "diff-match-patch";
import type * as Y from "yjs";

const dmp = new DiffMatchPatch();
dmp.Diff_Timeout = 1;
dmp.Match_Threshold = 0.4;

/**
 * Three-way merge of a full-text edit made offline (or by another app) into the
 * live document: the change from `base` to `next` is turned into a patch and
 * applied to the current text, so concurrent edits elsewhere survive.
 */
export function mergeText(current: string, base: string, next: string): string {
  if (base === current) return next;
  if (base === next) return current;
  const patches = dmp.patch_make(base, next);
  const [merged] = dmp.patch_apply(patches, current);
  return merged;
}

/** Replaces the content of `text` with `target` using minimal Yjs operations. */
export function applyMinimalChange(text: Y.Text, target: string): boolean {
  const current = text.toString();
  if (current === target) return false;
  const diffs = dmp.diff_main(current, target);
  dmp.diff_cleanupEfficiency(diffs);
  let index = 0;
  for (const [op, chunk] of diffs) {
    if (op === 0) index += chunk.length;
    else if (op === -1) text.delete(index, chunk.length);
    else {
      text.insert(index, chunk);
      index += chunk.length;
    }
  }
  return true;
}
