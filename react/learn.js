"use strict";

// Turns traced frames into guarded templates.
//
// For every frame (component invocation or map-callback invocation) we build a path of decisions
// (the trace's branch outcomes, followed by value-class guards the output relies on) and a leaf
// ("Out" tree: constant HTML chunks from the real ReactDOMServer, slots, child template calls,
// loops). Paths are merged into one decision trie per template.
//
// Host element HTML is never re-implemented: each element is rendered by the real
// ReactDOMServer.renderToString with private-use marker strings in place of symbolic values, and
// cut at the markers. A slot transform (attribute/text escaping, style value) is only used after
// probing React with a battery of values of the guarded class; otherwise the value is pinned by an
// equality guard.

const E = require("./expr");
const { NoExpr } = E;

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
  "menuitem",
]);
// Elements whose output depends on their children/value or on an ancestor: rendered as one
// constant subtree (all values inside pinned by equality guards).
const WHOLE_TAGS = new Set(["select", "textarea", "pre", "listing", "svg", "math", "noscript"]);
const CONTEXT_TAGS = new Set(["option", "optgroup"]);
const WHOLE_SLOT_OK = /^(id|className|name|title|htmlFor|placeholder|lang|role|tabIndex|(data|aria)-.*)$/;

const REACT_PROVIDER = Symbol.for("react.provider");
const PASS_THROUGH = new Set([Symbol.for("react.fragment"), Symbol.for("react.strict_mode"), Symbol.for("react.profiler")]);

