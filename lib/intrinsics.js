"use strict";

const IDENTIFIER_NAME_RE = /^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u;

const RESERVED_WORDS = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const STRICT_RESTRICTED_BINDINGS = new Set([
  "arguments",
  "eval",
  "implements",
  "interface",
  "let",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "yield",
]);

const UNEXPOSED_INTRINSICS = new Map([
  ["TypedArray", "Object.getPrototypeOf(Uint8Array)"],
  ["TypedArray.prototype", "Object.getPrototypeOf(Uint8Array.prototype)"],
  ["%TypedArray%", "Object.getPrototypeOf(Uint8Array)"],
  ["%TypedArray%.prototype", "Object.getPrototypeOf(Uint8Array.prototype)"],
  ["%TypedArrayPrototype%", "Object.getPrototypeOf(Uint8Array.prototype)"],
  ["IteratorPrototype", "Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))"],
  ["%IteratorPrototype%", "Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))"],
  ["ArrayIteratorPrototype", "Object.getPrototypeOf([][Symbol.iterator]())"],
  ["%ArrayIteratorPrototype%", "Object.getPrototypeOf([][Symbol.iterator]())"],
  ["StringIteratorPrototype", 'Object.getPrototypeOf(""[Symbol.iterator]())'],
  ["%StringIteratorPrototype%", 'Object.getPrototypeOf(""[Symbol.iterator]())'],
  ["MapIteratorPrototype", "Object.getPrototypeOf(new Map()[Symbol.iterator]())"],
  ["%MapIteratorPrototype%", "Object.getPrototypeOf(new Map()[Symbol.iterator]())"],
  ["SetIteratorPrototype", "Object.getPrototypeOf(new Set()[Symbol.iterator]())"],
  ["%SetIteratorPrototype%", "Object.getPrototypeOf(new Set()[Symbol.iterator]())"],
  ["RegExpStringIteratorPrototype", 'Object.getPrototypeOf(/(?:)/[Symbol.matchAll](""))'],
  ["%RegExpStringIteratorPrototype%", 'Object.getPrototypeOf(/(?:)/[Symbol.matchAll](""))'],
  ["GeneratorFunction", "(function*(){}).constructor"],
  ["%GeneratorFunction%", "(function*(){}).constructor"],
  ["GeneratorFunction.prototype", "Object.getPrototypeOf(function*(){})"],
  ["%GeneratorFunction.prototype%", "Object.getPrototypeOf(function*(){})"],
  ["%Generator%", "Object.getPrototypeOf(function*(){})"],
  ["GeneratorPrototype", "Object.getPrototypeOf((function*(){})())"],
  ["%GeneratorPrototype%", "Object.getPrototypeOf((function*(){})())"],
  ["GeneratorFunction.prototype.prototype", "Object.getPrototypeOf((function*(){})())"],
  ["AsyncFunction", "(async function(){}).constructor"],
  ["%AsyncFunction%", "(async function(){}).constructor"],
  ["AsyncFunction.prototype", "Object.getPrototypeOf(async function(){})"],
  ["%AsyncFunction.prototype%", "Object.getPrototypeOf(async function(){})"],
  ["AsyncGeneratorFunction", "(async function*(){}).constructor"],
  ["%AsyncGeneratorFunction%", "(async function*(){}).constructor"],
  ["AsyncGeneratorFunction.prototype", "Object.getPrototypeOf(async function*(){})"],
  ["%AsyncGeneratorFunction.prototype%", "Object.getPrototypeOf(async function*(){})"],
  ["%AsyncGenerator%", "Object.getPrototypeOf(async function*(){})"],
  ["AsyncGeneratorPrototype", "Object.getPrototypeOf((async function*(){})())"],
  ["%AsyncGeneratorPrototype%", "Object.getPrototypeOf((async function*(){})())"],
  ["AsyncGeneratorFunction.prototype.prototype", "Object.getPrototypeOf((async function*(){})())"],
  [
    "AsyncIteratorPrototype",
    "Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf((async function*(){})())))",
  ],
  [
    "%AsyncIteratorPrototype%",
    "Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf((async function*(){})())))",
  ],
  [
    "%ThrowTypeError%",
    'Object.getOwnPropertyDescriptor(function(){"use strict";return arguments}(), "callee").get',
  ],
]);

// Accessor / non-writable properties that exist on standard built-in prototypes,
// where `obj.prop = v` could invoke a setter or fail on a getter-only property.
const BUILTIN_PROTO_UNSAFE_KEYS = new Set([
  "__proto__",
  "arguments",
  "caller",
  "size",
  "length",
  "byteLength",
  "byteOffset",
  "buffer",
  "maxByteLength",
  "resizable",
  "growable",
  "detached",
  "flags",
  "source",
  "dotAll",
  "global",
  "hasIndices",
  "ignoreCase",
  "multiline",
  "sticky",
  "unicode",
  "unicodeSets",
  "description",
  "stack",
]);

function isIdentifierName(str) {
  return typeof str === "string" && str.length > 0 && IDENTIFIER_NAME_RE.test(str);
}

function isBindingIdentifier(str) {
  return isIdentifierName(str) && !RESERVED_WORDS.has(str);
}

