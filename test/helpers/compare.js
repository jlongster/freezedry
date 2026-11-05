"use strict";

const assert = require("node:assert/strict");
const util = require("node:util");
const vm = require("node:vm");

const INTRINSIC_EXPRS = [
  "Object",
  "Object.prototype",
  "Function",
  "Function.prototype",
  "Function.prototype.bind",
  "Array",
  "Array.prototype",
  "Array.prototype.push",
  "Array.prototype.slice",
  "Map",
  "Map.prototype",
  "Set",
  "Set.prototype",
  "Date",
  "Date.prototype",
  "RegExp",
  "RegExp.prototype",
  "Promise",
  "Promise.prototype",
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
  "Number",
  "Number.prototype",
  "String",
  "String.prototype",
  "Boolean",
  "Boolean.prototype",
  "BigInt",
  "BigInt.prototype",
  "Symbol",
  "Symbol.prototype",
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
  "Object.getPrototypeOf(function*(){})",
  "Object.getPrototypeOf((function*(){})())",
  "Object.getPrototypeOf(async function(){})",
  "Object.getPrototypeOf(async function*(){})",
  "Object.getPrototypeOf((async function*(){})())",
  "Math",
  "JSON",
  "Reflect",
];

function collectIntrinsics(ctx) {
  const arr = vm.runInContext(
    `[${INTRINSIC_EXPRS.map((e) => `(function(){try{return ${e}}catch(_){return void 0}})()`).join(",")}, globalThis]`,
    ctx
  );
  return arr;
}

function unboxPrimitive(val) {
  if (util.types.isNumberObject(val)) return Number.prototype.valueOf.call(val);
  if (util.types.isStringObject(val)) return String.prototype.valueOf.call(val);
  if (util.types.isBooleanObject(val)) return Boolean.prototype.valueOf.call(val);
  if (util.types.isBigIntObject(val)) return BigInt.prototype.valueOf.call(val);
  if (util.types.isSymbolObject(val)) return Symbol.prototype.valueOf.call(val);
  throw new Error("Unknown boxed primitive");
}

/**
 * Deeply verify structural & heap-isomorphic equality between `ctxExpected` and `ctxActual`
 * starting from `rootKeys` (or all non-baseline own keys of `globalThis`).
 */
