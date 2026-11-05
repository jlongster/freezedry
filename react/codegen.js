"use strict";

// Emits the specialized renderer: one function per template (component `$T<fid>`, map callback
// `$B<fid>`), each walking its decision trie (any missing edge throws the fallback sentinel) and
// emitting constant chunks, escaped slots and calls to child templates. The emitted code is
// appended to the app's own module source, so it calls the app's original pure helpers by name.

const E = require("./expr");
const { escapeHtml } = require("./learn");

const TRIVIAL = new Set(["root", "lit", "ref", "re"]);
const CLASSIFIERS = { tcls: "$tcls", acls: "$acls", scls: "$scls", hcls: "$hcls", keys: "$keys" };

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
function $tn(v) {
  const t = typeof v;
  if (t === "string") $t(v);
  else if (t === "number") $t("" + v);
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
function $acls(v) { const t = typeof v; return t === "string" || t === "number" ? "v" : "x"; }
function $scls(v) {
  const t = typeof v;
  if (t === "string") return v !== "" ? "S" : "x";
  if (t === "number") return v !== 0 ? "M" : "x";
  return "x";
}
function $hcls(v) { return typeof v === "string" ? "s" : "x"; }
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
  if (t === "number") { $t("" + v); return; }
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

function generate({ tries, fns, ctxNames, rootFid }) {
  const g = new Gen(tries, fns);
  const parts = [RUNTIME];
  const mkUsed = new Set();
  for (const [key, trie] of tries) g.collectMk(trie, mkUsed);
  // mk sources may reference other mk-able closures only through their own source, so one level.
  for (const fid of [...mkUsed].sort((a, b) => a - b)) {
    const f = fns[fid];
    parts.push(`function $hy_mk${fid}(${f.freeLocals.join(", ")}) { return (${f.source}); }`);
  }
  for (const key of [...tries.keys()].sort()) parts.push(g.template(key));
  const rootKey = `c${rootFid}`;
  const rootCall = tries.has(rootKey)
    ? `$T${rootFid}({ data: data }, ${g.needsTC(rootKey) ? "{ id: 1, ov: \"\" }" : "null"});`
    : "$fb();";
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
  sites: ${JSON.stringify(g.sites)},
};`);
  return { code: `(function () {\n${parts.join("\n")}\n})()`, stats: g.stats, sites: g.sites };
}

class Gen {
  constructor(tries, fns) {
    this.tries = tries;
    this.fns = fns;
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

  // ---------------------------------------------------------------- templates

  template(key) {
    const trie = this.tries.get(key);
    const isComp = key[0] === "c";
    const fid = Number(key.slice(1));
    const name = isComp ? `$T${fid}` : `$B${fid}`;
    this.curName = `${name} ${this.fns[fid].name || ""}`.trim();
    const params = isComp
      ? ["$rP"]
      : ["$rA0", "$rA1", "$rA2", ...this.fns[fid].freeLocals.map((_, i) => `$rE${i}`)];
    params.push("$tc");
    if (trie.conflict) return `function ${name}(${params.join(", ")}) { $fb(); }`;

    this.counts = new Map();
    this.uid = 0;
    const roots = new Set();
    this.forEachNode(trie, (n) => this.count(n, roots));
    const lines = [];
    for (const r of [...roots].sort()) {
      if (r.startsWith("$rC")) lines.push(`const ${r} = $ctx[${r.slice(3)}];`);
      if (r.startsWith("$rI")) lines.push(`const ${r} = $id($tc, ${r.slice(3)});`);
    }
    const ctx = { defs: new Map(), lines };
    this.trie(trie, ctx, isComp);
    return `function ${name}(${params.join(", ")}) {\n${lines.join("\n")}\n}`;
  }

  count(n, roots) {
    this.counts.set(n.key, (this.counts.get(n.key) || 0) + 1);
    if (n.k === "root") roots.add(n.d);
    if ((this.counts.get(n.key) || 0) > 1) return; // children already counted via first occurrence
    n.kids.forEach((k) => this.count(k, roots));
  }

  worthy(n) {
    return !TRIVIAL.has(n.k) && (this.counts.get(n.key) || 0) > 1;
  }

  ens(n, ctx, force) {
    if (ctx.defs.has(n.key)) return ctx.defs.get(n.key);
    if (TRIVIAL.has(n.k)) return E.render(n, null);
    for (const k of n.kids) if (this.worthy(k)) this.ens(k, ctx, false);
    const code = E.render(n, (x) => ctx.defs.get(x.key) || null);
    if (force || this.worthy(n)) {
      const v = `$v${this.uid++}`;
      ctx.lines.push(`const ${v} = ${code};`);
      ctx.defs.set(n.key, v);
      return v;
    }
    return code;
  }

  block(ctx) {
    return { defs: new Map(ctx.defs), lines: [] };
  }

  site(desc) {
    this.sites.push(`${this.curName}: ${desc}`.slice(0, 300));
    return this.sites.length - 1;
  }

  trie(t, ctx, isComp, why) {
    if (!t || (!t.dec && !t.leaf)) {
      this.stats.fallbackEdges++;
      ctx.lines.push(`$fb(${this.site(why || "untraced path")});`);
      return;
    }
    if (t.leaf) {
      this.stats.leaves++;
      this.leaf(t.leaf, ctx, isComp);
      return;
    }
    this.stats.decisions++;
    const d = t.dec;
    if (d.kind === "bool") {
      const c = this.ens(d.node, ctx, false);
      const yes = this.block(ctx);
      const no = this.block(ctx);
      this.trie(t.edges.get(true), yes, isComp, `${d.node.key} is truthy`);
      this.trie(t.edges.get(false), no, isComp, `${d.node.key} is falsy`);
      ctx.lines.push(`if (${c}) {\n${yes.lines.join("\n")}\n} else {\n${no.lines.join("\n")}\n}`);
      return;
    }
    if (d.kind === "eq") {
      const v = this.ens(d.node, ctx, !TRIVIAL.has(d.node.k));
      let code = "";
      for (const [outcome, child] of t.edges) {
        const b = this.block(ctx);
        this.trie(child, b, isComp);
        code += `if (${eqTest(v, outcome)}) {\n${b.lines.join("\n")}\n} else `;
      }
      ctx.lines.push(`${code}{ $fb(${this.site(`${d.node.key} === <untraced value>`)}); }`);
      return;
    }
    const v = this.ens(d.node, ctx, false);
    let code = `switch (${CLASSIFIERS[d.kind]}(${v})) {\n`;
    for (const [outcome, child] of t.edges) {
      const b = this.block(ctx);
      this.trie(child, b, isComp);
      code += `case ${JSON.stringify(outcome)}: {\n${b.lines.join("\n")}\nbreak;\n}\n`;
    }
    ctx.lines.push(`${code}default: $fb(${this.site(`${d.kind}(${d.node.key}) untraced`)});\n}`);
  }

  leaf(leaf, ctx, isComp) {
    for (const n of leaf.effects) this.ens(n, ctx, true);
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
      ctx.lines.push(`$L = ${s.L};`);
      s.synced = true;
    }
  }

  out(ctx, code) {
    const last = ctx.lines.length - 1;
    const m = last >= 0 && /^\$o \+= (.*);$/s.exec(ctx.lines[last]);
    if (m) ctx.lines[last] = `$o += ${m[1]} + ${code};`;
    else ctx.lines.push(`$o += ${code};`);
  }

  slotCode(p, ctx) {
    if (p.s === "attrR") {
      const x = this.ens(p.node, ctx, !TRIVIAL.has(p.node.k));
      const bad = `$fb(${this.site(`attribute value ${p.node.key} of unsupported type`)})`;
      const v = p.vOK ? `${JSON.stringify(p.vpre)} + $e("" + ${x}) + ${JSON.stringify(p.vpost)}` : bad;
      const [t, f, n] = p.tbl.map((z) => JSON.stringify(z));
      return `(typeof ${x} === "string" || typeof ${x} === "number" ? ${v} : ${x} === true ? ${t} : ${x} === false ? ${f} : ${x} === null ? ${n} : ${x} === void 0 ? "" : ${bad})`;
    }
    const x = this.ens(p.node, ctx, false);
    switch (p.s) {
      case "attr":
        return `$e("" + ${x})`;
      case "styleS":
        return `$e(("" + ${x}).trim())`;
      case "styleM":
      case "html":
        return `("" + ${x})`;
      default:
        throw new Error(`unknown slot ${p.s}`);
    }
  }

  parts(list, ctx) {
    const codes = [];
    let pending = "";
    for (const p of list) {
      if (typeof p === "string") pending += p;
      else {
        if (pending) codes.push(JSON.stringify(pending));
        pending = "";
        codes.push(this.slotCode(p, ctx));
      }
    }
    if (pending) codes.push(JSON.stringify(pending));
    return codes.join(" + ");
  }

  spec(s, ctx) {
    if (s.k === "x") return this.ens(s.node, ctx, false);
    const b = this.block(ctx);
    const st = { L: null, synced: true };
    this.emit(s.out, b, st, "$tc");
    this.sync(b, st);
    return `new $Th(function ($tc) {\n${b.lines.join("\n")}\n})`;
  }

  emit(out, ctx, s, tc) {
    if (!out) return;
    switch (out.t) {
      case "none":
        return;
      case "text": {
        const esc = escapeHtml(out.text);
        if (s.L === true) this.out(ctx, JSON.stringify("<!-- -->" + esc));
        else if (s.L === false) this.out(ctx, JSON.stringify(esc));
        else {
          ctx.lines.push(`if ($L) $o += "<!-- -->";`);
          this.out(ctx, JSON.stringify(esc));
        }
        s.L = true;
        s.synced = false;
        return;
      }
      case "tslot": {
        const x = this.ens(out.node, ctx, false);
        this.sync(ctx, s);
        ctx.lines.push(`$tn(${x});`);
        s.L = null;
        s.synced = true;
        return;
      }
      case "host": {
        const open = this.parts(out.open, ctx);
        if (open) this.out(ctx, open);
        s.L = false;
        s.synced = false;
        this.emit(out.child, ctx, s, tc);
        const close = this.parts(out.close, ctx);
        if (close) this.out(ctx, close);
        s.L = false;
        s.synced = false;
        return;
      }
      case "frag":
        this.emit(out.child, ctx, s, tc);
        return;
      case "comp": {
        const key = `c${out.fid}`;
        const props = `{ ${out.props.map(([k, sp]) => `${JSON.stringify(k)}: ${this.spec(sp, ctx)}`).join(", ")} }`;
        this.sync(ctx, s);
        if (!this.tries.has(key)) ctx.lines.push(`$fb(${this.site(`no template for component #${out.fid}`)});`);
        else ctx.lines.push(`$T${out.fid}(${props}, ${this.needsTC(key) ? tc : "null"});`);
        s.L = null;
        s.synced = true;
        return;
      }
      case "prov": {
        const sv = `$s${this.uid++}`;
        const value = this.spec(out.value, ctx);
        this.sync(ctx, s);
        ctx.lines.push(`const ${sv} = $ctx[${out.idx}];`, `$ctx[${out.idx}] = ${value};`);
        this.emit(out.child, ctx, s, tc);
        this.sync(ctx, s);
        ctx.lines.push(`$ctx[${out.idx}] = ${sv};`);
        return;
      }
      case "loop": {
        const u = this.uid++;
        const arr = this.ens(out.arr, ctx, false);
        const binds = out.bindings.map((b) => this.spec(b, ctx));
        this.sync(ctx, s);
        const key = `b${out.cb}`;
        ctx.lines.push(`const $a${u} = ${arr};`, `if (!Array.isArray($a${u})) $fb();`, `const $n${u} = $a${u}.length;`);
        if (!this.tries.has(key)) {
          ctx.lines.push(`if ($n${u} > 0) $fb(${this.site(`no template for callback #${out.cb}`)});`);
        } else {
          binds.forEach((b, i) => ctx.lines.push(`const $b${u}_${i} = ${b};`));
          const tcArg = this.needsTC(key) ? `$push(${tc}, $n${u}, $i${u})` : "null";
          const args = [`$a${u}[$i${u}]`, `$i${u}`, `$a${u}`, ...binds.map((_, i) => `$b${u}_${i}`), tcArg];
          ctx.lines.push(`for (let $i${u} = 0; $i${u} < $n${u}; $i${u}++) $B${out.cb}(${args.join(", ")});`);
        }
        s.L = null;
        s.synced = true;
        return;
      }
      case "dyn": {
        const x = this.ens(out.node, ctx, false);
        this.sync(ctx, s);
        ctx.lines.push(`$emitNode(${x}, ${tc});`);
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

module.exports = { generate };
