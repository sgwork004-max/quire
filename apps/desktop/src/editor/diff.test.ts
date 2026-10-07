import { describe, expect, it } from "vitest";
import { lineDiff } from "./diff";

describe("lineDiff", () => {
  it("counts changes and folds unchanged runs", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "line ten");
    const { rows, added, removed } = lineDiff(before, after);
    expect([added, removed]).toEqual([1, 1]);
    expect(rows[0]).toEqual({ kind: "skip", count: 7 });
    expect(rows.filter((r) => r.kind === "del").map((r) => "text" in r && r.text)).toEqual(["line 10"]);
    expect(rows[rows.length - 1]).toEqual({ kind: "skip", count: 6 });
  });

  it("returns nothing to show for identical text", () => {
    expect(lineDiff("a\nb", "a\nb")).toEqual({ rows: [{ kind: "skip", count: 2 }], added: 0, removed: 0 });
  });
});