async function assertHeapIsomorphic(ctxExpected, ctxActual, opts = {}) {
  const aToB = new Map();
  const bToA = new Map();
  const pendingPromises = [];

  const intrA = collectIntrinsics(ctxExpected);
  const intrB = collectIntrinsics(ctxActual);
  for (let i = 0; i < intrA.length; i++) {
    if (intrA[i] !== undefined && intrB[i] !== undefined) {
      aToB.set(intrA[i], intrB[i]);
      bToA.set(intrB[i], intrA[i]);
    }
  }

  function pairIdentity(a, b, path) {
    if (aToB.has(a)) {
      assert.equal(
        b,
        aToB.get(a),
        `${path}: shared/cyclic identity mismatch (expected already-seen target)`
      );
      return true;
    }
    if (bToA.has(b)) {
      assert.fail(`${path}: distinct source values collapsed onto same target identity`);
    }
    aToB.set(a, b);
    bToA.set(b, a);
    return false;
  }

  function compare(a, b, path) {
    if (a === null || b === null || (typeof a !== "object" && typeof a !== "function" && typeof a !== "symbol")) {
      assert.equal(typeof a, typeof b, `${path}: typeof mismatch`);
      assert.equal(Object.is(a, b), true, `${path}: primitive mismatch (${String(a)} vs ${String(b)})`);
      return;
    }

    assert.equal(typeof a, typeof b, `${path}: typeof mismatch`);

    if (typeof a === "symbol") {
      const kA = Symbol.keyFor(a);
      const kB = Symbol.keyFor(b);
      assert.equal(kA, kB, `${path}: Symbol.keyFor mismatch`);
      if (kA !== undefined) return;
      // Well-known symbols are shared across realms in V8
      if (a === b) return;
      assert.equal(a.description, b.description, `${path}: unique Symbol description mismatch`);
      pairIdentity(a, b, path);
      return;
    }

    if (pairIdentity(a, b, path)) return;

    // Prototype chain
    const protoA = Object.getPrototypeOf(a);
    const protoB = Object.getPrototypeOf(b);
    compare(protoA, protoB, `${path}.[[Prototype]]`);

    // Extensibility / seal / freeze
    assert.equal(
      Object.isExtensible(a),
      Object.isExtensible(b),
      `${path}: Object.isExtensible mismatch`
    );
    assert.equal(Object.isSealed(a), Object.isSealed(b), `${path}: Object.isSealed mismatch`);
    assert.equal(Object.isFrozen(a), Object.isFrozen(b), `${path}: Object.isFrozen mismatch`);

    // Exotic slots
    assert.equal(Array.isArray(a), Array.isArray(b), `${path}: Array.isArray mismatch`);
    if (Array.isArray(a)) {
      assert.equal(a.length, b.length, `${path}: array length mismatch`);
    }

    assert.equal(util.types.isDate(a), util.types.isDate(b), `${path}: isDate mismatch`);
    if (util.types.isDate(a)) {
      assert.equal(
        Object.is(Date.prototype.getTime.call(a), Date.prototype.getTime.call(b)),
        true,
        `${path}: Date time mismatch`
      );
    }

    assert.equal(util.types.isRegExp(a), util.types.isRegExp(b), `${path}: isRegExp mismatch`);
    if (util.types.isRegExp(a)) {
      assert.equal(a.source, b.source, `${path}: RegExp source mismatch`);
      assert.equal(a.flags, b.flags, `${path}: RegExp flags mismatch`);
      assert.equal(
        Object.is(a.lastIndex, b.lastIndex),
        true,
        `${path}: RegExp lastIndex mismatch`
      );
    }

    assert.equal(util.types.isMap(a), util.types.isMap(b), `${path}: isMap mismatch`);
    if (util.types.isMap(a)) {
      const entA = Array.from(Map.prototype.entries.call(a));
      const entB = Array.from(Map.prototype.entries.call(b));
      assert.equal(entA.length, entB.length, `${path}: Map size mismatch`);
      for (let i = 0; i < entA.length; i++) {
        compare(entA[i][0], entB[i][0], `${path}.<MapKey#${i}>`);
        compare(entA[i][1], entB[i][1], `${path}.<MapVal#${i}>`);
      }
    }

    assert.equal(util.types.isSet(a), util.types.isSet(b), `${path}: isSet mismatch`);
    if (util.types.isSet(a)) {
      const valA = Array.from(Set.prototype.values.call(a));
      const valB = Array.from(Set.prototype.values.call(b));
      assert.equal(valA.length, valB.length, `${path}: Set size mismatch`);
      for (let i = 0; i < valA.length; i++) {
        compare(valA[i], valB[i], `${path}.<SetVal#${i}>`);
      }
    }

    assert.equal(
      util.types.isArrayBuffer(a),
      util.types.isArrayBuffer(b),
      `${path}: isArrayBuffer mismatch`
    );
    assert.equal(
      util.types.isSharedArrayBuffer(a),
      util.types.isSharedArrayBuffer(b),
      `${path}: isSharedArrayBuffer mismatch`
    );
    if (util.types.isArrayBuffer(a) || util.types.isSharedArrayBuffer(a)) {
      assert.equal(a.byteLength, b.byteLength, `${path}: buffer byteLength mismatch`);
      const uA = new Uint8Array(a);
      const uB = new Uint8Array(b);
      assert.deepEqual(uA, uB, `${path}: buffer bytes mismatch`);
    }

    assert.equal(
      util.types.isTypedArray(a),
      util.types.isTypedArray(b),
      `${path}: isTypedArray mismatch`
    );
    if (util.types.isTypedArray(a)) {
      assert.equal(
        Object.prototype.toString.call(a),
        Object.prototype.toString.call(b),
        `${path}: TypedArray tag mismatch`
      );
      assert.equal(a.byteOffset, b.byteOffset, `${path}: TypedArray byteOffset mismatch`);
      assert.equal(a.byteLength, b.byteLength, `${path}: TypedArray byteLength mismatch`);
      assert.equal(a.length, b.length, `${path}: TypedArray length mismatch`);
      compare(a.buffer, b.buffer, `${path}.buffer`);
      const uA = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      const uB = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      assert.deepEqual(uA, uB, `${path}: TypedArray bytes mismatch`);
    }

    assert.equal(
      util.types.isDataView(a),
      util.types.isDataView(b),
      `${path}: isDataView mismatch`
    );
    if (util.types.isDataView(a)) {
      assert.equal(a.byteOffset, b.byteOffset, `${path}: DataView byteOffset mismatch`);
      assert.equal(a.byteLength, b.byteLength, `${path}: DataView byteLength mismatch`);
      compare(a.buffer, b.buffer, `${path}.buffer`);
    }

    assert.equal(
      util.types.isBoxedPrimitive(a),
      util.types.isBoxedPrimitive(b),
      `${path}: isBoxedPrimitive mismatch`
    );
    if (util.types.isBoxedPrimitive(a)) {
      compare(unboxPrimitive(a), unboxPrimitive(b), `${path}.[[PrimitiveValue]]`);
    }

    assert.equal(Error.isError(a), Error.isError(b), `${path}: Error.isError mismatch`);

    assert.equal(util.types.isPromise(a), util.types.isPromise(b), `${path}: isPromise mismatch`);
    if (util.types.isPromise(a)) {
      pendingPromises.push({ a, b, path });
    }

    // Own keys & descriptors in EXACT enumeration order!
    const keysA = Reflect.ownKeys(a);
    const keysB = Reflect.ownKeys(b);
    const ignoreErrStack = Error.isError(a) && opts.ignoreErrorStack;
    const isAsyncHookSym = (k) =>
      typeof k === "symbol" &&
      (k.description === "async_id_symbol" ||
        k.description === "trigger_async_id_symbol" ||
        k.description === "destroyed");
    const filterKey = (obj, k) => {
      if (ignoreErrStack && k === "stack") return false;
      if (util.types.isPromise(obj) && isAsyncHookSym(k)) return false;
      return true;
    };
    const filteredA = keysA.filter((k) => filterKey(a, k));
    const filteredB = keysB.filter((k) => filterKey(b, k));

    assert.equal(
      filteredA.length,
      filteredB.length,
      `${path}: ownKeys length mismatch (${filteredA.map(String).join(",")} vs ${filteredB.map(String).join(",")})`
    );

    for (let i = 0; i < filteredA.length; i++) {
      const kA = filteredA[i];
      const kB = filteredB[i];
      compare(kA, kB, `${path}.<OwnKey#${i}>`);
      const dA = Object.getOwnPropertyDescriptor(a, kA);
      const dB = Object.getOwnPropertyDescriptor(b, kB);
      const propPath = `${path}[${String(kA)}]`;
      assert.equal(dA.enumerable, dB.enumerable, `${propPath}: enumerable mismatch`);
      assert.equal(dA.configurable, dB.configurable, `${propPath}: configurable mismatch`);
      assert.equal("writable" in dA, "writable" in dB, `${propPath}: data vs accessor mismatch`);
      if ("writable" in dA) {
        assert.equal(dA.writable, dB.writable, `${propPath}: writable mismatch`);
        compare(dA.value, dB.value, propPath);
      } else {
        compare(dA.get, dB.get, `${propPath}.[[Get]]`);
        compare(dA.set, dB.set, `${propPath}.[[Set]]`);
      }
    }
  }

  // Verify no generated helper names leaked onto globalThis in ctxActual
  const baselineCtx = vm.createContext({});
  const baseKeys = new Set(vm.runInContext("Reflect.ownKeys(globalThis)", baselineCtx));
  const expGlobal = vm.runInContext("globalThis", ctxExpected);
  const actGlobal = vm.runInContext("globalThis", ctxActual);

  const rootKeys =
    opts.rootKeys ||
    Reflect.ownKeys(expGlobal).filter((k) => !baseKeys.has(k));

  const extraActualGlobals = Reflect.ownKeys(actGlobal).filter(
    (k) => !baseKeys.has(k) && !Reflect.ownKeys(expGlobal).some((ek) => ek === k || (typeof ek === "symbol" && typeof k === "symbol" && ek.description === k.description))
  );
  assert.deepEqual(
    extraActualGlobals.map(String),
    [],
    `Emitted script leaked unexpected globals onto globalThis: ${extraActualGlobals.map(String).join(", ")}`
  );

  for (const k of rootKeys) {
    const dExp = Object.getOwnPropertyDescriptor(expGlobal, k);
    let actKey = k;
    if (typeof k === "symbol" && Symbol.keyFor(k) === undefined) {
      actKey = Reflect.ownKeys(actGlobal).find(
        (cand) => typeof cand === "symbol" && Symbol.keyFor(cand) === undefined && cand.description === k.description
      );
      assert.ok(actKey, `Missing unique symbol root ${String(k)} on actual globalThis`);
    }
    const dAct = Object.getOwnPropertyDescriptor(actGlobal, actKey);
    assert.ok(dExp && dAct, `Missing global root descriptor for ${String(k)}`);
    assert.equal(dExp.enumerable, dAct.enumerable, `global[${String(k)}]: enumerable mismatch`);
    assert.equal(
      dExp.configurable,
      dAct.configurable,
      `global[${String(k)}]: configurable mismatch`
    );
    assert.equal("writable" in dExp, "writable" in dAct, `global[${String(k)}]: kind mismatch`);
    if ("writable" in dExp) {
      assert.equal(dExp.writable, dAct.writable, `global[${String(k)}]: writable mismatch`);
      compare(dExp.value, dAct.value, `global[${String(k)}]`);
    } else {
      compare(dExp.get, dAct.get, `global[${String(k)}].[[Get]]`);
      compare(dExp.set, dAct.set, `global[${String(k)}].[[Set]]`);
    }
  }

  for (const { a, b, path } of pendingPromises) {
    const [resA, resB] = await Promise.allSettled([a, b]);
    assert.equal(resA.status, resB.status, `${path}: Promise state mismatch`);
    if (resA.status === "fulfilled") {
      compare(resA.value, resB.value, `${path}.[[PromiseResult]]`);
    } else {
      compare(resA.reason, resB.reason, `${path}.[[PromiseResult]]`);
    }
  }
}

module.exports = {
  assertHeapIsomorphic,
};
