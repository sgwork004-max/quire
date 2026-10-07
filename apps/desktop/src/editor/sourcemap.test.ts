import { describe, expect, it } from "vitest";
import { annotate, buildMap, duplicateElement, removeElement, replaceInner, setAttr, type Change } from "./sourcemap";

const apply = (s: string, c: Change | null) => (c ? s.slice(0, c.from) + c.insert + s.slice(c.to) : s);

const SRC = `<!doctype html>
<html>
<head><title>T</title><style>p{}</style></head>
<body>
  <h1 class='big'>Hello <b>world</b></h1>
  <p>One</p>
  <img src="a.png" />
  <svg><circle r="2"/></svg>
  <script>document.write("<p>x</p>")</script>
</body>
</html>`;

describe("sourcemap", () => {
  const map = buildMap(SRC);
  const byTag = (t: string) => map.find((m) => m.tag === t)!;

  it("maps visible elements only, in document order", () => {
    expect(map.map((m) => m.tag)).toEqual(["h1", "b", "p", "img", "svg"]);
    expect(map.map((m) => m.qid)).toEqual([0, 1, 2, 3, 4]);
  });

  it("annotates start tags without touching anything else", () => {
    const out = annotate(SRC, map);
    expect(out).toContain(`<h1 data-qid="0" class='big'>Hello <b data-qid="1">world</b></h1>`);
    expect(out).toContain(`<img data-qid="3" src="a.png" />`);
    expect(out.replace(/ data-qid="\d+"/g, "")).toBe(SRC);
  });

  it("replaces inner html", () => {
    const out = apply(SRC, replaceInner(byTag("h1"), "Hi <i>there</i>"));
    expect(out).toContain(`<h1 class='big'>Hi <i>there</i></h1>`);
    expect(replaceInner(byTag("img"), "x")).toBeNull();
  });

  it("sets, adds and removes attributes", () => {
    expect(apply(SRC, setAttr(SRC, byTag("img"), "src", `b "c".png`))).toContain(`<img src="b &quot;c&quot;.png" />`);
    expect(apply(SRC, setAttr(SRC, byTag("img"), "alt", "Logo"))).toContain(`<img src="a.png" alt="Logo" />`);
    expect(apply(SRC, setAttr(SRC, byTag("p"), "style", "color: red;"))).toContain(`<p style="color: red;">One</p>`);
    expect(apply(SRC, setAttr(SRC, byTag("h1"), "class", null))).toContain(`<h1>Hello`);
  });

  it("removes and duplicates whole lines", () => {
    expect(apply(SRC, removeElement(SRC, byTag("p")))).toContain(`</h1>\n  <img`);
    expect(apply(SRC, duplicateElement(SRC, byTag("p")))).toContain(`  <p>One</p>\n  <p>One</p>\n`);
    expect(apply(SRC, removeElement(SRC, byTag("b")))).toContain(`<h1 class='big'>Hello </h1>`);
  });

  it("handles implicitly closed elements and unicode", () => {
    const s = "<ul><li>₹ one<li>two</ul>";
    const m = buildMap(s);
    expect(m.map((x) => x.tag)).toEqual(["ul", "li", "li"]);
    expect(apply(s, replaceInner(m[1], "₹ uno"))).toBe("<ul><li>₹ uno<li>two</ul>");
  });
});