function isStrictSafeBinding(str) {
  return isBindingIdentifier(str) && !STRICT_RESTRICTED_BINDINGS.has(str);
}

function isArrayIndexKey(key) {
  if (typeof key !== "string" || key.length === 0 || key.length > 10) return false;
  if (key !== "0" && (key.charCodeAt(0) < 49 || key.charCodeAt(0) > 57)) return false;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  const n = Number(key);
  return n >= 0 && n < 4294967295;
}

function quoteString(str) {
  return JSON.stringify(String(str))
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/<\/(script)/gi, "<\\/$1");
}

function formatObjectLiteralKey(key) {
  if (key === "__proto__") return '["__proto__"]';
  if (isIdentifierName(key)) return key;
  if (isArrayIndexKey(key)) return key;
  return quoteString(key);
}

function formatMemberAccess(objExpr, key) {
  if (key !== "__proto__" && isIdentifierName(key)) {
    return `${objExpr}.${key}`;
  }
  if (isArrayIndexKey(key)) {
    return `${objExpr}[${key}]`;
  }
  return `${objExpr}[${quoteString(key)}]`;
}

function formatNumber(val, special) {
  if (special === "NaN") return "NaN";
  if (special === "-0") return "-0";
  if (special === "Infinity") return "1/0";
  if (special === "-Infinity") return "-1/0";
  const n = typeof val === "number" ? val : Number(val);
  if (Number.isNaN(n)) return "NaN";
  if (Object.is(n, -0)) return "-0";
  if (n === Infinity) return "1/0";
  if (n === -Infinity) return "-1/0";
  return n < 0 ? `(${String(n)})` : String(n);
}

function formatNumberBare(val, special) {
  if (special === "NaN") return "NaN";
  if (special === "-0") return "-0";
  if (special === "Infinity") return "1/0";
  if (special === "-Infinity") return "-1/0";
  const n = typeof val === "number" ? val : Number(val);
  if (Number.isNaN(n)) return "NaN";
  if (Object.is(n, -0)) return "-0";
  if (n === Infinity) return "1/0";
  if (n === -Infinity) return "-1/0";
  return String(n);
}

function formatPrimitive(ref) {
  const kind = ref.prim;
  switch (kind) {
    case "undefined":
      return "void 0";
    case "null":
      return "null";
    case "boolean": {
      const b = ref.value === true || ref.value === "true";
      return b ? "true" : "false";
    }
    case "number":
      return formatNumberBare(ref.value, ref.special);
    case "string":
      return quoteString(ref.value ?? "");
    case "bigint": {
      const raw = String(ref.value ?? "0").replace(/n$/, "");
      return `${raw}n`;
    }
    case "symbol": {
      if (ref.registered != null) {
        return `Symbol.for(${quoteString(ref.registered)})`;
      }
      if (typeof ref.intrinsic === "string") {
        return resolveIntrinsicExpr(ref.intrinsic);
      }
      if (typeof ref.value === "string" && ref.value.startsWith("Symbol.")) {
        return resolveIntrinsicExpr(ref.value);
      }
      if (ref.value == null) return "Symbol()";
      return `Symbol(${quoteString(ref.value)})`;
    }
    default:
      throw new Error(`Unknown primitive type: ${String(kind)}`);
  }
}

const vm = require("node:vm");
const acorn = require("acorn");

let _canonState = null;
function getCanonicalIntrinsicMap() {
  if (_canonState) return _canonState;
  const ctx = vm.createContext({});
  const canonicalSeeds = [
    "Object",
    "Object.prototype",
    "Function",
    "Function.prototype",
    "Array",
    "Array.prototype",
    "String",
    "String.prototype",
    "Number",
    "Number.prototype",
    "Boolean",
    "Boolean.prototype",
    "BigInt",
    "BigInt.prototype",
    "Symbol",
    "Symbol.prototype",
    "RegExp",
    "RegExp.prototype",
    "Date",
    "Date.prototype",
    "Error",
    "Error.prototype",
    "TypeError",
    "TypeError.prototype",
    "RangeError",
    "RangeError.prototype",
    "ReferenceError",
    "ReferenceError.prototype",
    "SyntaxError",
    "SyntaxError.prototype",
    "URIError",
    "URIError.prototype",
    "EvalError",
    "EvalError.prototype",
    "AggregateError",
    "AggregateError.prototype",
    "SuppressedError",
    "SuppressedError.prototype",
    "Map",
    "Map.prototype",
    "Set",
    "Set.prototype",
    "WeakMap",
    "WeakMap.prototype",
    "WeakSet",
    "WeakSet.prototype",
    "Promise",
    "Promise.prototype",
    "ArrayBuffer",
    "ArrayBuffer.prototype",
    "SharedArrayBuffer",
    "SharedArrayBuffer.prototype",
    "DataView",
    "DataView.prototype",
    "Int8Array",
    "Int8Array.prototype",
    "Uint8Array",
    "Uint8Array.prototype",
    "Uint8ClampedArray",
    "Uint8ClampedArray.prototype",
    "Int16Array",
    "Int16Array.prototype",
    "Uint16Array",
    "Uint16Array.prototype",
    "Float16Array",
    "Float16Array.prototype",
    "Int32Array",
    "Int32Array.prototype",
    "Uint32Array",
    "Uint32Array.prototype",
    "Float32Array",
    "Float32Array.prototype",
    "Float64Array",
    "Float64Array.prototype",
    "BigInt64Array",
    "BigInt64Array.prototype",
    "BigUint64Array",
    "BigUint64Array.prototype",
    "Object.getPrototypeOf(Uint8Array)",
    "Object.getPrototypeOf(Uint8Array.prototype)",
    "Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))",
    "Object.getPrototypeOf([][Symbol.iterator]())",
    "Object.getPrototypeOf(new Map()[Symbol.iterator]())",
    "Object.getPrototypeOf(new Set()[Symbol.iterator]())",
    'Object.getPrototypeOf(""[Symbol.iterator]())',
    "Object.getPrototypeOf(function*(){})",
    "Object.getPrototypeOf((function*(){})())",
    "Object.getPrototypeOf(async function(){})",
    "Object.getPrototypeOf(async function*(){})",
    "Object.getPrototypeOf((async function*(){})())",
  ];
  const valToExpr = new Map();
  for (const expr of canonicalSeeds) {
    try {
      const v = vm.runInContext(expr, ctx);
      if (v !== null && v !== undefined && !valToExpr.has(v)) {
        valToExpr.set(v, expr);
      }
    } catch (_e) {}
  }
  _canonState = { ctx, valToExpr, exprCache: new Map() };
  return _canonState;
}

