import { diffLines } from "diff";

export type DiffRow =
  | { kind: "same" | "add" | "del"; text: string; oldNo: number | null; newNo: number | null }
  | { kind: "skip"; count: number };

const CONTEXT = 3;

/** Line diff from `before` to `after`, with long unchanged runs collapsed. */
export function lineDiff(before: string, after: string): { rows: DiffRow[]; added: number; removed: number } {
  const rows: DiffRow[] = [];
  let oldNo = 1;
  let newNo = 1;
  let added = 0;
  let removed = 0;
  for (const part of diffLines(before, after)) {
    const lines = part.value.replace(/\n$/, "").split("\n");
    for (const text of lines) {
      if (part.added) {
        rows.push({ kind: "add", text, oldNo: null, newNo: newNo++ });
        added++;
      } else if (part.removed) {
        rows.push({ kind: "del", text, oldNo: oldNo++, newNo: null });
        removed++;
      } else {
        rows.push({ kind: "same", text, oldNo: oldNo++, newNo: newNo++ });
      }
    }
  }

  // Keep CONTEXT lines around each change; fold the rest.
  const keep = rows.map((r) => r.kind !== "same");
  rows.forEach((r, i) => {
    if (r.kind === "same") return;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(rows.length - 1, i + CONTEXT); j++) keep[j] = true;
  });
  const out: DiffRow[] = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    if (keep[i]) {
      if (skipped) out.push({ kind: "skip", count: skipped });
      skipped = 0;
      out.push(r);
    } else {
      skipped++;
    }
  });
  if (skipped) out.push({ kind: "skip", count: skipped });
  return { rows: out, added, removed };
}
