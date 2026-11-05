"use strict";

// Emits the specialized renderer: one function per template (component `$T<fid>`, map callback
// `$B<fid>`), each walking its decision trie (any missing edge throws the fallback sentinel) and
// emitting constant chunks, escaped slots and calls to child templates. The emitted code is
// appended to the app's own module source, so it calls the app's original pure helpers by name.

const E = require("./expr");
const { escapeHtml, eqOutcome } = require("./learn");
const { BINOPS, UNOPS, NATIVES } = require("./trace");

const TRIVIAL = new Set(["root", "lit", "ref", "re"]);
const CLASSIFIERS = { tcls: "$tcls", acls: "$acls", scls: "$scls", scls0: "$scls0", hcls: "$hcls", keys: "$keys" };

const RUNTIME = String.raw`
const $FB = { hybridFallback: true };
let $fbSite = -1;
function $fb(site) { $fbSite = site === undefined ? -1 : site; throw $FB; }
let $o = "";
let $L = false;
const $ctx = [];
const $ctxDefault = [];
class $Th { constructor(f) { this.f = f; } }
const $ESC1 = /["'&<>]/;
const $ESCG = /["'&<>]/g;
const $ESCM = { '"': "&quot;", "&": "&amp;", "'": "&#x27;", "<": "&lt;", ">": "&gt;" };
function $escC(c) { return $ESCM[c]; }
function $e(s) { return $ESC1.test(s) ? s.replace($ESCG, $escC) : s; }
function $t(s) { if (s === "") return; if ($L) $o += "<!-- -->"; $o += $e(s); $L = true; }
function $te(s) { if (s === "") return; if ($L) $o += "<!-- -->"; $o += s; $L = true; }
function $es(v) {
  const t = typeof v;
  return t === "string" ? $e(v) : t === "number" ? "" + v : null;
}
function $tn(v) {
  const t = typeof v;
  if (t === "string") $t(v);
  else if (t === "number") $te("" + v);
  else if (!(v === null || v === undefined || t === "boolean")) $fb();
}
function $tcls(v) {
  const t = typeof v;
  if (t === "string" || t === "number") return "t";
  if (v === null || v === undefined || t === "boolean") return "n";
  if (v instanceof $Th) return "d";
  if (Array.isArray(v)) return "a";
  return "x";
}
// Attribute region slot for a value of unknown type (see learn.js attrRegions).
function $at(v, vpre, vpost, t, f, n, site) {
  const ty = typeof v;
  if (ty === "string" || ty === "number") return vpre === null ? $fb(site) : vpre + $e("" + v) + vpost;
  if (v === true) return t;
  if (v === false) return f;
  if (v === null) return n;
  if (v === undefined) return "";
  return $fb(site);
}
function $acls(v) { const t = typeof v; return t === "string" || t === "number" ? "v" : "x"; }
function $scls(v) {
  const t = typeof v;
  if (t === "string") return v !== "" ? "S" : "x";
  if (t === "number") return v !== 0 ? "M" : "x";
  return "x";
}
function $scls0(v) {
  const t = typeof v;
  if (t === "string") return v !== "" ? "S" : "x";
  return t === "number" ? "M" : "x";
}
function $hcls(v) { return typeof v === "string" ? "s" : "x"; }
function $okeys(v) {
  if (v === null || v === undefined) return "#nullish";
  if (typeof v !== "object") return "#" + typeof v;
  const k = Object.keys(v);
  if (Object.getOwnPropertySymbols(v).length) return "#symbols";
  return k;
}
function $keys(v) {
  if (v === null || v === undefined) return "#nullish";
  if (typeof v !== "object") return "#" + typeof v;
  if (Object.getOwnPropertySymbols(v).length) return "#symbols";
  return "o:" + Object.keys(v).join("\u0001");
}
// React 18 Fizz tree context (pushTreeContext / getTreeId / makeId), used for useId.
function $bits(n) { return 32 - Math.clz32(n); }
function $push(tc, total, index) {
  const baseIdWithLeadingBit = tc.id;
  const baseOverflow = tc.ov;
  const baseLength = $bits(baseIdWithLeadingBit) - 1;
  const baseId = baseIdWithLeadingBit & ~(1 << baseLength);
  const slot = index + 1;
  const length = $bits(total) + baseLength;
  if (length > 30) {
    const numberOfOverflowBits = baseLength - (baseLength % 5);
    const newOverflowBits = (1 << numberOfOverflowBits) - 1;
    const newOverflow = (baseId & newOverflowBits).toString(32);
    const restOfBaseId = baseId >> numberOfOverflowBits;
    const restOfBaseLength = baseLength - numberOfOverflowBits;
    const restOfLength = $bits(total) + restOfBaseLength;
    const restOfNewBits = slot << restOfBaseLength;
    return { id: (1 << restOfLength) | restOfNewBits | restOfBaseId, ov: newOverflow + baseOverflow };
  }
  return { id: (1 << length) | (slot << baseLength) | baseId, ov: baseOverflow };
}
function $id(tc, k) {
  const id = tc.id & ~(1 << ($bits(tc.id) - 1));
  return ":R" + id.toString(32) + tc.ov + (k > 0 ? "H" + k.toString(32) : "") + ":";
}
function $emitNode(v, tc) {
  const t = typeof v;
  if (t === "string") { $t(v); return; }
  if (t === "number") { $te("" + v); return; }
  if (v === null || v === undefined || t === "boolean") return;
  if (v instanceof $Th) { v.f(tc); return; }
  if (Array.isArray(v)) {
    const n = v.length;
    for (let i = 0; i < n; i++) $emitNode(v[i], tc && $push(tc, n, i));
    return;
  }
  $fb();
}
`;

