import { describe, expect, it } from "vitest";
import { planChanges } from "./aiEdits";

const SRC = "<h1>Sales</h1>\n<p>Up 12%</p>\n<p>Down 3%</p>";

describe("planChanges", () => {
  it("applies non-overlapping unique edits in any order", () => {
    const { result, changes } = planChanges(SRC, [
      { find: "<p>Down 3%</p>", replace: "<p>Down 2%</p>" },
      { find: "<h1>Sales</h1>", replace: "<h1>Revenue</h1>" },
    ]);
    expect(result).toBe("<h1>Revenue</h1>\n<p>Up 12%</p>\n<p>Down 2%</p>");
    expect(changes.map((c) => c.from)).toEqual([0, SRC.indexOf("<p>Down")]);
  });

  it("rejects missing, ambiguous and overlapping edits", () => {
    expect(() => planChanges(SRC, [{ find: "<h2>", replace: "" }])).toThrow(/didn't match/);
    expect(() => planChanges(SRC, [{ find: "<p>", replace: "<p class=x>" }])).toThrow(/more than one/);
    expect(() =>
      planChanges(SRC, [
        { find: "<h1>Sales</h1>\n<p>Up", replace: "a" },
        { find: "Sales</h1>", replace: "b" },
      ]),
    ).toThrow(/overlapped/);
  });
});