function canonicalizeIntrinsicExpr(expr) {
  const st = getCanonicalIntrinsicMap();
  if (st.exprCache.has(expr)) return st.exprCache.get(expr);
  let out = expr;
  try {
    const v = vm.runInContext(expr, st.ctx);
    if (st.valToExpr.has(v)) {
      out = st.valToExpr.get(v);
    }
  } catch (_e) {}
  st.exprCache.set(expr, out);
  return out;
}

function resolveIntrinsicExpr(rawPath, globalVar) {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw new Error(`Invalid intrinsic path: ${String(rawPath)}`);
  }
  if (UNEXPOSED_INTRINSICS.has(rawPath)) {
    return UNEXPOSED_INTRINSICS.get(rawPath);
  }
  if (rawPath.startsWith("@@")) {
    const symName = rawPath.slice(2);
    return `Symbol.${symName}`;
  }
  let cleaned = rawPath;
  if (cleaned.startsWith("%") && cleaned.endsWith("%") && cleaned.length > 2) {
    cleaned = cleaned.slice(1, -1);
    if (UNEXPOSED_INTRINSICS.has(cleaned)) {
      return UNEXPOSED_INTRINSICS.get(cleaned);
    }
  } else if (cleaned.startsWith("%")) {
    // Handle e.g. "%TypedArray%.prototype.slice"
    const endPct = cleaned.indexOf("%", 1);
    if (endPct > 1) {
      const head = cleaned.slice(0, endPct + 1);
      const rest = cleaned.slice(endPct + 1);
      if (UNEXPOSED_INTRINSICS.has(head)) {
        const base = UNEXPOSED_INTRINSICS.get(head);
        if (!rest) return base;
        const tailParts = rest.replace(/^\./, "").split(".");
        let expr = base;
        for (const p of tailParts) {
          expr = formatMemberAccess(expr, p);
        }
        return expr;
      }
    }
  }

  if (cleaned === "globalThis" || cleaned === "global") {
    return globalVar || "globalThis";
  }

  // H1's snapshotIntrinsics emits valid JS expressions for hidden/computed intrinsics, e.g.
  // `Object.getPrototypeOf(Uint8Array.prototype)`, `Array.prototype[Symbol.iterator]`,
  // `Object.getOwnPropertyDescriptor(RegExp.prototype, "flags").get`.
  if (/[([\s"']/.test(cleaned)) {
    try {
      const prog = acorn.parse(`(\n${cleaned}\n)`, { ecmaVersion: "latest" });
      if (prog.body.length === 1 && prog.body[0].type === "ExpressionStatement") {
        return canonicalizeIntrinsicExpr(cleaned);
      }
    } catch (_e) {
      // Fall through to dotted path handling
    }
  }

  const parts = cleaned.split(".");
  const head = parts[0];
  let expr = isBindingIdentifier(head) ? head : formatMemberAccess(globalVar || "globalThis", head);
  for (let i = 1; i < parts.length; i++) {
    expr = formatMemberAccess(expr, parts[i]);
  }
  return canonicalizeIntrinsicExpr(expr);
}

module.exports = {
  BUILTIN_PROTO_UNSAFE_KEYS,
  STRICT_RESTRICTED_BINDINGS,
  formatMemberAccess,
  formatNumber,
  formatNumberBare,
  formatObjectLiteralKey,
  formatPrimitive,
  isArrayIndexKey,
  isBindingIdentifier,
  isIdentifierName,
  isStrictSafeBinding,
  quoteString,
  resolveIntrinsicExpr,
};