// The runtime helpers themselves, for evaluating guards on build-time constants.
const RT = new Function(`${RUNTIME}; return { $scls, $scls0, $hcls, $acls, $tcls, $at, $okeys, $FB, $e,
  run(f) { $o = ""; $L = false; f({ $t, $te, $tn }); const r = $o; $o = ""; return r; },
  id(path) { let tc = { id: 1, ov: "" }; for (const [n, i] of path) tc = $push(tc, n, i); return $id(tc, 0); } };`)();

// Checks the runtime's text model ($e escaping, "<!-- -->" separators, empty-string and nullish
// children) and tree-id model ($push/$id) against the real React on probe values.
function verifyRuntimeModel(React, RDS) {
  const probes = ["", "a", " ", "&<>\"'", "x&amp;y", "😀\u2028", 0, -0, 1.5, NaN, 1e21, null, undefined, true, false];
  const h = React.createElement;
  for (const a of probes) {
    for (const b of probes) {
      const want = RDS.renderToString(h("div", null, "k", a, b));
      const got = "<div>" + RT.run((x) => { x.$t("k"); x.$tn(a); x.$tn(b); }) + "</div>";
      if (got !== want) return `text model differs for ${JSON.stringify([a, b])}`;
    }
  }
  // useId under nested lists of various widths, including overflow beyond 30 bits.
  let got = null;
  function Leaf() { got = React.useId(); return null; }
  const widths = [[3, 1], [1, 0], [40, 17], [7, 6], [2, 1], [33, 32], [5, 4], [9, 8], [100, 99], [17, 3], [6, 5], [300, 7]];
  for (let depth = 1; depth <= widths.length; depth++) {
    const path = widths.slice(0, depth);
    let el = h(Leaf);
    for (let d = depth - 1; d >= 0; d--) {
      const [n, i] = path[d];
      const kids = Array.from({ length: n }, (_, j) => (j === i ? el : null));
      el = h("div", null, kids);
    }
    got = null;
    RDS.renderToString(el);
    if (got !== RT.id(path)) return `useId model differs at depth ${depth}: ${got} vs ${RT.id(path)}`;
  }
  return null;
}

function generate({ tries, fns, ctxNames, rootFid, evalCall, callConst }) {
  const g = new Gen(tries, fns, evalCall, callConst);
  g.computePropModes();
  const parts = [RUNTIME];
  const mkUsed = new Set();
  for (const [key, trie] of tries) g.collectMk(trie, mkUsed);
  // mk sources may reference other mk-able closures only through their own source, so one level.
  for (const fid of [...mkUsed].sort((a, b) => a - b)) {
    const f = fns[fid];
    parts.push(`function $hy_mk${fid}(${f.freeLocals.join(", ")}) { return (${f.source}); }`);
  }
  const templates = [...tries.keys()].sort().map((key) => g.template(key, null));
  while (g.work.length) templates.push(g.template(null, g.work.shift()));
  parts.push(...g.tables, ...templates);
  const rootKey = `c${rootFid}`;
  g.curName = "root";
  const rootTC = g.needsTC(rootKey) ? '{ id: 1, ov: "" }' : "null";
  const rootCall = g.compCall(rootFid, [["data", { k: "x", node: E.root("data") }]], { defs: new Map(), lines: [], pend: [] }, rootTC);
  parts.push(`return {
  contexts: [${ctxNames.join(", ")}],
  setDefaults(values) { for (let i = 0; i < values.length; i++) $ctxDefault[i] = values[i]; },
  render(data) {
    $o = "";
    $L = false;
    for (let i = 0; i < $ctxDefault.length; i++) $ctx[i] = $ctxDefault[i];
    ${rootCall}
    const out = $o;
    $o = "";
    return out;
  },
  isFallback(e) { return e === $FB; },
  lastFallbackSite() { return $fbSite; },
  fallbackNow() { $fb(-2); },
};`);
  return { code: `(function () {\n${parts.join("\n")}\n})()`, stats: g.stats, sites: g.sites };
}

class Gen {
  constructor(tries, fns, evalCall, callConst) {
    this.tries = tries;
    this.fns = fns;
    this.evalCall = evalCall;
    this.callConst = callConst;
    this.consts = null;
    this.specMap = new Map();
    this.specCount = new Map();
    this.work = [];
    this.tabCache = new Map();
    this.tables = [];
    this.tcMemo = new Map();
    this.stats = { templates: tries.size, leaves: 0, decisions: 0, fallbackEdges: 0 };
    this.sites = [];
  }

  // ---------------------------------------------------------------- analysis

  forEachLeaf(t, fn) {
    if (!t || t.conflict) return;
    if (t.leaf) fn(t.leaf);
    if (t.edges) for (const c of t.edges.values()) this.forEachLeaf(c, fn);
  }

  collectMk(trie, out) {
    const visitNode = (n) => {
      if (n.k === "mk") out.add(n.d);
      n.kids.forEach(visitNode);
    };
    this.forEachNode(trie, visitNode);
  }