const ESC = { '"': "&quot;", "&": "&amp;", "'": "&#x27;", "<": "&lt;", ">": "&gt;" };
function escapeHtml(s) {
  return /["'&<>]/.test(s) ? s.replace(/["'&<>]/g, (c) => ESC[c]) : s;
}

const PROBE_STRINGS = ["", "a", "x y", " lead trail ", "&<>\"'", "javascript:alert(1)", "0", "false", "true", "null", "é😀\u2028"];
const PROBE_NUMBERS = [0, -0, 1, -1.5, 1e21, 1e-7, NaN, Infinity, -Infinity, 42];
const PROBE_STYLE_S = ["a", " 50% ", "&<>\"'", "  ", "0", "x y", "javascript:x"];
const PROBE_STYLE_M = [1, -2.5, NaN, Infinity, 1e21, 1e-7, 42, 0.5];
const PROBE_HTML = ["", "<b>&amp;</b>", "x", "\"'<"];

class Unsupported extends Error {}

class Learner {
  constructor({ tracer, React, RDS, fns }) {
    this.tr = tracer;
    this.React = React;
    this.RDS = RDS;
    this.fns = fns;
    this.tries = new Map(); // "c<fid>" | "b<fid>" -> trie root
    this.conflicts = new Map(); // template key -> count
    this.probeCache = new Map();
    this.stats = { frames: 0, learned: 0, poisoned: new Map(), unsupported: new Map(), newPaths: 0 };
  }

  render(el) {
    return this.RDS.renderToString(el);
  }

  // ----------------------------------------------------------------------------- frames

  learnFrames(frames) {
    for (const f of frames) {
      this.stats.frames++;
      const key = (f.kind === "comp" ? "c" : "b") + f.fid;
      if (f.poisoned) {
        bump(this.stats.poisoned, f.poisoned);
        continue;
      }
      let compiled;
      const prevCur = this.tr.st.cur;
      this.tr.st.cur = f;
      try {
        compiled = this.compileFrame(f);
      } catch (err) {
        if (!(err instanceof Unsupported || err instanceof NoExpr)) throw err;
        bump(this.stats.unsupported, err.message);
        continue;
      } finally {
        this.tr.st.cur = prevCur;
      }
      this.insert(key, compiled.path, compiled.leaf);
      this.stats.learned++;
    }
  }

  insert(key, path, leaf) {
    if (!this.tries.has(key)) this.tries.set(key, {});
    let t = this.tries.get(key);
    if (t.conflict) return;
    const leafJson = JSON.stringify(leaf, (k, v) => (v && v.k && v.key && typeof v.key === "string" ? v.key : v));
    for (const d of path) {
      if (t.leaf) return this.conflict(key, "leaf before end of path");
      if (!t.dec) {
        t.dec = { kind: d.kind, node: d.node };
        t.edges = new Map();
      } else if (t.dec.kind !== d.kind || t.dec.node.key !== d.node.key) {
        return this.conflict(key, `decision ${t.dec.kind}:${t.dec.node.key} vs ${d.kind}:${d.node.key}`);
      }
      if (!t.edges.has(d.outcome)) {
        t.edges.set(d.outcome, {});
        this.stats.newPaths++;
      }
      t = t.edges.get(d.outcome);
    }
    if (t.dec) return this.conflict(key, "path ends at a decision");
    if (t.leaf) {
      if (t.leafJson !== leafJson) return this.conflict(key, `leaf differs:\n${t.leafJson}\n${leafJson}`);
      return;
    }
    t.leaf = leaf;
    t.leafJson = leafJson;
  }

  conflict(key, why) {
    if (process.env.REACT_HYBRID_DEBUG) process.stderr.write(`[conflict ${key}] ${why}\n`);
    this.conflictReasons = this.conflictReasons || new Map();
    if (!this.conflictReasons.has(key)) this.conflictReasons.set(key, why);
    // Two traces disagree on what the same guarded path does: the template for this function is
    // not trustworthy, so it always falls back.
    this.conflicts.set(key, (this.conflicts.get(key) || 0) + 1);
    this.tries.set(key, { conflict: true });
  }

  compileFrame(f) {
    const ctx = { frame: f, decs: [], decided: new Map(f.decided) };
    const out = this.node(ctx, f.out);
    const leaf = {
      out,
      ids: f.kind === "comp" ? f.idCount : 0,
      effects: dedupeNodes(f.effects || []),
    };
    return { path: f.decisions.concat(ctx.decs), leaf };
  }

  decide(ctx, kind, node, outcome) {
    const k = `${kind}:${node.key}`;
    if (ctx.decided.has(k)) {
      if (ctx.decided.get(k) !== outcome) throw new Unsupported("inconsistent leaf guard");
      return;
    }
    ctx.decided.set(k, outcome);
    ctx.decs.push({ kind, node, outcome });
  }

  eqGuard(ctx, sym) {
    const v = sym.c;
    if (v !== null && (typeof v === "object" || typeof v === "function" || typeof v === "symbol")) {
      throw new Unsupported("non-primitive value needs equality guard");
    }
    this.decide(ctx, "eq", sym.n, eqOutcome(v));
    return v;
  }

  sym(ctx, v) {
    if (v.fr !== ctx.frame) throw new Unsupported("cross-frame symbol in output");
    return v;
  }

  // ----------------------------------------------------------------------------- output nodes

  node(ctx, v) {
    const tr = this.tr;
    if (v instanceof tr.Sym) {
      this.sym(ctx, v);
      const cls = textClass(v.c, tr);
      if (cls === "x") throw new Unsupported("unsupported child value");
      this.decide(ctx, "tcls", v.n, cls);
      if (cls === "t") return { t: "tslot", node: v.n };
      if (cls === "n") return { t: "none" };
      return { t: "dyn", node: v.n };
    }
    if (v === null || v === undefined || typeof v === "boolean") return { t: "none" };
    if (typeof v === "string") return v === "" ? { t: "none" } : { t: "text", text: v };
    if (typeof v === "number") return { t: "text", text: "" + v };
    if (typeof v !== "object") throw new Unsupported(`child of type ${typeof v}`);
    if (tr.elShadow.has(v)) return this.element(ctx, v);
    if (tr.loopArr.has(v)) return this.loop(ctx, tr.loopArr.get(v));
    if (Array.isArray(v)) {
      const items = [];
      for (let i = 0; i < v.length; i++) items.push(this.node(ctx, v[i]));
      return { t: "arr", items };
    }
    throw new Unsupported("object child");
  }

  loop(ctx, loop) {
    if (loop.frame !== ctx.frame) throw new Unsupported("loop from other frame");
    const arr = this.tr.exprOf(loop.arr);
    const bindings = loop.bindings.map((b) => this.spec(ctx, b));
    return { t: "loop", arr, cb: loop.cbFid, bindings };
  }

  spec(ctx, v) {
    const tr = this.tr;
    if (v instanceof tr.Sym) return { k: "x", node: this.sym(ctx, v).n };
    if (containsElement(v, tr)) return { k: "th", out: this.node(ctx, v) };
    return { k: "x", node: tr.exprOf(v) };
  }

  element(ctx, el) {
    const sh = this.tr.elShadow.get(el);
    if (sh.frame !== ctx.frame) throw new Unsupported("element created in another frame");
    const type = sh.type;
    const children = childrenOf(sh);
    if (typeof type === "string") return this.host(ctx, sh, el);
    if (typeof type === "function") {
      const info = this.tr.fnInfo.get(type);
      if (!info) throw new Unsupported("uninstrumented component");
      if (type.prototype && type.prototype.isReactComponent) throw new Unsupported("class component");
      return { t: "comp", fid: info.fid, props: sh.entries.map(([k, v]) => [k, this.spec(ctx, v)]) };
    }
    if (PASS_THROUGH.has(type)) return { t: "frag", child: this.node(ctx, children) };
    if (type && type.$$typeof === REACT_PROVIDER) {
      const name = this.tr.modNames.get(type._context);
      if (!name) throw new Unsupported("provider of unbound context");
      const tr = this.tr;
      if (!tr.ctxIndex.has(name)) {
        tr.ctxIndex.set(name, tr.ctxNames.length);
        tr.ctxNames.push(name);
      }
      const valueEntry = sh.entries.find((e) => e[0] === "value");
      return {
        t: "prov",
        idx: tr.ctxIndex.get(name),
        value: this.spec(ctx, valueEntry ? valueEntry[1] : undefined),
        child: this.node(ctx, children),
      };
    }
    throw new Unsupported("unsupported element type");
  }

  // ----------------------------------------------------------------------------- host elements

  host(ctx, sh, el) {
    const tag = sh.type;
    if (WHOLE_TAGS.has(tag)) return this.wholeHost(ctx, sh);
    if (CONTEXT_TAGS.has(tag)) throw new Unsupported(`<${tag}> outside a constant <select>`);
    const tr = this.tr;
    const slots = [];
    const props = {};
    let children;
    let hasChildren = false;
    for (const [k, v] of sh.entries) {
      if (k === "children") {
        children = v;
        hasChildren = v !== undefined;
        continue;
      }
      if (k === "style") {
        props.style = this.markStyle(ctx, v, slots);
      } else if (k === "dangerouslySetInnerHTML") {
        props[k] = this.markHtml(ctx, v, slots);
      } else if (v instanceof tr.Sym) {
        this.sym(ctx, v);
        // Class guard first (canonical decision order), then pin non-slot values by equality.
        const cls = typeof v.c === "string" || typeof v.c === "number" ? "v" : "x";
        this.decide(ctx, "acls", v.n, cls);
        if (cls === "v" && this.attrModeled(tag, k)) {
          props[k] = marker(slots, "attr", v.n);
        } else {
          props[k] = this.eqGuard(ctx, v);
        }
      } else if (tr.hasSym(v)) {
        throw new Unsupported(`attribute ${k} is an object with symbolic parts`);
      } else {
        props[k] = tr.unwrap(v);
      }
    }
    const useChildMarker = hasChildren && !VOID_TAGS.has(tag) && !props.dangerouslySetInnerHTML;
    const html = this.render(this.React.createElement(tag, props, ...(useChildMarker ? [CHILD_MARK] : [])));
    const parts = splitMarkers(html, slots, useChildMarker);
    if (!parts) throw new Unsupported(`could not locate markers in <${tag}>`);
    const child = useChildMarker ? this.node(ctx, children) : null;
    if (!useChildMarker && hasChildren && children !== null && children !== undefined && children !== false) {
      if (!VOID_TAGS.has(tag)) throw new Unsupported("children with dangerouslySetInnerHTML");
    }
    return { t: "host", open: parts.open, child, close: parts.close };
  }

  markStyle(ctx, v, slots) {
    const tr = this.tr;
    if (v instanceof tr.Sym) {
      this.sym(ctx, v);
      if (v.c === null || v.c === undefined) return this.eqGuard(ctx, v);
      throw new Unsupported("symbolic style object");
    }
    if (!tr.isLocal(v)) {
      if (tr.hasSym(v)) throw new Unsupported("style with symbols");
      return v;
    }
    const out = {};
    for (const k of Object.keys(v)) {
      const fv = v[k];
      if (fv instanceof tr.Sym) {
        this.sym(ctx, fv);
        const c = fv.c;
        const cls = typeof c === "string" && c !== "" ? "S" : typeof c === "number" && c !== 0 ? "M" : "x";
        this.decide(ctx, "scls", fv.n, cls);
        if (cls !== "x" && this.styleModeled(k, cls)) {
          out[k] = marker(slots, cls === "S" ? "styleS" : "styleM", fv.n);
        } else {
          out[k] = this.eqGuard(ctx, fv);
        }
      } else if (tr.hasSym(fv)) {
        throw new Unsupported("nested style object with symbols");
      } else {
        out[k] = tr.unwrap(fv);
      }
    }
    return out;
  }

  markHtml(ctx, v, slots) {
    const tr = this.tr;
    if (v instanceof tr.Sym) throw new Unsupported("symbolic dangerouslySetInnerHTML object");
    if (!tr.isLocal(v)) return v;
    const out = {};
    for (const k of Object.keys(v)) {
      const fv = v[k];
      if (k === "__html" && fv instanceof tr.Sym) {
        this.sym(ctx, fv);
        this.decide(ctx, "hcls", fv.n, typeof fv.c === "string" ? "s" : "x");
        if (typeof fv.c === "string" && this.htmlModeled()) {
          out[k] = marker(slots, "html", fv.n);
        } else {
          out[k] = this.eqGuard(ctx, fv);
        }
      } else if (fv instanceof tr.Sym) {
        out[k] = this.eqGuard(ctx, this.sym(ctx, fv));
      } else {
        out[k] = tr.unwrap(fv);
      }
    }
    return out;
  }

  // A constant subtree (select/textarea/...): every symbolic value inside is pinned by an equality
  // guard, except plain identity attributes of the root element.
  wholeHost(ctx, sh) {
    const slots = [];
    const React = this.React;
    const build = (s, isRoot) => {
      const props = {};
      let children = [];
      for (const [k, v] of s.entries) {
        if (k === "children") {
          children = this.constChildren(ctx, v);
          continue;
        }
        if (k === "style" || k === "dangerouslySetInnerHTML") {
          props[k] = this.constValue(ctx, v);
          continue;
        }
        if (v instanceof this.tr.Sym) {
          this.sym(ctx, v);
          const cls = typeof v.c === "string" || typeof v.c === "number" ? "v" : "x";
          if (isRoot && WHOLE_SLOT_OK.test(k)) this.decide(ctx, "acls", v.n, cls);
          if (isRoot && WHOLE_SLOT_OK.test(k) && cls === "v" && this.attrModeled(s.type, k)) {
            props[k] = marker(slots, "attr", v.n);
            continue;
          }
          props[k] = this.eqGuard(ctx, v);
          continue;
        }
        props[k] = this.constValue(ctx, v);
      }
      return React.createElement(s.type, props, ...children);
    };
    this._buildConst = build;
    const html = this.render(build(sh, true));
    const parts = splitMarkers(html, slots, false);
    if (!parts) throw new Unsupported(`could not locate markers in <${sh.type}>`);
    return { t: "host", open: parts.open, child: null, close: [] };
  }

  constChildren(ctx, v) {
    const tr = this.tr;
    if (v instanceof tr.Sym) {
      this.sym(ctx, v);
      return [this.eqGuard(ctx, v)];
    }
    if (v === undefined) return [];
    if (tr.loopArr.has(v)) throw new Unsupported("loop inside constant subtree");
    if (Array.isArray(v)) return [v.map((x) => this.constChild(ctx, x))];
    return [this.constChild(ctx, v)];
  }

  constChild(ctx, v) {
    const tr = this.tr;
    if (v instanceof tr.Sym) {
      this.sym(ctx, v);
      return this.eqGuard(ctx, v);
    }
    if (v && typeof v === "object" && tr.elShadow.has(v)) {
      const sh = tr.elShadow.get(v);
      if (sh.frame !== ctx.frame) throw new Unsupported("element created in another frame");
      if (typeof sh.type !== "string") throw new Unsupported("component inside constant subtree");
      const el = this._buildConst(sh, false);
      return v.key !== null ? this.React.cloneElement(el, { key: v.key }) : el;
    }
    if (Array.isArray(v)) {
      if (tr.loopArr.has(v)) throw new Unsupported("loop inside constant subtree");
      return v.map((x) => this.constChild(ctx, x));
    }
    if (v !== null && typeof v === "object") throw new Unsupported("object in constant subtree");
    return v;
  }

  constValue(ctx, v) {
    const tr = this.tr;
    if (v instanceof tr.Sym) {
      this.sym(ctx, v);
      return this.eqGuard(ctx, v);
    }
    if (tr.isLocal(v)) {
      const out = Array.isArray(v) ? [] : {};
      for (const k of Object.keys(v)) out[k] = this.constValue(ctx, v[k]);
      return out;
    }
    return v;
  }

  // ----------------------------------------------------------------------------- probes

  probe(key, fn) {
    if (!this.probeCache.has(key)) {
      let ok;
      try {
        ok = fn();
      } catch (_e) {
        ok = false;
      }
      this.probeCache.set(key, ok);
    }
    return this.probeCache.get(key);
  }

  // `<tag k={v}>` renders as prefix + escape("" + v) + suffix for every probed string and number.
  attrModeled(tag, k) {
    return this.probe(`attr|${tag}|${k}`, () => {
      const ce = (v) => this.React.createElement(tag, { [k]: v });
      const m = this.render(ce(STR_MARK));
      const i = m.indexOf(STR_MARK);
      if (i < 0 || m.indexOf(STR_MARK, i + 1) >= 0) return false;
      const pre = m.slice(0, i);
      const post = m.slice(i + STR_MARK.length);
      for (const p of PROBE_STRINGS.concat(PROBE_NUMBERS)) {
        if (this.render(ce(p)) !== pre + escapeHtml("" + p) + post) return false;
      }
      return true;
    });
  }

  styleModeled(k, cls) {
    return this.probe(`style|${k}|${cls}`, () => {
      const ce = (v) => this.React.createElement("div", { style: { [k]: v } });
      const mark = cls === "S" ? STR_MARK : NUM_MARK_BASE;
      const ms = String(mark);
      const m = this.render(ce(mark));
      const i = m.indexOf(ms);
      if (i < 0 || m.indexOf(ms, i + 1) >= 0) return false;
      const pre = m.slice(0, i);
      const post = m.slice(i + ms.length);
      const probes = cls === "S" ? PROBE_STYLE_S : PROBE_STYLE_M;
      for (const p of probes) {
        const want = cls === "S" ? escapeHtml(("" + p).trim()) : "" + p;
        if (this.render(ce(p)) !== pre + want + post) return false;
      }
      return true;
    });
  }

  htmlModeled() {
    return this.probe("html", () => {
      const ce = (v) => this.React.createElement("div", { dangerouslySetInnerHTML: { __html: v } });
      const m = this.render(ce(STR_MARK));
      const i = m.indexOf(STR_MARK);
      const pre = m.slice(0, i);
      const post = m.slice(i + STR_MARK.length);
      for (const p of PROBE_HTML) if (this.render(ce(p)) !== pre + p + post) return false;
      return true;
    });
  }
}

// ------------------------------------------------------------------------------- markers

const STR_MARK = "\uE000\uE001";
const CHILD_MARK = "\uE000C\uE001";
const NUM_MARK_BASE = 9876543210123;

function marker(slots, kind, node) {
  const id = slots.length;
  const value = kind === "styleM" ? NUM_MARK_BASE + id * 1000 : `\uE000${id}\uE001`;
  slots.push({ kind, node, text: String(value) });
  return value;
}

// Splits React's output at the slot markers (and the child marker) into constant strings and slots.
function splitMarkers(html, slots, withChild) {
  const found = [];
  for (const s of slots) {
    const i = html.indexOf(s.text);
    if (i < 0 || html.indexOf(s.text, i + 1) >= 0) return null;
    found.push({ i, len: s.text.length, slot: s });
  }
  if (withChild) {
    const i = html.indexOf(CHILD_MARK);
    if (i < 0 || html.indexOf(CHILD_MARK, i + 1) >= 0) return null;
    found.push({ i, len: CHILD_MARK.length, child: true });
  }
  found.sort((a, b) => a.i - b.i);
  const open = [];
  const close = [];
  let cur = open;
  let pos = 0;
  for (const f of found) {
    if (f.i < pos) return null;
    if (f.i > pos) cur.push(html.slice(pos, f.i));
    if (f.child) cur = close;
    else cur.push({ s: f.slot.kind, node: f.slot.node });
    pos = f.i + f.len;
  }
  if (pos < html.length) cur.push(html.slice(pos));
  if (/[\uE000\uE001]/.test(open.concat(close).filter((x) => typeof x === "string").join(""))) return null;
  return { open, close };
}

// ------------------------------------------------------------------------------- helpers

function textClass(v, tr) {
  if (typeof v === "string" || typeof v === "number") return "t";
  if (v === null || v === undefined || typeof v === "boolean") return "n";
  if (typeof v === "object" && v.$$typeof !== undefined) return "d";
  if (Array.isArray(v)) return tr.isElementish(v) ? "d" : "a";
  return "x";
}

function containsElement(v, tr, depth = 0) {
  if (v === null || typeof v !== "object" || depth > 8) return false;
  if (tr.elShadow.has(v) || tr.loopArr.has(v)) return true;
  if (v instanceof tr.Sym) return false;
  if (Array.isArray(v)) return v.some((x) => containsElement(x, tr, depth + 1));
  if (tr.isLocal(v)) return Object.keys(v).some((k) => containsElement(v[k], tr, depth + 1));
  return false;
}

function childrenOf(sh) {
  const e = sh.entries.find((x) => x[0] === "children");
  return e ? e[1] : undefined;
}

function eqOutcome(v) {
  if (v === undefined) return "u";
  if (v === null) return "l";
  if (typeof v === "number") return Number.isNaN(v) ? "N" : `n:${Object.is(v, -0) ? 0 : v}`;
  if (typeof v === "bigint") return `g:${v}`;
  if (typeof v === "boolean") return `b:${v}`;
  return `s:${v}`;
}

function dedupeNodes(nodes) {
  const seen = new Set();
  const out = [];
  for (const n of nodes) {
    if (!seen.has(n.key)) {
      seen.add(n.key);
      out.push(n);
    }
  }
  return out;
}

function bump(map, k) {
  map.set(k, (map.get(k) || 0) + 1);
}

module.exports = { Learner, escapeHtml, eqOutcome, Unsupported, VOID_TAGS };
