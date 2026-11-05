"use strict";

// Symbolic expression nodes. A node's `key` is its canonical JavaScript source in terms of the
// template roots (P, C<i>, I<k>, A0..A2, E<j>) and module bindings, so nodes from different traces
// compare by key, and the code generator can print them directly (with common-subexpression names).

class NoExpr extends Error {}

function litCode(v) {
  switch (typeof v) {
    case "undefined":
      return "void 0";
    case "boolean":
      return String(v);
    case "string":
      return JSON.stringify(v);
    case "bigint":
      return `${v}n`;
    case "number":
      if (Number.isNaN(v)) return "(0/0)";
      if (v === Infinity) return "(1/0)";
      if (v === -Infinity) return "(-1/0)";
      if (Object.is(v, -0)) return "(-0)";
      return v < 0 ? `(${String(v)})` : String(v);
    case "symbol": {
      const k = Symbol.keyFor(v);
      if (k !== undefined) return `Symbol.for(${JSON.stringify(k)})`;
      throw new NoExpr("unregistered symbol");
    }
    default:
      if (v === null) return "null";
      throw new NoExpr(`not a primitive: ${typeof v}`);
  }
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function make(k, kids, d) {
  const n = { k, kids, d, key: null };
  n.key = render(n, null);
  return n;
}

const root = (name) => make("root", [], name);
const lit = (v) => make("lit", [], v);
const ref = (name) => make("ref", [], name);
const get = (o, keyNode) => make("get", [o, keyNode]);
const call = (f, args) => make("call", [f, ...args]);
const mcall = (recv, name, args) => make("mcall", [recv, ...args], name);
const newc = (C, args) => make("new", [C, ...args]);
const bin = (op, a, b) => make("bin", [a, b], op);
const un = (op, a) => make("un", [a], op);
const tpl = (quasis, nodes) => make("tpl", nodes, quasis);
const obj = (keys, nodes) => make("obj", nodes, keys);
const arr = (nodes) => make("arr", nodes);
const mk = (fid, nodes) => make("mk", nodes, fid);
const re = (source) => make("re", [], source);

function wrapObj(code) {
  return /^[0-9(-]|^void /.test(code) || /^[0-9]/.test(code) ? `(${code})` : code;
}

// nameOf(node) returns a variable name for already-defined common subexpressions (or null).
function render(n, nameOf) {
  if (nameOf) {
    const name = nameOf(n);
    if (name) return name;
  }
  const r = (x) => render(x, nameOf);
  switch (n.k) {
    case "root":
    case "ref":
      return n.d;
    case "lit":
      return litCode(n.d);
    case "re":
      return n.d;
    case "get": {
      const [o, key] = n.kids;
      const oc = wrapObj(r(o));
      if (key.k === "lit" && typeof key.d === "string" && IDENT.test(key.d)) return `${oc}.${key.d}`;
      return `${oc}[${r(key)}]`;
    }
    case "call":
      return `${wrapCallee(r(n.kids[0]), n.kids[0])}(${n.kids.slice(1).map(r).join(", ")})`;
    case "mcall": {
      const recv = wrapObj(r(n.kids[0]));
      const m = IDENT.test(n.d) ? `.${n.d}` : `[${JSON.stringify(n.d)}]`;
      return `${recv}${m}(${n.kids.slice(1).map(r).join(", ")})`;
    }
    case "new":
      return `new (${r(n.kids[0])})(${n.kids.slice(1).map(r).join(", ")})`;
    case "bin":
      return `(${r(n.kids[0])} ${n.d} ${r(n.kids[1])})`;
    case "un":
      return `(${n.d}${/^[a-z]/.test(n.d) ? " " : ""}${r(n.kids[0])})`;
    case "tpl": {
      const esc = (s) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
      let out = "`" + esc(n.d[0]);
      n.kids.forEach((k, i) => {
        out += "${" + r(k) + "}" + esc(n.d[i + 1]);
      });
      return out + "`";
    }
    case "obj":
      return `({${n.d.map((k, i) => `${JSON.stringify(k)}: ${r(n.kids[i])}`).join(", ")}})`;
    case "arr":
      return `[${n.kids.map(r).join(", ")}]`;
    case "mk":
      return `$hy_mk${n.d}(${n.kids.map(r).join(", ")})`;
    default:
      throw new Error(`unknown node kind ${n.k}`);
  }
}

function wrapCallee(code, node) {
  // A member-expression callee would be called with a `this`; opaque helpers are `this`-free, but
  // keep the original receiver-less semantics explicit.
  if (node.k === "get") return `(0, ${code})`;
  return code;
}

// Static result type of an expression when the operation guarantees it regardless of operand
// values ("boolean" | "string" | "number"), else null.
const NUMBER_CALLS = new Set(["Number", "parseInt", "parseFloat"]);
const BOOL_CALLS = new Set(["Boolean", "isNaN", "isFinite", "Array.isArray", "Number.isFinite", "Number.isInteger", "Number.isNaN", "Number.isSafeInteger", "Object.is"]);
function typeOf(n) {
  switch (n.k) {
    case "lit":
      return typeof n.d === "boolean" || typeof n.d === "string" || typeof n.d === "number" ? typeof n.d : null;
    case "root":
      return n.d.startsWith("$rI") ? "string" : null;
    case "tpl":
      return "string";
    case "un":
      if (n.d === "!") return "boolean";
      if (n.d === "typeof") return "string";
      if (n.d === "+") return "number";
      if (n.d === "-" || n.d === "~") return typeOf(n.kids[0]) === "number" ? "number" : null;
      return null;
    case "bin": {
      const op = n.d;
      if (["==", "!=", "===", "!==", "<", "<=", ">", ">=", "in", "instanceof"].includes(op)) return "boolean";
      const a = typeOf(n.kids[0]);
      const b = typeOf(n.kids[1]);
      if (op === "+") {
        if (a === "string" || b === "string") return "string";
        return a === "number" && b === "number" ? "number" : null;
      }
      if (op === ">>>") return "number";
      return a === "number" && b === "number" ? "number" : null;
    }
    case "call": {
      const f = n.kids[0];
      if (f.k !== "ref") return null;
      if (f.d === "String") return "string";
      if (NUMBER_CALLS.has(f.d) || (f.d.startsWith("Math.") && f.d !== "Math.random")) return "number";
      if (BOOL_CALLS.has(f.d)) return "boolean";
      return null;
    }
    case "mcall": {
      const r = typeOf(n.kids[0]);
      if (r === "number" && ["toFixed", "toPrecision", "toString", "toExponential"].includes(n.d)) return "string";
      if (r === "string" && ["toUpperCase", "toLowerCase", "trim", "trimStart", "trimEnd", "slice", "substring", "charAt", "padStart", "padEnd", "repeat", "concat"].includes(n.d)) {
        return "string";
      }
      return null;
    }
    default:
      return null;
  }
}

module.exports = {
  typeOf,
  make, NoExpr, litCode, root, lit, ref, get, call, mcall, newc, bin, un, tpl, obj, arr, mk, re, render };