  forEachNode(trie, fn) {
    const walkTrie = (t) => {
      if (!t || t.conflict) return;
      if (t.dec) {
        fn(t.dec.node);
        for (const c of t.edges.values()) walkTrie(c);
      }
      if (t.leaf) {
        t.leaf.effects.forEach(fn);
        this.walkOut(t.leaf.out, fn);
      }
    };
    walkTrie(trie);
  }

  walkOut(out, fn) {
    if (!out) return;
    const spec = (s) => (s.k === "x" ? fn(s.node) : this.walkOut(s.out, fn));
    switch (out.t) {
      case "tslot":
      case "dyn":
        fn(out.node);
        break;
      case "host":
        for (const p of out.open.concat(out.close)) if (typeof p !== "string") fn(p.node);
        this.walkOut(out.child, fn);
        break;
      case "comp":
        out.props.forEach(([, s]) => spec(s));
        break;
      case "frag":
        this.walkOut(out.child, fn);
        break;
      case "prov":
        spec(out.value);
        this.walkOut(out.child, fn);
        break;
      case "loop":
        fn(out.arr);
        out.bindings.forEach(spec);
        break;
      case "arr":
        out.items.forEach((x) => this.walkOut(x, fn));
        break;
      default:
        break;
    }
  }

  needsTC(key) {
    if (this.tcMemo.has(key)) return this.tcMemo.get(key);
    this.tcMemo.set(key, false); // assume false while recursing; refined by fixpoint below
    let changed = true;
    let result = false;
    while (changed) {
      changed = false;
      let r = false;
      this.forEachLeaf(this.tries.get(key), (leaf) => {
        if (leaf.ids > 0 || this.outNeedsTC(leaf.out)) r = true;
      });
      if (r !== result) {
        result = r;
        this.tcMemo.set(key, r);
        changed = true;
      }
    }
    return result;
  }

