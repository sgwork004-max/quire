import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** Editor chrome and syntax colours, all from CSS tokens so light/dark just work. */
export const quireTheme = [
  EditorView.theme({
    "&": { height: "100%", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "12.5px" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65", overscrollBehavior: "contain" },
    ".cm-content": { padding: "12px 0", caretColor: "var(--accent)" },
    ".cm-line": { padding: "0 16px 0 8px" },
    ".cm-gutters": { backgroundColor: "var(--surface)", color: "var(--text-3)", border: "none", paddingLeft: "6px" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-2)" },
    ".cm-activeLine": { backgroundColor: "var(--hover)" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--syntax-selection) !important",
    },
    ".cm-matchingBracket": { backgroundColor: "var(--active)", outline: "none" },
    ".cm-foldGutter span": { color: "var(--text-3)" },
    ".cm-searchMatch": { backgroundColor: "var(--syntax-match)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--accent-soft)", outline: "1px solid var(--accent)" },
    ".cm-panels": { backgroundColor: "var(--sidebar)", color: "var(--text)", borderColor: "var(--border)" },
    ".cm-panels input, .cm-panels button": { fontFamily: "var(--font-sans)", fontSize: "12px" },
    ".cm-textfield": {
      backgroundColor: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: "5px", padding: "3px 6px",
    },
    ".cm-button": {
      backgroundImage: "none", backgroundColor: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: "5px",
    },
    ".cm-tooltip": { backgroundColor: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: "8px", overflow: "hidden" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--accent)", color: "var(--accent-fg)" },
    ".cm-flash": { animation: "cm-flash 900ms ease-out" },
  }),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: [t.tagName, t.angleBracket], color: "var(--syntax-tag)" },
      { tag: t.attributeName, color: "var(--syntax-attr)" },
      { tag: [t.attributeValue, t.string], color: "var(--syntax-string)" },
      { tag: [t.comment, t.meta], color: "var(--syntax-comment)", fontStyle: "italic" },
      { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "var(--syntax-keyword)" },
      { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syntax-number)" },
      { tag: [t.propertyName, t.definition(t.variableName)], color: "var(--syntax-prop)" },
      { tag: [t.function(t.variableName), t.className, t.typeName], color: "var(--syntax-fn)" },
      { tag: [t.punctuation, t.bracket, t.separator], color: "var(--text-2)" },
      { tag: t.invalid, color: "var(--accent)" },
    ]),
  ),
];
