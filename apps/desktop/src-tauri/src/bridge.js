// Quire bridge. Injected into every document Quire shows (see protocol.rs).
//
// It runs inside the sandboxed document origin and talks to the Quire window
// only through postMessage. It never reads files or calls native code. It:
//   1. keeps the scroll position across live reloads, and
//   2. powers Visual mode: hover/select outlines, inline text editing and
//      live style/attribute previews. Elements are identified by `data-qid`,
//      which Quire adds to its in-memory copy of the source when editing.
//   3. powers comments: a "comment" mode that selects elements without
//      editing them, and numbered pins on elements that have comments.
(() => {
  if (window.parent === window || window.__quireBridge) return;
  window.__quireBridge = true;

  const ACCENT = "#3d5588"; // federal blue: your selection
  const OTHERS = "#ffb511"; // sunflower: comment pins (other people)
  const INLINE = new Set([
    "A", "ABBR", "B", "BR", "CITE", "CODE", "DEL", "EM", "I", "INS", "KBD", "MARK",
    "Q", "S", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR",
  ]);
  const NOT_TEXT = new Set(["HTML", "BODY", "HEAD", "IMG", "INPUT", "TEXTAREA", "SELECT", "BR", "HR", "SVG", "VIDEO", "CANVAS", "IFRAME", "SCRIPT", "STYLE"]);
  const STYLE_PROPS = [
    "color", "background-color", "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "border-radius", "width", "max-width", "opacity",
  ];

  const send = (msg) => window.parent.postMessage({ __quire: true, ...msg }, "*");

  // Tab shortcuts must work while the page has focus: ⌃Tab / ⌃⇧Tab switch
  // tabs (macOS keeps ⌃Tab from the menu bar), ⌃T opens a new tab.
  window.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.metaKey || e.altKey) return;
    const name = e.key === "Tab" ? (e.shiftKey ? "prev-tab" : "next-tab") : e.key.toLowerCase() === "t" && !e.shiftKey ? "new-tab" : null;
    if (!name) return;
    e.preventDefault();
    e.stopPropagation();
    send({ type: "shortcut", name });
  }, true);

  // ---------------------------------------------------------------- scroll
  const isThumb = window.name === "quire-thumb";
  const scrollKey = "__quire_scroll:" + location.pathname;
  if (!isThumb) {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(scrollKey) || "null"); } catch {}
    if (saved) {
      const restore = () => window.scrollTo(saved[0], saved[1]);
      document.addEventListener("DOMContentLoaded", restore);
      addEventListener("load", () => { restore(); setTimeout(restore, 60); });
    }
    let pending = false;
    addEventListener("scroll", () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        try { sessionStorage.setItem(scrollKey, JSON.stringify([scrollX, scrollY])); } catch {}
      });
    }, { passive: true });
  }

  // ---------------------------------------------------------------- visual mode
  let visual = false; // selecting elements (Visual or comment mode)
  let commentOnly = false; // comment mode: select, never edit
  let pins = []; // [{ id, qid, n, resolved, active }]
  let hovered = null;
  let selected = null;
  let editing = null;
  let editStart = null; // { html, count }
  let overlay = null;
  let pageStyle = null;
  let raf = 0;

  const qidOf = (el) => (el && el.dataset && el.dataset.qid ? Number(el.dataset.qid) : null);
  const byQid = (qid) => document.querySelector(`[data-qid="${qid}"]`);

  function isTextEditable(el) {
    if (qidOf(el) === null || NOT_TEXT.has(el.tagName)) return false;
    if (!el.textContent || !el.textContent.trim()) return false;
    for (const child of el.querySelectorAll("*")) if (!INLINE.has(child.tagName)) return false;
    return true;
  }

  function cleanInner(el) {
    const clone = el.cloneNode(true);
    clone.removeAttribute("contenteditable");
    for (const n of clone.querySelectorAll("[data-qid],[contenteditable]")) {
      n.removeAttribute("data-qid");
      n.removeAttribute("contenteditable");
    }
    return clone.innerHTML;
  }

  function describe(el) {
    const cs = getComputedStyle(el);
    const computed = {};
    for (const p of STYLE_PROPS) computed[p] = cs.getPropertyValue(p);
    const inline = {};
    for (const p of STYLE_PROPS) {
      const v = el.style.getPropertyValue(p);
      if (v) inline[p] = v;
    }
    const attrs = {};
    for (const name of ["src", "href", "alt", "title", "target"]) {
      if (el.hasAttribute(name)) attrs[name] = el.getAttribute(name);
    }
    const crumbs = [];
    for (let n = el; n && n !== document.body && crumbs.length < 4; n = n.parentElement) {
      crumbs.unshift({ tag: n.tagName.toLowerCase(), qid: qidOf(n) });
    }
    return {
      qid: qidOf(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: [...el.classList].slice(0, 4),
      crumbs,
      text: isTextEditable(el),
      attrs,
      computed,
      inline,
    };
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    const host = document.createElement("quire-overlay");
    host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .box{position:fixed;box-sizing:border-box;pointer-events:none;border-radius:2px;display:none}
        .hover{outline:1px solid ${ACCENT};outline-offset:-1px;background:rgb(61 85 136 / .06)}
        .hover.gen{outline:1px dashed #9aa0aa;background:none}
        .sel{outline:2px solid ${ACCENT};outline-offset:-1px}
        .sel.editing{outline-width:2px;box-shadow:0 0 0 4px rgb(61 85 136 / .2)}
        .label{position:fixed;display:none;font:600 10.5px/1 -apple-system,system-ui,sans-serif;color:#fff;
          background:${ACCENT};padding:3px 5px;border-radius:3px;white-space:nowrap;letter-spacing:.01em}
        .label.gen{background:#6b7280}
        .pin{position:fixed;pointer-events:auto;cursor:pointer;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;
          border-radius:11px 11px 11px 2px;background:${OTHERS};color:#2b2100;font:700 11px/22px -apple-system,system-ui,sans-serif;
          text-align:center;box-shadow:0 1px 3px rgb(0 0 0/.25),0 0 0 2px #fff;transition:transform .12s}
        .pin:hover,.pin.active{transform:scale(1.15)}
        .pin.resolved{background:#9aa0aa;color:#fff}
      </style>
      <div class="box hover"></div><div class="box sel"></div><div class="label"></div><div class="pins"></div>`;
    document.documentElement.appendChild(host);
    overlay = {
      host,
      hover: root.querySelector(".hover"),
      sel: root.querySelector(".sel"),
      label: root.querySelector(".label"),
      pins: root.querySelector(".pins"),
    };
    return overlay;
  }

  function place(box, el) {
    if (!el || !el.isConnected) { box.style.display = "none"; return null; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    return r;
  }

  function renderPins(o) {
    const nodes = o.pins.children;
    pins.forEach((p, i) => {
      let node = nodes[i];
      if (!node) {
        node = document.createElement("div");
        node.className = "pin";
        node.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          send({ type: "pin", id: node.dataset.id });
        });
        o.pins.appendChild(node);
      }
      const el = byQid(p.qid);
      if (!el) { node.style.display = "none"; return; }
      const r = el.getBoundingClientRect();
      node.dataset.id = p.id;
      node.textContent = String(p.n);
      node.className = "pin" + (p.resolved ? " resolved" : "") + (p.active ? " active" : "");
      node.style.display = r.bottom < 0 || r.top > innerHeight ? "none" : "block";
      node.style.left = Math.min(innerWidth - 26, Math.max(2, r.right - 11)) + "px";
      node.style.top = Math.max(2, r.top - 11) + "px";
    });
    while (nodes.length > pins.length) nodes[nodes.length - 1].remove();
  }

  function frame() {
    if (!visual && !pins.length) return;
    const o = ensureOverlay();
    renderPins(o);
    if (!visual) {
      o.hover.style.display = o.sel.style.display = o.label.style.display = "none";
      raf = requestAnimationFrame(frame);
      return;
    }
    place(o.hover, hovered && hovered !== selected ? hovered : null);
    o.hover.classList.toggle("gen", !!hovered && qidOf(hovered) === null);
    const r = place(o.sel, selected);
    o.sel.classList.toggle("editing", !!editing);
    if (r) {
      const gen = qidOf(selected) === null;
      const tag = selected.tagName.toLowerCase();
      o.label.textContent = commentOnly ? `Comment on ${tag}` : tag + (gen ? " · made by a script" : editing ? " · editing" : "");
      o.label.classList.toggle("gen", gen);
      o.label.style.display = "block";
      o.label.style.left = Math.max(2, r.left) + "px";
      o.label.style.top = (r.top > 22 ? r.top - 19 : r.bottom + 4) + "px";
    } else {
      o.label.style.display = "none";
    }
    raf = requestAnimationFrame(frame);
  }

  function select(el) {
    if (editing && el !== editing) stopEditing(true);
    selected = el;
    send({ type: "selected", info: el ? describe(el) : null });
  }

  function startEditing(el, x, y) {
    if (!isTextEditable(el)) return;
    editing = el;
    editStart = { html: cleanInner(el), count: el.getElementsByTagName("*").length };
    el.setAttribute("contenteditable", "true");
    el.focus({ preventScroll: true });
    const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    if (range && el.contains(range.startContainer)) {
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(range);
    }
    send({ type: "editing", on: true });
  }

  function stopEditing(commit) {
    const el = editing;
    if (!el) return;
    editing = null;
    el.removeAttribute("contenteditable");
    const html = cleanInner(el);
    if (commit && html !== editStart.html) {
      send({
        type: "commit-text",
        qid: qidOf(el),
        html,
        structureChanged: el.getElementsByTagName("*").length !== editStart.count,
      });
    } else if (!commit) {
      el.innerHTML = editStart.html;
    }
    editStart = null;
    getSelection().removeAllRanges();
    send({ type: "editing", on: false });
    if (selected === el) send({ type: "selected", info: describe(el) });
  }

  /** True for events on Quire's own overlay (pins), which pages never see. */
  const onOverlay = (e) => overlay && e.composedPath().includes(overlay.host);

  const pick = (target) => {
    let el = target instanceof Element ? target : target && target.parentElement;
    if (!el || el === document.documentElement) return null;
    if (overlay && overlay.host.contains(el)) return null;
    return el;
  };

  const handlers = {
    mousemove(e) {
      if (editing && editing.contains(e.target)) { hovered = null; return; }
      hovered = pick(e.target);
    },
    mouseleave() { hovered = null; },
    mousedown(e) {
      if (onOverlay(e)) return;
      if (editing && editing.contains(e.target)) return;
      e.preventDefault();
    },
    click(e) {
      if (onOverlay(e)) return;
      if (editing && editing.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const el = pick(e.target);
      if (el) select(el);
    },
    dblclick(e) {
      if (commentOnly) return;
      if (editing && editing.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const el = pick(e.target);
      if (!el) return;
      if (el !== selected) select(el);
      startEditing(el, e.clientX, e.clientY);
    },
    submit(e) { e.preventDefault(); e.stopPropagation(); },
    keydown(e) {
      if (editing) {
        if (e.key === "Escape") { e.preventDefault(); stopEditing(true); }
        else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); stopEditing(true); }
        else if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); document.execCommand("insertLineBreak"); }
        return;
      }
      if (e.key === "Escape") { select(null); }
      else if (commentOnly) { /* comment mode never edits */ }
      else if ((e.key === "Backspace" || e.key === "Delete") && selected && qidOf(selected) !== null) {
        e.preventDefault();
        send({ type: "delete", qid: qidOf(selected) });
      } else if (e.key === "Enter" && selected && isTextEditable(selected)) {
        e.preventDefault();
        const r = selected.getBoundingClientRect();
        startEditing(selected, r.right - 2, r.bottom - 4);
      }
    },
    paste(e) {
      if (!editing) return;
      e.preventDefault();
      const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
      document.execCommand("insertText", false, text);
    },
    // Clicking anywhere outside the page (e.g. the inspector) commits the edit.
    blur(e) {
      if (editing && (e.target === window || e.target === editing)) stopEditing(true);
    },
  };

  function setVisual(on, onlyComments) {
    commentOnly = !!onlyComments;
    if (on === visual) return;
    visual = on;
    for (const [name, fn] of Object.entries(handlers)) {
      (name === "mouseleave" ? document.documentElement : window)[on ? "addEventListener" : "removeEventListener"](name, fn, true);
    }
    if (on) {
      pageStyle = document.createElement("style");
      pageStyle.textContent = "[contenteditable]{outline:none!important;cursor:text!important}*{cursor:default}";
      document.documentElement.appendChild(pageStyle);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    } else {
      stopEditing(true);
      hovered = selected = null;
      pageStyle && pageStyle.remove();
      pageStyle = null;
      if (!pins.length) {
        cancelAnimationFrame(raf);
        overlay && overlay.host.remove();
        overlay = null;
      }
    }
  }

  // ---------------------------------------------------------------- messages
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent || !e.data || !e.data.__quireParent) return;
    const m = e.data;
    switch (m.type) {
      case "mode":
        setVisual(m.mode === "visual" || m.mode === "comment", m.mode === "comment");
        break;
      case "pins": {
        const had = pins.length;
        pins = Array.isArray(m.pins) ? m.pins : [];
        if (!pins.length && !visual && overlay) {
          cancelAnimationFrame(raf);
          overlay.host.remove();
          overlay = null;
        } else if (pins.length && !had && !visual) {
          raf = requestAnimationFrame(frame);
        }
        break;
      }
      case "select": {
        const el = m.qid == null ? null : byQid(m.qid);
        select(el);
        if (el && m.scroll) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        break;
      }
      case "set-style": {
        const el = byQid(m.qid);
        if (!el) return;
        if (m.value) el.style.setProperty(m.prop, m.value);
        else el.style.removeProperty(m.prop);
        send({ type: "style-attr", qid: m.qid, style: el.getAttribute("style") || "" });
        if (el === selected) send({ type: "selected", info: describe(el) });
        break;
      }
      case "set-attr": {
        const el = byQid(m.qid);
        if (!el) return;
        if (m.value == null) el.removeAttribute(m.name);
        else el.setAttribute(m.name, m.value);
        if (el === selected) send({ type: "selected", info: describe(el) });
        break;
      }
      case "undo":
      case "redo":
        if (editing) document.execCommand(m.type);
        else send({ type: m.type + "-parent" });
        break;
    }
  });

  const announce = () => send({ type: "ready", count: document.querySelectorAll("[data-qid]").length });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", announce);
  else announce();
})();