  outNeedsTC(out) {
    if (!out) return false;
    switch (out.t) {
      case "dyn":
        return true;
      case "host":
      case "frag":
        return this.outNeedsTC(out.child);
      case "prov":
        return this.outNeedsTC(out.child) || (out.value.k === "th" && this.outNeedsTC(out.value.out));
      case "comp":
        return (
          (this.tries.has(`c${out.fid}`) && this.needsTC(`c${out.fid}`)) ||
          out.props.some(([, s]) => s.k === "th" && this.outNeedsTC(s.out))
        );
      case "loop":
        return (
          (this.tries.has(`b${out.cb}`) && this.needsTC(`b${out.cb}`)) ||
          out.bindings.some((s) => s.k === "th" && this.outNeedsTC(s.out))
        );
      case "arr":
        return out.items.some((x) => this.outNeedsTC(x));
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------- props passing

  // A component template whose props object is only ever read as `P.<key>` (constant key, not an
  // Object.prototype member) receives its props as positional parameters instead of an object.
  computePropModes() {
    this.propParams = new Map(); // fid -> [keys] (positional) ; absent -> object
    for (const [key, trie] of this.tries) {
      if (key[0] !== "c" || trie.conflict) continue;
      const keys = new Set();
      let ok = true;
      const visit = (n) => {
        if (n.k === "get" && n.kids[0].k === "root" && n.kids[0].d === "$rP") {
          const kk = n.kids[1];
          if (kk.k === "lit" && typeof kk.d === "string" && !(kk.d in Object.prototype) && /^[A-Za-z_$][\w$]*$|^[\w-]+$/.test(kk.d)) {
            keys.add(kk.d);
            return;
          }
          ok = false;
          return;
        }
        if (n.k === "root" && n.d === "$rP") {
          ok = false;
          return;
        }
        n.kids.forEach(visit);
      };
      this.forEachNode(trie, visit);
      if (ok) this.propParams.set(Number(key.slice(1)), [...keys].sort());
    }
  }

  propName(key) {
    const i = this.curProps.indexOf(key);
    return `$p${i}`;
  }

  // ---------------------------------------------------------------- templates

  template(key, spec) {
    if (spec) key = `c${spec.fid}`;
    const trie = this.tries.get(key);
    const isComp = key[0] === "c";
    const fid = Number(key.slice(1));
    const name = spec ? spec.name : isComp ? `$T${fid}` : `$B${fid}`;
    this.curName = `${name} ${this.fns[fid].name || ""}`.trim();
    this.curProps = isComp && this.propParams.has(fid) ? this.propParams.get(fid) : null;
    this.consts = spec ? spec.consts : null;
    this.simpMemo = new Map();
    const params = isComp
      ? this.curProps
        ? this.curProps.map((k, i) => (this.consts && this.consts.has(k) ? null : `$p${i}`)).filter(Boolean)
        : ["$rP"]
      : ["$rA0", "$rA1", "$rA2", ...this.fns[fid].freeLocals.map((_, i) => `$rE${i}`)];
    params.push("$tc");
    if (trie.conflict) return `function ${name}(${params.join(", ")}) { $fb(${this.site("conflicting traces")}); }`;

    this.counts = new Map();
    this.uid = 0;
    const roots = new Set();
    this.forEachNode(trie, (n) => this.count(this.simp(n), roots));
    const ctx = this.newCtx(new Map());
    for (const r of [...roots].sort()) {
      if (r.startsWith("$rC")) ctx.lines.push(`const ${r} = $ctx[${r.slice(3)}];`);
      if (r.startsWith("$rI")) ctx.lines.push(`const ${r} = $id($tc, ${r.slice(3)});`);
    }
    this.trie(trie, ctx, isComp);
    this.flush(ctx);
    return `function ${name}(${params.join(", ")}) {\n${ctx.lines.join("\n")}\n}`;
  }

  // ---------------------------------------------------------------- build-time constant folding

  // Substitutes constant props of a call-site specialization and folds every operation whose
  // operands became constants, by performing it at build time (real operators, real helpers).
  simp(n) {
    if (!this.consts) return n;
    if (this.simpMemo.has(n.key)) return this.simpMemo.get(n.key);
    let r = n;
    if (n.k === "get" && n.kids[0].k === "root" && n.kids[0].d === "$rP" && n.kids[1].k === "lit" && this.consts.has(n.kids[1].d)) {
      r = this.consts.get(n.kids[1].d);
    } else if (n.kids.length) {
      const kids = n.kids.map((k) => this.simp(k));
      r = kids.every((k, i) => k === n.kids[i]) ? n : E.make(n.k, kids, n.d);
      const operands = n.k === "call" ? kids.slice(1) : kids;
      if (r !== n && n.k !== "obj" && n.k !== "arr" && operands.every((k) => isConstNode(k))) {
        const f = this.fold(r);
        if (f.ok && (f.value === null || (typeof f.value !== "object" && typeof f.value !== "function"))) {
          try {
            r = E.lit(f.value);
          } catch (_e) {
            // unrepresentable (unregistered symbol): keep the expression
          }
        }
      }
    }
    this.simpMemo.set(n.key, r);
    return r;
  }

  fold(n) {
    try {
      const v = (x) => constValue(x);
      switch (n.k) {
        case "bin":
          if (n.d === "in" || n.d === "instanceof") return { ok: false };
          return { ok: true, value: BINOPS[n.d](v(n.kids[0]), v(n.kids[1])) };
        case "un":
          return { ok: true, value: UNOPS[n.d](v(n.kids[0])) };
        case "tpl": {
          let out = n.d[0];
          n.kids.forEach((k, i) => {
            out += `${v(k)}` + n.d[i + 1];
          });
          return { ok: true, value: out };
        }
        case "get": {
          const o = v(n.kids[0]);
          if (o === null || o === undefined) return { ok: false };
          return { ok: true, value: o[v(n.kids[1])] };
        }
        case "call":
          if (n.kids[0].k !== "ref" || !this.callConst) return { ok: false };
          return { ok: true, value: this.callConst(n.kids[0].d, n.kids.slice(1).map(v)) };
        case "mcall": {
          const recv = v(n.kids[0]);
          if (recv === null || recv === undefined || typeof recv === "object") return { ok: false };
          const fn = Object(recv)[n.d];
          if (!NATIVES.methods.has(fn)) return { ok: false };
          return { ok: true, value: fn.apply(recv, n.kids.slice(1).map(v)) };
        }
        default:
          return { ok: false };
      }
    } catch (_e) {
      return { ok: false };
    }
  }

  // Outcome of a guard on a build-time constant, computed with the runtime classifiers themselves.
  staticOutcome(kind, value) {
    switch (kind) {
      case "bool":
        return !!value;
      case "eq":
        return eqOutcome(value);
      case "keys": {
        const k = RT.$okeys(value);
        return typeof k === "string" ? k : `o:${k.join("\u0001")}`;
      }
      default:
        return RT[CLASSIFIERS[kind]](value);
    }
  }

  count(n, roots) {
    this.counts.set(n.key, (this.counts.get(n.key) || 0) + 1);
    if (n.k === "root") roots.add(n.d);
    if ((this.counts.get(n.key) || 0) > 1) return; // children already counted via first occurrence
    n.kids.forEach((k) => this.count(k, roots));
  }

  isParam(n) {
    return (
      this.curProps &&
      n.k === "get" &&
      n.kids[0].k === "root" &&
      n.kids[0].d === "$rP" &&
      n.kids[1].k === "lit" &&
      this.curProps.includes(n.kids[1].d)
    );
  }

  trivial(n) {
    return TRIVIAL.has(n.k) || this.isParam(n);
  }

  worthy(n) {
    return !this.trivial(n) && (this.counts.get(n.key) || 0) > 1;
  }

  render(n, ctx) {
    return E.render(n, (x) => (this.isParam(x) ? this.propName(x.kids[1].d) : ctx.defs.get(x.key) || null));
  }

  // Finite-domain specialization: a pure helper call whose only non-constant inputs are booleans is
  // evaluated at build time (with the app's real helper) for every combination; the template indexes
  // a table instead of calling it.
  tabulate(n) {
    if (!this.evalCall || n.k !== "call" || (n.kids[0].k !== "ref" && n.kids[0].k !== "mk")) return null;
    if (this.tabCache.has(n.key)) return this.tabCache.get(n.key);
    let result = null;
    const bools = [];
    const ok = (x) => {
      if (x.k === "lit") return true;
      if (this.ty(x) === "boolean" && x.k !== "lit") {
        if (!bools.some((b) => b.key === x.key)) bools.push(x);
        return true;
      }
      if (x.k === "obj" || x.k === "arr") return x.kids.every(ok);
      return false;
    };
    if (n.kids[0].k === "ref" && n.kids.slice(1).every(ok) && bools.length > 0 && bools.length <= 5) {
      const table = [];
      try {
        for (let m = 0; m < 1 << bools.length; m++) {
          const env = new Map(bools.map((b, i) => [b.key, !!(m & (1 << i))]));
          const v = this.evalCall(n, (x) => env.get(x.key));
          if (v !== null && typeof v === "object") throw new Error("non-primitive");
          if (typeof v === "function" || typeof v === "symbol") throw new Error("non-primitive");
          table.push(v);
        }
        const name = `$tab${this.tables.length}`;
        this.tables.push(`const ${name} = [${table.map((v) => E.litCode(v)).join(", ")}];`);
        result = { name, bools, values: table };
      } catch (_e) {
        result = null;
      }
    }
    this.tabCache.set(n.key, result);
    return result;
  }

  ens(n, ctx, force) {
    n = this.simp(n);
    if (ctx.defs.has(n.key)) return ctx.defs.get(n.key);
    if (this.trivial(n)) return this.render(n, ctx);
    const tab = this.tabulate(n);
    if (tab) {
      const idx = tab.bools.map((b, i) => `(${this.ens(b, ctx, false)} ? ${1 << i} : 0)`).join(" | ");
      const code = `${tab.name}[${idx}]`;
      const v = `$v${this.uid++}`;
      ctx.lines.push(`const ${v} = ${code};`);
      ctx.defs.set(n.key, v);
      return v;
    }
    for (const k of n.kids) if (this.worthy(k)) this.ens(k, ctx, false);
    const code = this.render(n, ctx);
    if (force || this.worthy(n)) {
      const v = `$v${this.uid++}`;
      ctx.lines.push(`const ${v} = ${code};`);
      ctx.defs.set(n.key, v);
      return v;
    }
    return code;
  }

  // ctx.lines holds statements; ctx.pend buffers output pieces ({lit} | {code}) that are merged
  // into one `$o +=` (adjacent literals folded) and flushed before any other statement. Constant
  // definitions may overtake buffered output: they are pure and never read $o.
  newCtx(defs) {
    return { defs, lines: [], pend: [] };
  }

  block(ctx) {
    return this.newCtx(new Map(ctx.defs));
  }

  out(ctx, pieces) {
    for (const p of pieces) {
      const last = ctx.pend[ctx.pend.length - 1];
      if (p.lit !== undefined) {
        if (p.lit === "") continue;
        if (last && last.lit !== undefined) last.lit += p.lit;
        else ctx.pend.push({ lit: p.lit });
      } else {
        ctx.pend.push(p);
      }
    }
  }

  flush(ctx) {
    if (!ctx.pend.length) return;
    const code = ctx.pend.map((p) => (p.lit !== undefined ? JSON.stringify(p.lit) : p.code)).join(" + ");
    ctx.pend = [];
    ctx.lines.push(`$o += ${code};`);
  }

  stmt(ctx, line) {
    this.flush(ctx);
    ctx.lines.push(line);
  }

  closeBlock(b) {
    this.flush(b);
    return b.lines.join("\n");
  }

  site(desc) {
    this.sites.push(`${this.curName}: ${desc}`.slice(0, 300));
    return this.sites.length - 1;
  }

  trie(t, ctx, isComp, why) {
    if (!t || (!t.dec && !t.leaf)) {
      this.stats.fallbackEdges++;
      this.stmt(ctx, `$fb(${this.site(why || "untraced path")});`);
      return;
    }
    if (t.leaf) {
      this.stats.leaves++;
      this.leaf(t.leaf, ctx, isComp);
      return;
    }
    this.stats.decisions++;
    const d = { kind: t.dec.kind, node: this.simp(t.dec.node) };
    if (isConstNode(d.node)) {
      const outcome = this.staticOutcome(d.kind, constValue(d.node));
      this.trie(t.edges.get(outcome), ctx, isComp, `${t.dec.kind}(${t.dec.node.key}) = ${String(outcome)} untraced`);
      return;
    }
    if (d.kind === "bool") {
      const c = this.ens(d.node, ctx, false);
      const yes = this.block(ctx);
      const no = this.block(ctx);
      this.trie(t.edges.get(true), yes, isComp, `${d.node.key} is truthy`);
      this.trie(t.edges.get(false), no, isComp, `${d.node.key} is falsy`);
      this.stmt(ctx, `if (${c}) {\n${this.closeBlock(yes)}\n} else {\n${this.closeBlock(no)}\n}`);
      return;
    }
    if (d.kind === "eq") {
      const v = this.ens(d.node, ctx, !this.trivial(d.node));
      let code = "";
      for (const [outcome, child] of t.edges) {
        const b = this.block(ctx);
        this.trie(child, b, isComp);
        code += `if (${eqTest(v, outcome)}) {\n${this.closeBlock(b)}\n} else `;
      }
      this.stmt(ctx, `${code}{ $fb(${this.site(`${d.node.key} === <untraced value>`)}); }`);
      return;
    }
    if (d.kind === "keys") {
      const v = this.ens(d.node, ctx, false);
      const k = `$k${this.uid++}`;
      ctx.lines.push(`const ${k} = $okeys(${v});`);
      let code = "";
      for (const [outcome, child] of t.edges) {
        const b = this.block(ctx);
        this.trie(child, b, isComp);
        code += `if (${keysTest(k, outcome)}) {\n${this.closeBlock(b)}\n} else `;
      }
      this.stmt(ctx, `${code}{ $fb(${this.site(`keys(${d.node.key}) untraced`)}); }`);
      return;
    }
    const v = this.ens(d.node, ctx, false);
    let code = `switch (${CLASSIFIERS[d.kind]}(${v})) {\n`;
    for (const [outcome, child] of t.edges) {
      const b = this.block(ctx);
      this.trie(child, b, isComp);
      code += `case ${JSON.stringify(outcome)}: {\n${this.closeBlock(b)}\nbreak;\n}\n`;
    }
    this.stmt(ctx, `${code}default: $fb(${this.site(`${d.kind}(${d.node.key}) untraced`)});\n}`);
  }

  // Static type: expression typing plus tabulated helper calls whose results share one type.
  ty(n) {
    const t = E.typeOf(n);
    if (t || n.k !== "call") return t;
    const tab = this.tabulate(n);
    if (!tab) return null;
    const types = new Set(tab.values.map((v) => typeof v));
    return types.size === 1 && ["string", "number", "boolean"].includes([...types][0]) ? [...types][0] : null;
  }

  // Statically escape-free strings: escaping them is the identity.
  safe(n) {
    const ty = this.ty(n);
    if (ty === "number" || ty === "boolean") return true;
    switch (n.k) {
      case "lit":
        return typeof n.d === "string" ? !/["'&<>]/.test(n.d) : n.d === null || typeof n.d !== "object";
      case "root":
        return n.d.startsWith("$rI");
      case "bin":
        return n.d === "+" && ty === "string" && this.safe(n.kids[0]) && this.safe(n.kids[1]);
      case "tpl":
        return n.d.every((q) => !/["'&<>]/.test(q)) && n.kids.every((k) => this.safe(k));
      case "mcall":
        return ty === "string" && this.ty(n.kids[0]) === "number";
      case "call": {
        const tab = this.tabulate(n);
        return !!tab && tab.values.every((v) => typeof v !== "string" || !/["'&<>]/.test(v));
      }
      default:
        return false;
    }
  }

  // Escaped form of a string- or number-typed expression, as output pieces. Concatenations of
  // strings/numbers are escaped piecewise (escaping distributes over concatenation).
  escPieces(n, ctx) {
    n = this.simp(n);
    const ty = this.ty(n);
    if (n.k === "lit") return [{ lit: escapeHtml(String(n.d)) }];
    if (this.safe(n)) {
      const x = this.ens(n, ctx, false);
      return [{ code: ty === "string" ? x : `("" + ${x})` }];
    }
    if (n.k === "bin" && n.d === "+" && ty === "string") {
      const [a, b] = n.kids;
      const known = (k) => ["string", "number"].includes(this.ty(k));
      if (known(a) && known(b)) return this.escPieces(a, ctx).concat(this.escPieces(b, ctx));
    }
    const ex = this.escaped(n, ctx);
    if (ex) return [{ code: ex }];
    const x = this.ens(n, ctx, false);
    return [{ code: ty === "string" ? `$e(${x})` : `("" + ${x})` }];
  }

  // Values escaped more than once in a leaf are escaped once into a constant.
  countEscapes(out, counts) {
    const bump = (n) => {
      n = this.simp(n);
      counts.set(n.key, (counts.get(n.key) || 0) + 1);
    };
    const visit = (o) => {
      if (!o) return;
      switch (o.t) {
        case "tslot":
          if (this.ty(o.node) !== "number") bump(o.node);
          break;
        case "host":
          for (const p of o.open.concat(o.close)) {
            if (typeof p !== "string" && p.s === "attrR" && p.vOK && !["boolean", "number"].includes(this.ty(p.node))) bump(p.node);
          }
          visit(o.child);
          break;
        case "frag":
        case "prov":
          visit(o.child);
          break;
        case "arr":
          o.items.forEach(visit);
          break;
        default:
          break;
      }
    };
    visit(out);
    return counts;
  }

  escaped(n, ctx) {
    n = this.simp(n);
    if (n.k === "lit" || this.safe(n)) return null;
    if (!this.escCounts || (this.escCounts.get(n.key) || 0) < 2) return null;
    const k = `esc:${n.key}`;
    if (ctx.defs.has(k)) return ctx.defs.get(k);
    const x = this.ens(n, ctx, false);
    const v = `$x${this.uid++}`;
    ctx.lines.push(`const ${v} = ${this.ty(n) === "string" ? `$e(${x})` : `$es(${x})`};`);
    ctx.defs.set(k, v);
    return v;
  }

  leaf(leaf, ctx, isComp) {
    this.escCounts = this.countEscapes(leaf.out, new Map());
    for (const n of leaf.effects) if (!this.trivial(n)) this.ens(n, ctx, true);
    const s = { L: null, synced: true };
    let tc = "$tc";
    if (isComp && leaf.ids > 0 && this.outNeedsTC(leaf.out)) {
      ctx.lines.push("const $tcR = $push($tc, 1, 0);");
      tc = "$tcR";
    }
    this.emit(leaf.out, ctx, s, tc);
    this.sync(ctx, s);
  }

  sync(ctx, s) {
    if (!s.synced) {
      this.stmt(ctx, `$L = ${s.L};`);
      s.synced = true;
    }
  }

  slotPieces(p, ctx) {
    const cn = this.simp(p.node);
    if (cn.k === "lit") {
      const c = cn.d;
      try {
        switch (p.s) {
          case "attrR":
            return [{ lit: RT.$at(c, p.vOK ? p.vpre : null, p.vpost, ...p.tbl.slice(0, 3), -1) }];
          case "attr":
            return [{ lit: escapeHtml("" + c) }];
          case "styleS":
            return [{ lit: escapeHtml(("" + c).trim()) }];
          default:
            return [{ lit: "" + c }];
        }
      } catch (e) {
        if (e !== RT.$FB) throw e;
        // falls through: the generic code fails at runtime as well
      }
    }
    if (p.s === "attrR") {
      const ty = this.ty(cn);
      const x = this.ens(p.node, ctx, false);
      const site = this.site(`attribute value ${p.node.key} of unsupported type`);
      const [vpre, vpost, t, f, n] = [p.vpre, p.vpost, ...p.tbl].map((z) => JSON.stringify(z));
      if (ty === "boolean") return [{ code: `(${x} ? ${t} : ${f})` }];
      const ex = p.vOK && ty === null ? this.escaped(p.node, ctx) : null;
      if (ty === "string" || ty === "number") {
        if (!p.vOK) return [{ code: `$fb(${site})` }];
        return [{ lit: p.vpre }, ...this.escPieces(p.node, ctx), { lit: p.vpost }];
      }
      const generic = `$at(${x}, ${p.vOK ? vpre : "null"}, ${vpost}, ${t}, ${f}, ${n}, ${site})`;
      if (ex) return [{ code: `(${ex} !== null ? ${vpre} + ${ex} + ${vpost} : ${generic})` }];
      return [{ code: generic }];
    }
    const x = this.ens(p.node, ctx, false);
    switch (p.s) {
      case "attr":
        if (["string", "number"].includes(this.ty(cn))) return this.escPieces(p.node, ctx);
        return [{ code: `$e("" + ${x})` }];
      case "styleS":
        return [{ code: `$e(("" + ${x}).trim())` }];
      case "styleM":
      case "html":
        return [{ code: `("" + ${x})` }];
      default:
        throw new Error(`unknown slot ${p.s}`);
    }
  }

  parts(list, ctx) {
    const pieces = [];
    for (const p of list) {
      if (typeof p === "string") pieces.push({ lit: p });
      else pieces.push(...this.slotPieces(p, ctx));
    }
    return pieces;
  }

  spec(s, ctx) {
    if (s.k === "x") return this.ens(s.node, ctx, false);
    const b = this.block(ctx);
    const st = { L: null, synced: true };
    this.emit(s.out, b, st, "$tc");
    this.sync(b, st);
    return `new $Th(function ($tc) {\n${this.closeBlock(b)}\n})`;
  }

  compCall(fid, props, ctx, tc) {
    const key = `c${fid}`;
    if (!this.tries.has(key)) return `$fb(${this.site(`no template for component #${fid}`)});`;
    const tcArg = this.needsTC(key) ? tc : "null";
    const pos = this.propParams.get(fid);
    if (pos) {
      const byKey = new Map(props.map(([k, sp]) => [k, sp]));
      // Props that are constants at this call site (including absent ones) select a specialized copy
      // of the callee in which they are folded.
      const consts = new Map();
      for (const k of pos) {
        if (!byKey.has(k)) consts.set(k, E.lit(undefined));
        else {
          const sp = byKey.get(k);
          if (sp.k === "x") {
            const cn = this.simp(sp.node);
            if (isConstNode(cn)) consts.set(k, cn);
          }
        }
      }
      let callee = `$T${fid}`;
      let keys = pos;
      if (consts.size) {
        const sig = `${fid}|${[...consts].map(([k, v]) => `${k}=${v.key}`).join("|")}`;
        let spec = this.specMap.get(sig);
        const n = this.specCount.get(fid) || 0;
        if (!spec && n < 24 && this.specMap.size < 400) {
          spec = { name: `$T${fid}_${n}`, fid, consts };
          this.specCount.set(fid, n + 1);
          this.specMap.set(sig, spec);
          this.work.push(spec);
        }
        if (spec) {
          callee = spec.name;
          keys = pos.filter((k) => !consts.has(k));
        }
      }
      const args = keys.map((k) => (byKey.has(k) ? this.spec(byKey.get(k), ctx) : "void 0"));
      return `${callee}(${[...args, tcArg].join(", ")});`;
    }
    const obj = `{ ${props.map(([k, sp]) => `${JSON.stringify(k)}: ${this.spec(sp, ctx)}`).join(", ")} }`;
    return `$T${fid}(${obj}, ${tcArg});`;
  }

  emit(out, ctx, s, tc) {
    if (!out) return;
    switch (out.t) {
      case "none":
        return;
      case "text": {
        if (out.text === "") return;
        const esc = escapeHtml(out.text);
        if (s.L === true) this.out(ctx, [{ lit: "<!-- -->" + esc }]);
        else if (s.L === false) this.out(ctx, [{ lit: esc }]);
        else this.out(ctx, [{ code: `($L ? "<!-- -->" : "")` }, { lit: esc }]);
        s.L = true;
        s.synced = false;
        return;
      }
      case "tslot":
      case "dyn": {
        const cn = this.simp(out.node);
        if (cn.k === "lit") {
          const c = cn.d;
          if (typeof c === "string" || typeof c === "number") return this.emit({ t: "text", text: "" + c }, ctx, s, tc);
          if (c === null || c === undefined || typeof c === "boolean") return;
        }
        if (out.t === "dyn") return this.emit({ t: "dynamic", node: out.node }, ctx, s, tc);
        const x = this.ens(out.node, ctx, false);
        this.sync(ctx, s);
        const ty = this.ty(cn);
        const ex = ty === null ? this.escaped(out.node, ctx) : null;
        if (ty === "string" || ty === "number") {
          const pieces = this.escPieces(out.node, ctx);
          const code = pieces.map((q) => (q.lit !== undefined ? JSON.stringify(q.lit) : q.code)).join(" + ");
          this.stmt(ctx, `$te(${code});`);
        } else if (ex && ty === "string") this.stmt(ctx, `$te(${ex});`);
        else if (ex) this.stmt(ctx, `if (${ex} !== null) $te(${ex}); else $tn(${x});`);
        else this.stmt(ctx, ty === "string" ? `$t(${x});` : ty === "number" ? `$t("" + ${x});` : `$tn(${x});`);
        s.L = null;
        s.synced = true;
        return;
      }
      case "host": {
        this.out(ctx, this.parts(out.open, ctx));
        s.L = false;
        s.synced = false;
        this.emit(out.child, ctx, s, tc);
        this.out(ctx, this.parts(out.close, ctx));
        s.L = false;
        s.synced = false;
        return;
      }
      case "frag":
        this.emit(out.child, ctx, s, tc);
        return;
      case "comp": {
        const call = this.compCall(out.fid, out.props, ctx, tc);
        this.sync(ctx, s);
        this.stmt(ctx, call);
        s.L = null;
        s.synced = true;
        return;
      }
      case "prov": {
        const sv = `$s${this.uid++}`;
        const value = this.spec(out.value, ctx);
        this.sync(ctx, s);
        this.stmt(ctx, `const ${sv} = $ctx[${out.idx}];`);
        this.stmt(ctx, `$ctx[${out.idx}] = ${value};`);
        this.emit(out.child, ctx, s, tc);
        this.sync(ctx, s);
        this.stmt(ctx, `$ctx[${out.idx}] = ${sv};`);
        return;
      }
      case "loop": {
        const u = this.uid++;
        const arr = this.ens(out.arr, ctx, false);
        const binds = out.bindings.map((b) => this.spec(b, ctx));
        this.sync(ctx, s);
        const key = `b${out.cb}`;
        this.stmt(ctx, `const $a${u} = ${arr};`);
        this.stmt(ctx, `if (!Array.isArray($a${u})) $fb(${this.site("map over a non-array")});`);
        this.stmt(ctx, `const $n${u} = $a${u}.length;`);
        if (!this.tries.has(key)) {
          this.stmt(ctx, `if ($n${u} > 0) $fb(${this.site(`no template for callback #${out.cb}`)});`);
        } else {
          binds.forEach((b, i) => this.stmt(ctx, `const $b${u}_${i} = ${b};`));
          const tcArg = this.needsTC(key) ? `$push(${tc}, $n${u}, $i${u})` : "null";
          const args = [`$a${u}[$i${u}]`, `$i${u}`, `$a${u}`, ...binds.map((_, i) => `$b${u}_${i}`), tcArg];
          this.stmt(ctx, `for (let $i${u} = 0; $i${u} < $n${u}; $i${u}++) $B${out.cb}(${args.join(", ")});`);
        }
        s.L = null;
        s.synced = true;
        return;
      }
      case "dynamic": {
        const x = this.ens(out.node, ctx, false);
        this.sync(ctx, s);
        this.stmt(ctx, `$emitNode(${x}, ${tc});`);
        s.L = null;
        s.synced = true;
        return;
      }
      case "arr": {
        const n = out.items.length;
        out.items.forEach((item, i) => {
          let itc = "null";
          if (this.outNeedsTC(item)) {
            itc = `$tc${this.uid++}`;
            ctx.lines.push(`const ${itc} = $push(${tc}, ${n}, ${i});`);
          }
          this.emit(item, ctx, s, itc);
        });
        return;
      }
      default:
        throw new Error(`unknown out node ${out.t}`);
    }
  }
}

function isConstNode(n) {
  if (n.k === "lit") return true;
  if (n.k === "obj" || n.k === "arr") return n.kids.every(isConstNode);
  return false;
}

function constValue(n) {
  if (n.k === "lit") return n.d;
  if (n.k === "obj") return Object.fromEntries(n.d.map((k, i) => [k, constValue(n.kids[i])]));
  if (n.k === "arr") return n.kids.map(constValue);
  throw new Error("not constant");
}

function keysTest(k, outcome) {
  if (outcome[0] === "#") return `${k} === ${JSON.stringify(outcome)}`;
  const keys = outcome === "o:" ? [] : outcome.slice(2).split("\u0001");
  return [`typeof ${k} !== "string"`, `${k}.length === ${keys.length}`, ...keys.map((x, i) => `${k}[${i}] === ${JSON.stringify(x)}`)].join(
    " && "
  );
}

function eqTest(v, outcome) {
  if (outcome === "u") return `${v} === void 0`;
  if (outcome === "l") return `${v} === null`;
  if (outcome === "N") return `${v} !== ${v}`;
  const tag = outcome.slice(0, 2);
  const rest = outcome.slice(2);
  if (tag === "n:") return `${v} === ${E.litCode(Number(rest))}`;
  if (tag === "g:") return `${v} === ${rest}n`;
  if (tag === "b:") return `${v} === ${rest}`;
  return `${v} === ${JSON.stringify(rest)}`;
}

module.exports = { generate, verifyRuntimeModel };
