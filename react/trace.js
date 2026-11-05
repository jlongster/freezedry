"use strict";

// Concolic tracing runtime (`__h`) for the instrumented app module (see instrument.js).
//
// Every value inside instrumented code is either a plain JS value or a `Sym`: a concrete value
// (always fully concrete) plus the symbolic expression that computes it from the current frame's
// roots. Frames are opened when React calls a component (roots: props `P`, contexts `C<i>`, ids
// `I<k>`) and when Array#map calls an element-building callback (roots: `A0..A2` and the callback's
// free variables `E<j>`). Each frame records the ordered list of decisions (branch outcomes, key
// sets, ...) that the template must re-check at runtime, and its raw return value; element
// structure is recorded per `React.createElement` call.
//
// Anything the tracer cannot express soundly "poisons" the current frame: execution continues
// concretely (so React still renders), but the frame is not learned, and at runtime the template
// falls back to renderToString when it reaches that situation.

const E = require("./expr");
const { NoExpr } = E;

class Sym {
  constructor(n, c, fr) {
    this.n = n;
    this.c = c;
    this.fr = fr;
  }
}

const SPREAD = Symbol("spread");
const MODULE = { kind: "module" };

const BINOPS = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b,
  "%": (a, b) => a % b,
  "**": (a, b) => a ** b,
  "==": (a, b) => a == b, // eslint-disable-line eqeqeq
  "!=": (a, b) => a != b, // eslint-disable-line eqeqeq
  "===": (a, b) => a === b,
  "!==": (a, b) => a !== b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "&": (a, b) => a & b,
  "|": (a, b) => a | b,
  "^": (a, b) => a ^ b,
  "<<": (a, b) => a << b,
  ">>": (a, b) => a >> b,
  ">>>": (a, b) => a >>> b,
  in: (a, b) => a in b,
  instanceof: (a, b) => a instanceof b,
};
const UNOPS = {
  "!": (a) => !a,
  "-": (a) => -a,
  "+": (a) => +a,
  "~": (a) => ~a,
  typeof: (a) => typeof a,
};

function buildNatives() {
  const statics = new Map();
  for (const name of Object.getOwnPropertyNames(Math)) {
    if (typeof Math[name] === "function" && name !== "random") statics.set(Math[name], `Math.${name}`);
  }
  const add = (objName, names) => {
    const o = globalThis[objName];
    for (const n of names) if (typeof o[n] === "function") statics.set(o[n], `${objName}.${n}`);
  };
  add("Object", ["keys", "values", "entries", "is", "getPrototypeOf", "freeze"]);
  add("Array", ["isArray", "from", "of"]);
  add("JSON", ["stringify", "parse"]);
  add("Number", ["isFinite", "isInteger", "isNaN", "isSafeInteger"]);
  add("String", ["fromCharCode", "fromCodePoint"]);
  for (const g of [
    "String",
    "Number",
    "Boolean",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "encodeURIComponent",
    "encodeURI",
    "decodeURIComponent",
    "decodeURI",
  ]) {
    statics.set(globalThis[g], g);
  }
  const methods = new Set();
  const addProto = (proto, skip) => {
    for (const n of Object.getOwnPropertyNames(proto)) {
      if (n === "constructor" || skip.has(n)) continue;
      const d = Object.getOwnPropertyDescriptor(proto, n);
      if (typeof d.value === "function") methods.add(d.value);
    }
  };
  addProto(String.prototype, new Set());
  addProto(Number.prototype, new Set());
  addProto(Boolean.prototype, new Set());
  addProto(
    Array.prototype,
    new Set([
      "push",
      "pop",
      "shift",
      "unshift",
      "splice",
      "sort",
      "reverse",
      "fill",
      "copyWithin",
      "keys",
      "values",
      "entries",
      "forEach",
    ])
  );
  methods.add(Object.prototype.hasOwnProperty);
  methods.add(Object.prototype.toString);
  methods.add(RegExp.prototype.test);
  const volatile = new Set([Math.random, Date.now]);
  if (globalThis.performance && performance.now) volatile.add(performance.now);
  return { statics, methods, volatile };
}

const NATIVES = buildNatives();
const LOCAL_MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice"]);

function createTracer({ React, fns }) {
  const fnMeta = fns;
  const fnInfo = new WeakMap(); // fn -> { fid, getter }
  const locals = new WeakMap(); // object created by instrumented code -> creating frame | MODULE
  const elShadow = new WeakMap(); // React element -> { type, entries, frame }
  const propsToEl = new WeakMap(); // element.props -> element (component elements)
  const loopArr = new WeakMap(); // array returned by a traced map -> loop record
  const modNames = new Map(); // object/function -> module binding name
  const modValues = new Map(); // name -> value
  const ctxNames = []; // context index -> module binding name
  const ctxIndex = new Map(); // name -> index

  const st = {
    stack: [],
    cur: null,
    cm: 0, // concrete mode depth (inside opaque calls)
    pendingCall: false,
    pendingSub: null,
    records: [],
    poisonCounts: new Map(),
  };

  function poison(reason) {
    if (st.cur && !st.cur.poisoned) {
      st.cur.poisoned = reason;
      st.poisonCounts.set(reason, (st.poisonCounts.get(reason) || 0) + 1);
    }
  }

  function isLocal(v) {
    return v !== null && typeof v === "object" && locals.has(v);
  }

  function unwrap(v, memo) {
    if (v instanceof Sym) return v.c;
    if (!isLocal(v)) return v;
    if (!memo) memo = new Map();
    if (memo.has(v)) return memo.get(v);
    const out = Array.isArray(v) ? new Array(v.length) : {};
    memo.set(v, out);
    for (const k of Object.keys(v)) out[k] = unwrap(v[k], memo);
    return out;
  }

  function hasSym(v, seen) {
    if (v instanceof Sym) return true;
    if (!isLocal(v)) return false;
    if (!seen) seen = new Set();
    if (seen.has(v)) return false;
    seen.add(v);
    for (const k of Object.keys(v)) if (hasSym(v[k], seen)) return true;
    return false;
  }

  function anySym(list) {
    for (const x of list) if (hasSym(x)) return true;
    return false;
  }

  function isElementish(v, depth = 0) {
    if (v === null || typeof v !== "object" || depth > 6) return false;
    if (v.$$typeof !== undefined) return true;
    if (Array.isArray(v)) return v.some((x) => isElementish(x instanceof Sym ? x.c : x, depth + 1));
    return false;
  }

  function newFrame(kind, fid) {
    return {
      kind,
      fid,
      decisions: [],
      decided: new Map(),
      poisoned: null,
      idCount: 0,
      roots: new Map(),
      eRoots: new Map(),
      out: undefined,
      el: null,
      loop: null,
      args: null,
      effects: [],
    };
  }

  function rootSym(frame, name, c) {
    let s = frame.roots.get(name);
    if (!s) {
      s = new Sym(E.root(`$r${name}`), c, frame);
      frame.roots.set(name, s);
    }
    return s;
  }

  // Operations that may throw (property reads, calls) are re-performed by the template even when
  // their value is unused, so a template never succeeds where the original would have thrown.
  const THROWING = new Set(["get", "call", "mcall", "new"]);
  function mkSym(node, c) {
    if (st.cur && (THROWING.has(node.k) || (node.k === "bin" && (node.d === "in" || node.d === "instanceof")))) {
      st.cur.effects.push(node);
    }
    return new Sym(node, c, st.cur);
  }

  function decide(kind, node, outcome) {
    const f = st.cur;
    if (!f) return;
    const k = `${kind}:${node.key}`;
    if (f.decided.has(k)) {
      if (f.decided.get(k) !== outcome) poison("inconsistent decision");
      return;
    }
    f.decided.set(k, outcome);
    f.decisions.push({ kind, node, outcome });
  }

  function sameFrame(s) {
    if (s.fr !== st.cur) {
      poison("cross-frame symbol");
      return false;
    }
    return true;
  }

  // Expression for a value in the current frame; throws NoExpr when not expressible.
  function exprOf(v, seen) {
    if (v instanceof Sym) {
      if (v.fr !== st.cur) throw new NoExpr("cross-frame symbol");
      return v.n;
    }
    if (v === null || (typeof v !== "object" && typeof v !== "function")) return E.lit(v);
    if (modNames.has(v)) return E.ref(modNames.get(v));
    if (typeof v === "function") {
      const info = fnInfo.get(v);
      if (info && fnMeta[info.fid].pure) {
        const free = info.getter ? info.getter() : [];
        return E.mk(info.fid, free.map((x) => exprOf(x, seen)));
      }
      throw new NoExpr("function value");
    }
    if (v instanceof RegExp) {
      if (v.lastIndex !== 0) throw new NoExpr("regexp with state");
      return E.re(v.toString());
    }
    if (v.$$typeof !== undefined) throw new NoExpr("React element in expression");
    if (!seen) seen = new Set();
    if (seen.has(v)) throw new NoExpr("cyclic value");
    seen.add(v);
    try {
      if (Array.isArray(v)) {
        if (Object.getPrototypeOf(v) !== Array.prototype) throw new NoExpr("array subclass");
        const kids = [];
        for (let i = 0; i < v.length; i++) {
          if (!(i in v)) throw new NoExpr("sparse array");
          kids.push(exprOf(v[i], seen));
        }
        return E.arr(kids);
      }
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new NoExpr("non-plain object");
      if (Object.getOwnPropertySymbols(v).length) throw new NoExpr("symbol keys");
      const keys = Object.keys(v);
      if (Object.getOwnPropertyNames(v).length !== keys.length) throw new NoExpr("non-enumerable props");
      for (const k of keys) {
        const d = Object.getOwnPropertyDescriptor(v, k);
        if (!("value" in d)) throw new NoExpr("accessor property");
      }
      if (keys.includes("__proto__")) throw new NoExpr("__proto__ key");
      return E.obj(
        keys,
        keys.map((k) => exprOf(v[k], seen))
      );
    } finally {
      seen.delete(v);
    }
  }

  function symResult(build, c) {
    try {
      return mkSym(build(), c);
    } catch (err) {
      if (!(err instanceof NoExpr)) throw err;
      poison(`not expressible: ${err.message}`);
      return c;
    }
  }

  function keysOutcome(v) {
    if (v === null || v === undefined) return "#nullish";
    if (typeof v !== "object") return `#${typeof v}`;
    if (Object.getOwnPropertySymbols(v).length) return "#symbols";
    return `o:${Object.keys(v).join("\u0001")}`;
  }

  function spreadInto(target, src) {
    if (src instanceof Sym) {
      if (!sameFrame(src)) {
        Object.assign(target, unwrap(src));
        return;
      }
      const outcome = keysOutcome(src.c);
      if (outcome[0] === "#" && outcome !== "#nullish") {
        poison("spread of non-object");
        Object.assign(target, src.c);
        return;
      }
      decide("keys", src.n, outcome);
      if (outcome === "#nullish") return;
      for (const k of Object.keys(src.c)) target[k] = mkSym(E.get(src.n, E.lit(k)), src.c[k]);
      return;
    }
    if (isLocal(src)) {
      for (const k of Object.keys(src)) target[k] = src[k];
      return;
    }
    Object.assign(target, src);
  }

  function registerLocal(o) {
    locals.set(o, st.cur || MODULE);
    return o;
  }

  function canWrite(o) {
    if (st.cm) return true;
    if (!st.cur) return true;
    return isLocal(o) && locals.get(o) === st.cur;
  }

  // ------------------------------------------------------------------ calls

  function callFn(fv, thisArg, args, calleeSym) {
    const info = typeof fv === "function" ? fnInfo.get(fv) : undefined;
    if (info) {
      if (fnMeta[info.fid].pure) {
        const free = info.getter ? info.getter() : [];
        const symbolic = calleeSym || anySym(args) || anySym(free);
        let r;
        st.cm++;
        try {
          r = fv.apply(undefined, args.map((a) => unwrap(a)));
        } finally {
          st.cm--;
        }
        if (!symbolic) return r;
        return symResult(() => {
          const f = calleeSym ? exprOf(calleeSym) : modNames.has(fv) ? E.ref(modNames.get(fv)) : exprOf(fv);
          return E.call(
            f,
            args.map((a) => exprOf(a))
          );
        }, r);
      }
      if (calleeSym) poison("call of symbolic impure function");
      st.pendingCall = true;
      return fv.apply(thisArg, args);
    }
    const special = specials.get(fv);
    if (special) return special(thisArg, args);
    if (anySym(args) || hasSym(thisArg)) {
      const name = NATIVES.statics.get(fv);
      let r;
      st.cm++;
      try {
        r = fv.apply(unwrap(thisArg), args.map((a) => unwrap(a)));
      } finally {
        st.cm--;
      }
      if (name) return symResult(() => E.call(E.ref(name), args.map((a) => exprOf(a))), r);
      poison(`native ${fv && fv.name} with symbolic arguments`);
      return r;
    }
    if (NATIVES.volatile.has(fv)) poison(`volatile ${fv.name}`);
    return fv.apply(thisArg, args);
  }

  function methodCall(o, key, args) {
    if (key instanceof Sym) {
      poison("symbolic method name");
      key = key.c;
    }
    if (o instanceof Sym) {
      if (!sameFrame(o)) return o.c[key](...args.map((a) => unwrap(a)));
      if (isElementish(o.c)) poison("method call on element");
      const fv = o.c[key];
      if (fv === Array.prototype.map && Array.isArray(o.c) && isImpureFn(args[0])) return mapLoop(o, args);
      let r;
      st.cm++;
      try {
        r = fv.apply(o.c, args.map((a) => unwrap(a)));
      } finally {
        st.cm--;
      }
      if (!NATIVES.methods.has(fv)) {
        poison(`method .${String(key)} on symbolic value`);
        return r;
      }
      return symResult(() => E.mcall(o.n, String(key), args.map((a) => exprOf(a))), r);
    }
    if (o === null || o === undefined) return o[key]; // throws the real TypeError
    const fv = o[key];
    if (typeof fv === "function" && fnInfo.has(fv)) return callFn(fv, o, args, null);
    const special = specials.get(fv);
    if (special) return special(o, args);
    if (isLocal(o)) {
      if (Array.isArray(o) && fv === Array.prototype.map && isImpureFn(args[0])) return mapLoop(o, args);
      if (LOCAL_MUTATORS.has(key) && Array.isArray(o)) {
        if (!canWrite(o)) poison("mutates non-local array");
        return fv.apply(o, args);
      }
      if (hasSym(o) || anySym(args)) {
        let r;
        st.cm++;
        try {
          r = fv.apply(unwrap(o), args.map((a) => unwrap(a)));
        } finally {
          st.cm--;
        }
        if (!NATIVES.methods.has(fv)) {
          poison(`method .${String(key)} on local value with symbols`);
          return r;
        }
        return symResult(() => E.mcall(exprOf(o), String(key), args.map((a) => exprOf(a))), r);
      }
      if (!NATIVES.methods.has(fv) && st.cur && typeof fv === "function" && !canWrite(o)) {
        poison(`method .${String(key)} on shared object`);
      }
      return fv.apply(o, args);
    }
    if (anySym(args)) {
      let r;
      st.cm++;
      try {
        r = fv.apply(o, args.map((a) => unwrap(a)));
      } finally {
        st.cm--;
      }
      const name = NATIVES.statics.get(fv);
      if (name) return symResult(() => E.call(E.ref(name), args.map((a) => exprOf(a))), r);
      if (NATIVES.methods.has(fv)) return symResult(() => E.mcall(exprOf(o), String(key), args.map((a) => exprOf(a))), r);
      poison(`native .${String(key)} with symbolic arguments`);
      return r;
    }
    if (NATIVES.volatile.has(fv)) poison(`volatile ${String(key)}`);
    return fv.apply(o, args);
  }

  function isImpureFn(f) {
    const info = typeof f === "function" ? fnInfo.get(f) : undefined;
    return !!info && !fnMeta[info.fid].pure;
  }

  // Array#map with an element-building callback: each call is its own frame, so the callback's
  // template is learned once and applied to any element at runtime.
  function mapLoop(arrV, args) {
    const cb = args[0];
    if (args.length > 1) poison("map thisArg");
    const info = fnInfo.get(cb);
    const concrete = arrV instanceof Sym ? arrV.c : arrV;
    const bindings = info.getter ? info.getter() : [];
    const loop = { arr: arrV, cbFid: info.fid, bindings, frame: st.cur };
    const n = concrete.length;
    const out = new Array(n);
    const whole = unwrap(arrV);
    for (let i = 0; i < n; i++) {
      if (!(i in concrete)) poison("sparse array map");
      const sub = newFrame("cb", info.fid);
      sub.loop = loop;
      sub.parent = st.cur;
      sub.args = [rootSym(sub, "A0", unwrap(concrete[i])), rootSym(sub, "A1", i), rootSym(sub, "A2", whole)];
      st.pendingSub = sub;
      out[i] = cb(sub.args[0], sub.args[1], sub.args[2]);
    }
    loopArr.set(out, loop);
    return out;
  }

  function runFrame(frame, inner, thisArg, args) {
    st.stack.push(frame);
    st.cur = frame;
    let ret;
    try {
      ret = inner.apply(thisArg, args);
    } finally {
      st.stack.pop();
      st.cur = st.stack.length ? st.stack[st.stack.length - 1] : null;
    }
    frame.out = ret;
    st.records.push(frame);
    return unwrap(ret);
  }

  // ------------------------------------------------------------------ React API

  const specials = new Map();
  const realCE = React.createElement;

  function createElementSpecial(_this, args) {
    let [type, config, ...children] = args;
    if (type instanceof Sym) {
      poison("symbolic element type");
      type = type.c;
    }
    const entries = [];
    let key;
    let ref;
    if (config instanceof Sym) {
      const target = {};
      spreadInto(target, config);
      config = target;
    }
    if (config !== null && config !== undefined) {
      for (const k of Object.keys(config)) {
        if (k === "key") key = config.key;
        else if (k === "ref") ref = config.ref;
        else if (k === "__self" || k === "__source") continue;
        else entries.push([k, config[k]]);
      }
    }
    if (children.length) {
      const c = children.length === 1 ? children[0] : registerLocal(children.slice());
      const idx = entries.findIndex((e) => e[0] === "children");
      if (idx >= 0) entries[idx] = ["children", c];
      else entries.push(["children", c]);
    }
    if (type && type.defaultProps) poison("defaultProps");
    const cfg = {};
    for (const [k, v] of entries) if (k !== "children" || !children.length) cfg[k] = unwrap(v);
    if (key !== undefined) cfg.key = unwrap(key);
    if (ref !== undefined) cfg.ref = unwrap(ref);
    const el = realCE(type, cfg, ...children.map((c) => unwrap(c)));
    elShadow.set(el, { type, entries, frame: st.cur });
    if (typeof type === "function" || (type && typeof type === "object")) propsToEl.set(el.props, el);
    return el;
  }
  specials.set(React.createElement, createElementSpecial);

  specials.set(React.useContext, (_this, [ctx]) => {
    const val = React.useContext(ctx);
    if (!st.cur || st.cur.kind !== "comp") {
      poison("useContext outside component frame");
      return val;
    }
    const name = modNames.get(ctx);
    if (!name) {
      poison("context not bound at module level");
      return val;
    }
    if (!ctxIndex.has(name)) {
      ctxIndex.set(name, ctxNames.length);
      ctxNames.push(name);
    }
    return rootSym(st.cur, `C${ctxIndex.get(name)}`, val);
  });
  specials.set(React.useId, () => {
    const id = React.useId();
    if (!st.cur || st.cur.kind !== "comp") {
      poison("useId outside component frame");
      return id;
    }
    return rootSym(st.cur, `I${st.cur.idCount++}`, id);
  });
  specials.set(React.useMemo, (_this, [fn, deps]) => React.useMemo(() => callFn(fn, undefined, [], null), unwrap(deps)));
  specials.set(React.useCallback, (_this, [fn, deps]) => React.useCallback(fn, unwrap(deps)));
  specials.set(React.useState, (_this, [init]) => {
    const v = typeof unwrap(init) === "function" ? callFn(unwrap(init), undefined, [], null) : init;
    const pair = React.useState(() => unwrap(v));
    const setter = (...a) => {
      poison("setState during render");
      return pair[1](...a.map((x) => unwrap(x)));
    };
    return registerLocal([v, setter]);
  });
  specials.set(React.useReducer, (_this, args) => {
    poison("useReducer");
    return React.useReducer(...args.map((a) => unwrap(a)));
  });
  specials.set(React.useRef, (_this, [init]) => React.useRef(init));
  for (const name of ["useEffect", "useLayoutEffect", "useInsertionEffect", "useImperativeHandle", "useDebugValue"]) {
    if (React[name]) specials.set(React[name], (_this, args) => React[name](...args));
  }
  if (React.useDeferredValue) specials.set(React.useDeferredValue, (_this, [v]) => v);
  for (const name of ["useSyncExternalStore", "cloneElement", "isValidElement", "createRef", "lazy", "forwardRef", "memo"]) {
    if (React[name]) {
      specials.set(React[name], (_this, args) => {
        if (st.cur) poison(`React.${name}`);
        return React[name](...args.map((a) => unwrap(a)));
      });
    }
  }
  if (React.Children) {
    for (const name of Object.keys(React.Children)) {
      specials.set(React.Children[name], (_this, args) => {
        poison(`React.Children.${name}`);
        return React.Children[name](...args.map((a) => unwrap(a)));
      });
    }
  }
  specials.set(Object.assign, (_this, [target, ...sources]) => {
    if (!st.cur || (isLocal(target) && canWrite(target))) {
      if (!isLocal(target) && !anySym(sources)) return Object.assign(target, ...sources);
      for (const s of sources) spreadInto(target, s);
      return target;
    }
    poison("Object.assign onto shared object");
    return Object.assign(target, ...sources.map((s) => unwrap(s)));
  });

  // ------------------------------------------------------------------ hooks used by instrumented code

  const h = {
    SPREAD,
    F(fid, fn, getter) {
      fnInfo.set(fn, { fid, getter });
      return fn;
    },
    mod(getters) {
      for (const name of Object.keys(getters)) {
        let v;
        try {
          v = getters[name]();
        } catch (_e) {
          continue;
        }
        modValues.set(name, v);
        if ((typeof v === "object" && v !== null) || typeof v === "function") {
          if (!modNames.has(v)) modNames.set(v, name);
        }
      }
    },
    fn(fid, thisArg, args, inner) {
      args = Array.prototype.slice.call(args);
      if (st.cm) return inner.apply(thisArg, args);
      if (st.pendingCall) {
        st.pendingCall = false;
        return inner.apply(thisArg, args);
      }
      const sub = st.pendingSub;
      if (sub && sub.fid === fid) {
        st.pendingSub = null;
        return runFrame(sub, inner, thisArg, sub.args);
      }
      const el = args.length && args[0] !== null && typeof args[0] === "object" ? propsToEl.get(args[0]) : undefined;
      if (el) {
        const info = fnInfo.get(el.type);
        if (info && info.fid === fid) {
          const frame = newFrame("comp", fid);
          frame.el = el;
          args[0] = rootSym(frame, "P", args[0]);
          return runFrame(frame, inner, thisArg, args);
        }
      }
      return inner.apply(thisArg, args);
    },
    t(x) {
      if (st.cm) return !!unwrap(x);
      if (x instanceof Sym) {
        if (sameFrame(x)) decide("bool", x.n, !!x.c);
        return !!x.c;
      }
      return !!x;
    },
    b(op, a, b) {
      const sa = !st.cm && (a instanceof Sym || hasSym(a));
      const sb = !st.cm && (b instanceof Sym || hasSym(b));
      if (!sa && !sb) return BINOPS[op](st.cm ? unwrap(a) : a, st.cm ? unwrap(b) : b);
      const ca = unwrap(a);
      const cb = unwrap(b);
      const r = BINOPS[op](ca, cb);
      if ((sa && !(a instanceof Sym)) || (sb && !(b instanceof Sym))) {
        poison(`operator ${op} on object with symbols`);
        return r;
      }
      if ((sa && isElementish(ca)) || (sb && isElementish(cb))) {
        poison("element in expression");
        return r;
      }
      return symResult(() => E.bin(op, exprOf(a), exprOf(b)), r);
    },
    u(op, a) {
      if (st.cm || !(a instanceof Sym)) {
        if (!st.cm && hasSym(a)) {
          if (op === "!") return false;
          poison(`unary ${op} on object with symbols`);
        }
        return UNOPS[op](unwrap(a));
      }
      const r = UNOPS[op](a.c);
      if (isElementish(a.c)) {
        poison("element in expression");
        return r;
      }
      return symResult(() => E.un(op, exprOf(a)), r);
    },
    L(op, a, right) {
      if (op === "&&") return h.t(a) ? right() : a;
      if (op === "||") return h.t(a) ? a : right();
      return h.t(h.b("!=", a, null)) ? a : right();
    },
    tpl(quasis, vals) {
      let s = quasis[0];
      for (let i = 0; i < vals.length; i++) s += `${unwrap(vals[i])}` + quasis[i + 1];
      if (st.cm || !anySym(vals)) return s;
      return symResult(
        () =>
          E.tpl(
            quasis,
            vals.map((v) => exprOf(v))
          ),
        s
      );
    },
    g(o, k) {
      if (st.cm) {
        const v = unwrap(o)[unwrap(k)];
        return v instanceof Sym || isLocal(v) ? unwrap(v) : v;
      }
      if (o instanceof Sym) {
        const kc = unwrap(k);
        if (!sameFrame(o) || (k instanceof Sym && !sameFrame(k))) return unwrap(o.c[kc]);
        if (isElementish(o.c)) {
          poison("property read on element");
          return o.c[kc];
        }
        const v = o.c[kc];
        return symResult(() => E.get(o.n, exprOf(k)), v);
      }
      if (k instanceof Sym) {
        if (!sameFrame(k)) return unwrap(unwrap(o)[k.c]);
        const v = unwrap(unwrap(o)[k.c]);
        return symResult(() => E.get(exprOf(o), k.n), v);
      }
      return o[k];
    },
    s(o, k, v) {
      k = unwrap(k);
      if (st.cm) {
        o[k] = unwrap(v);
        return v;
      }
      if (canWrite(o)) {
        o[k] = isLocal(o) ? v : unwrap(v);
        return v;
      }
      poison("writes shared object");
      (o instanceof Sym ? o.c : o)[k] = unwrap(v);
      return v;
    },
    so(o, k, op, v) {
      return h.s(o, k, h.b(op, h.g(o, k), v));
    },
    upd(o, k, op, prefix) {
      const old = h.u("+", h.g(o, k));
      const nv = h.b(op, old, 1);
      h.s(o, k, nv);
      return prefix ? nv : old;
    },
    del(o, k) {
      k = unwrap(k);
      if (!canWrite(o)) poison("delete on shared object");
      return delete (o instanceof Sym ? o.c : o)[k];
    },
    c(f, args) {
      if (st.cm) return unwrap(f).apply(undefined, args.map((a) => unwrap(a)));
      if (f instanceof Sym) {
        if (!sameFrame(f)) return f.c.apply(undefined, args.map((a) => unwrap(a)));
        return callFn(f.c, undefined, args, f);
      }
      return callFn(f, undefined, args, null);
    },
    mc(o, k, args) {
      if (st.cm) {
        const recv = o instanceof Sym ? o.c : o;
        const fv = recv[unwrap(k)];
        return fv.apply(isLocal(recv) && hasSym(recv) ? unwrap(recv) : recv, args.map((a) => unwrap(a)));
      }
      return methodCall(o, k, args);
    },
    n(C, args) {
      const Cc = unwrap(C);
      if (st.cm) return new Cc(...args.map((a) => unwrap(a)));
      if (Cc === Date) poison("new Date");
      if (fnInfo.has(Cc)) poison("new on instrumented function");
      if (anySym(args) || C instanceof Sym) {
        const r = new Cc(...args.map((a) => unwrap(a)));
        if ([RegExp, Array, Set, Map].includes(Cc)) {
          poison("new with symbolic arguments");
        } else {
          poison(`new ${Cc && Cc.name}`);
        }
        return r;
      }
      return new Cc(...args);
    },
    o(parts) {
      const obj = {};
      for (let i = 0; i < parts.length; i += 2) {
        if (parts[i] === SPREAD) {
          if (st.cm) Object.assign(obj, unwrap(parts[i + 1]));
          else spreadInto(obj, parts[i + 1]);
        } else {
          obj[parts[i]] = st.cm ? unwrap(parts[i + 1]) : parts[i + 1];
        }
      }
      return st.cm ? obj : registerLocal(obj);
    },
    a(items) {
      if (st.cm) return items.map((x) => unwrap(x));
      return registerLocal(items);
    },
    sp(x) {
      if (x instanceof Sym) {
        if (!st.cm) poison("spread of symbolic value");
        return [...x.c];
      }
      return x;
    },
    key(k) {
      if (k instanceof Sym) {
        if (!st.cm) poison("symbolic computed key");
        return k.c;
      }
      return k;
    },
    cv(declFid, name, value) {
      const cur = st.cur;
      if (st.cm || !cur || cur.kind !== "cb" || within(declFid, cur.fid)) return value;
      let s = cur.eRoots.get(name);
      if (!s) {
        const idx = fnMeta[cur.fid].freeLocals.indexOf(name);
        if (idx < 0) {
          poison("unexpected closure variable");
          return value;
        }
        if (cur.loop.bindings[idx] !== value) poison("closure variable changed during map");
        s = rootSym(cur, `E${idx}`, unwrap(value));
        cur.eRoots.set(name, s);
      }
      return s;
    },
    cw(declFid) {
      const cur = st.cur;
      if (!st.cm && cur && cur.kind === "cb" && !within(declFid, cur.fid)) poison("writes closure variable");
    },
    caught() {
      if (!st.cm) poison("exception caught in traced code");
    },
    forin(x) {
      if (x instanceof Sym) {
        if (!st.cm) poison("for-in/of over symbolic value");
        return x.c;
      }
      return st.cm ? unwrap(x) : x;
    },
  };

  function within(fid, ancestor) {
    for (let x = fid; x !== -1 && x !== undefined && x !== null; x = fnMeta[x].parent) {
      if (x === ancestor) return true;
      if (x === 0) return false;
    }
    return false;
  }

  return {
    h,
    st,
    Sym,
    unwrap,
    hasSym,
    isLocal,
    isElementish,
    exprOf,
    elShadow,
    loopArr,
    fnInfo,
    modNames,
    modValues,
    ctxNames,
    ctxIndex,
    createRoot(type, props) {
      const el = realCE(type, props);
      propsToEl.set(el.props, el);
      return el;
    },
    reset() {
      st.records = [];
      st.stack = [];
      st.cur = null;
      st.cm = 0;
      st.pendingCall = false;
      st.pendingSub = null;
    },
  };
}

module.exports = { createTracer, Sym, NoExpr, BINOPS, UNOPS, NATIVES };
