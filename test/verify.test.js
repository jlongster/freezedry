"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { verify } = require("../lib/verify");

describe("verify() — equivalent scripts (must pass)", () => {
  it("passes precomputed arithmetic and lookup tables vs materialized literals", () => {
    const orig = `
      (function() {
        function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
        var table = [];
        for (var i = 0; i < 8; i++) table.push(fib(i));
        globalThis.fib8 = table;
        globalThis.label = ["pre", "pack"].join("-").toUpperCase();
      })();
    `;
    const out = `
      globalThis.fib8 = [0, 1, 1, 2, 3, 5, 8, 13];
      globalThis.label = "PRE-PACK";
    `;
    const res = verify(orig, out);
    assert.equal(res.ok, true, `unexpected diff: ${res.firstDiff}`);
    assert.equal(res.firstDiff, null);
    assert.ok(res.stats.rootsCompared >= 2);
  });

  it("passes shared DAG nodes and cyclic object graphs", () => {
    const orig = `
      (function() {
        const leaf = { v: 42 };
        const a = { name: "a", leaf };
        const b = { name: "b", leaf, prev: a };
        a.next = b;
        a.self = a;
        globalThis.graph = { a, b };
      })();
    `;
    const out = `
      (function() {
        var $leaf = { v: 42 };
        var $a = { name: "a", leaf: $leaf, next: null, self: null };
        var $b = { name: "b", leaf: $leaf, prev: $a };
        $a.next = $b;
        $a.self = $a;
        globalThis.graph = { a: $a, b: $b };
      })();
    `;
    const res = verify(orig, out);
    assert.equal(res.ok, true, `unexpected diff: ${res.firstDiff}`);
  });

  it("passes custom prototypes, null-proto objects, and ES6 class inheritance", () => {
    const orig = `
      (function() {
        const dict = Object.create(null);
        dict.k = "v";
        class Base {
          baseMethod() { return 1; }
        }
        class Sub extends Base {
          subMethod() { return 2; }
        }
        globalThis.dict = dict;
        globalThis.Sub = Sub;
        globalThis.inst = new Sub();
      })();
    `;
    const out = `
      (function() {
        const d = Object.create(null);
        d.k = "v";
        class Base {
          baseMethod() { return 1; }
        }
        class Sub extends Base {
          subMethod() { return 2; }
        }
        globalThis.dict = d;
        globalThis.Sub = Sub;
        globalThis.inst = Object.create(Sub.prototype);
      })();
    `;
    const res = verify(orig, out);
    assert.equal(res.ok, true, `unexpected diff: ${res.firstDiff}`);
  });

  it("passes descriptors (non-enumerable, readonly, getters/setters) and freeze/seal/preventExtensions", () => {
    const orig = `
      (function() {
        function getter() { return this._x * 2; }
        function setter(v) { this._x = v; }
        const o = {};
        Object.defineProperty(o, "_x", { value: 21, writable: true, enumerable: false, configurable: false });
        Object.defineProperty(o, "x", { get: getter, set: setter, enumerable: true, configurable: true });
        globalThis.acc = o;
        globalThis.frozen = Object.freeze({ a: 1, b: 2 });
        globalThis.sealed = Object.seal({ c: 3 });
        globalThis.nonExt = Object.preventExtensions({ d: 4 });
      })();
    `;
    const out = `
      (function() {
        const g = function getter() { return this._x * 2; };
        const s = function setter(v) { this._x = v; };
        const o = Object.defineProperties({}, {
          _x: { value: 21, writable: true, enumerable: false, configurable: false },
          x: { get: g, set: s, enumerable: true, configurable: true },
        });
        globalThis.acc = o;
        globalThis.frozen = Object.freeze({ a: 1, b: 2 });
        globalThis.sealed = Object.seal({ c: 3 });
        globalThis.nonExt = Object.preventExtensions({ d: 4 });
      })();
    `;
    const res = verify(orig, out);
    assert.equal(res.ok, true, `unexpected diff: ${res.firstDiff}`);
  });

  it("passes SameValue primitives (-0, +0, NaN, Infinity, BigInt) and all 3 symbol kinds", () => {
    const orig = `
      (function() {
        const uSym = Symbol("custom");
        const emptySym = Symbol("");
        const bareSym = Symbol();
        const rSym = Symbol.for("hybrid.shared");
        globalThis.prims = [-0, 0, NaN, Infinity, -Infinity, 9007199254740993n, undefined, null];
        globalThis.syms = {
          u1: uSym,
          u2: uSym,
          emptySym,
          bareSym,
          rSym,
          iter: Symbol.iterator,
          [uSym]: "secret-val",
          [rSym]: "reg-val",
        };
      })();
    `;
    const out = `
      (function() {
        const s1 = Symbol("custom");
        const s2 = Symbol("");
        const s3 = Symbol();
        const sr = Symbol.for("hybrid.shared");
        globalThis.prims = [-0, +0, 0 / 0, 1 / 0, -1 / 0, BigInt("9007199254740993"), void 0, null];
        globalThis.syms = {
          u1: s1,
          u2: s1,
          emptySym: s2,
          bareSym: s3,
          rSym: sr,
          iter: Symbol.iterator,
          [s1]: "secret-val",
          [sr]: "reg-val",
        };
      })();
    `;
    const res = verify(orig, out);
    assert.equal(res.ok, true, `unexpected diff: ${res.firstDiff}`);
  });

  it("passes Map, Set, Date, RegExp, sparse Arrays, TypedArrays with shared ArrayBuffer, Boxed, Errors, settled Promises, and bound functions", () => {
    const orig = `
      (function() {
        const keyObj = { id: 1 };
        const m = new Map([[keyObj, -0], ["second", NaN]]);
        const s = new Set(["first", keyObj, 42]);
        const sparse = [, -0, undefined, , "end"];
        const dValid = new Date(1700000000000);
        const dInvalid = new Date(NaN);
        const re = /foo(bar)+/gi;
        re.lastIndex = 7;

        const full = new Int32Array([10, 20, 30, 40]);
        const sub = full.subarray(1, 3);
        const dv = new DataView(full.buffer, 4, 8);
        const floats = new Float64Array([-0, 0, NaN, 3.5]);

        const boxed = [new Number(-0), new Number(NaN), new String("ok"), new Boolean(false), Object(7n)];
        const pFul = Promise.resolve({ done: true });
        const pRej = Promise.reject("bad");
        pRej.catch(function() {});

        function add(a, b) { return this.base + a + b; }
        const bound = add.bind({ base: 100 }, 5);

        globalThis.exotics = { keyObj, m, s, sparse, dValid, dInvalid, re, full, sub, dv, floats, boxed, pFul, pRej, bound };
      })();
    `;
    const out = `
      (function() {
        const k = { id: 1 };
        const m = new Map();
        m.set(k, -0);
        m.set("second", NaN);
        const s = new Set(["first", k, 42]);
        const sparse = new Array(5);
        sparse[1] = -0;
        sparse[2] = undefined;
        sparse[4] = "end";
        const dValid = new Date(1700000000000);
        const dInvalid = new Date(NaN);
        const re = new RegExp("foo(bar)+", "gi");
        re.lastIndex = 7;

        const ab = new ArrayBuffer(16);
        const full = new Int32Array(ab);
        full.set([10, 20, 30, 40]);
        const sub = new Int32Array(ab, 4, 2);
        const dv = new DataView(ab, 4, 8);
        const floats = Float64Array.of(-0, 0, NaN, 3.5);

        const boxed = [new Number(-0), new Number(NaN), new String("ok"), new Boolean(false), Object(7n)];
        const pFul = Promise.resolve({ done: true });
        const pRej = Promise.reject("bad");
        pRej.catch(function() {});

        function add(a, b) { return this.base + a + b; }
        const bound = add.bind({ base: 100 }, 5);

        globalThis.exotics = { keyObj: k, m, s, sparse, dValid, dInvalid, re, full, sub, dv, floats, boxed, pFul, pRej, bound };
      })();
    `;
    const res = verify(orig, out);
    assert.equal(res.ok, true, `unexpected diff: ${res.firstDiff}`);
  });

  it("passes closures with shared scopes, top-level Script scope rebuilt as IIFE scope, and eliminated init helpers", () => {
    const orig = `
      const INIT_ONLY = [1, 2, 3, 4];
      let sharedCount = INIT_ONLY.reduce((a, b) => a + b, 0);
      const meta = { tag: "counter" };
      globalThis.counter = {
        inc() { return ++sharedCount; },
        dec() { return --sharedCount; },
        info: () => meta.tag + ":" + sharedCount,
      };
      globalThis.pure = function(x) { return x * 2; };
    `;
    const out = `
      (function() {
        let sharedCount = 10;
        const meta = { tag: "counter" };
        globalThis.counter = {
          inc() { return ++sharedCount; },
          dec() { return --sharedCount; },
          info: () => meta.tag + ":" + sharedCount,
        };
      })();
      globalThis.pure = function(x) { return x * 2; };
    `;
    const res = verify(orig, out);
    assert.equal(res.ok, true, `unexpected diff: ${res.firstDiff}`);
    assert.ok(res.stats.scopesCompared >= 2);
  });

  it("passes intrinsic polyfill patches when identical in original and output", () => {
    const orig = `
      if (!Array.prototype.__hybridTestFirst) {
        Object.defineProperty(Array.prototype, "__hybridTestFirst", {
          value: function first() { return this[0]; },
          writable: true,
          enumerable: false,
          configurable: true,
        });
      }
    `;
    const out = `
      Object.defineProperty(Array.prototype, "__hybridTestFirst", {
        value: function first() { return this[0]; },
        writable: true,
        enumerable: false,
        configurable: true,
      });
    `;
    const res = verify(orig, out);
    assert.equal(res.ok, true, `unexpected diff: ${res.firstDiff}`);
    assert.equal(res.stats.intrinsicPatchesCompared, 1);
  });
});

describe("verify() — subtly different scripts (must fail with pinpoint path)", () => {
  it("fails on different own property order on objects and on globalThis", () => {
    const resObj = verify(`globalThis.cfg = { alpha: 1, beta: 2 };`, `globalThis.cfg = { beta: 2, alpha: 1 };`);
    assert.equal(resObj.ok, false);
    assert.equal(resObj.firstDiff.kind, "property-order");
    assert.equal(resObj.firstDiff.path, "cfg");

    const resGlob = verify(
      `globalThis.first = 1; globalThis.second = 2;`,
      `globalThis.second = 2; globalThis.first = 1;`
    );
    assert.equal(resGlob.ok, false);
    assert.equal(resGlob.firstDiff.kind, "property-order");
    assert.equal(resGlob.firstDiff.path, "<globalThis>");
  });

  it("fails on lost closure scope sharing even when initial variable values are identical", () => {
    const orig = `
      globalThis.counter = (function() {
        let count = 0;
        return {
          inc: function inc() { return ++count; },
          get: function get() { return count; },
        };
      })();
    `;
    const out = `
      globalThis.counter = {
        inc: (function() { let count = 0; return function inc() { return ++count; }; })(),
        get: (function() { let count = 0; return function get() { return count; }; })(),
      };
    `;
    const res = verify(orig, out);
    assert.equal(res.ok, false);
    assert.equal(res.firstDiff.kind, "scope-sharing");
    assert.equal(res.firstDiff.path, 'counter.get (scope var "count")');
  });

  it("fails on spurious closure scope merging when two independent closures accidentally share a scope", () => {
    const orig = `
      (function() {
        function make() { let count = 0; return function inc() { return ++count; }; }
        globalThis.c1 = make();
        globalThis.c2 = make();
      })();
    `;
    const out = `
      (function() {
        let count = 0;
        globalThis.c1 = function inc() { return ++count; };
        globalThis.c2 = function inc() { return ++count; };
      })();
    `;
    const res = verify(orig, out);
    assert.equal(res.ok, false);
    assert.equal(res.firstDiff.kind, "scope-sharing");
    assert.equal(res.firstDiff.path, 'c2 (scope var "count")');
  });

  it("fails on different prototype (null vs Object.prototype and custom prototype mismatch)", () => {
    const resNull = verify(
      `globalThis.map = Object.assign(Object.create(null), { a: 1 });`,
      `globalThis.map = { a: 1 };`
    );
    assert.equal(resNull.ok, false);
    assert.equal(resNull.firstDiff.kind, "prototype");
    assert.equal(resNull.firstDiff.path, "map.[[Prototype]]");

    const resCustom = verify(`const p = { tag: "v1" }; globalThis.item = Object.create(p);`, `globalThis.item = {};`);
    assert.equal(resCustom.ok, false);
    assert.equal(resCustom.firstDiff.kind, "prototype");
    assert.equal(resCustom.firstDiff.path, "item.[[Prototype]]");
  });

  it("fails on frozen vs non-frozen, sealed vs non-sealed, and extensible vs non-extensible", () => {
    const resFrozen = verify(`globalThis.cfg = Object.freeze({ mode: "prod" });`, `globalThis.cfg = { mode: "prod" };`);
    assert.equal(resFrozen.ok, false);
    assert.equal(resFrozen.firstDiff.kind, "integrity");
    assert.equal(resFrozen.firstDiff.path, "cfg");
    assert.match(resFrozen.firstDiff.message, /frozen/);

    const resSealed = verify(`globalThis.cfg = Object.seal({ mode: "prod" });`, `globalThis.cfg = { mode: "prod" };`);
    assert.equal(resSealed.ok, false);
    assert.equal(resSealed.firstDiff.kind, "integrity");

    const resExt = verify(
      `globalThis.cfg = Object.preventExtensions({ mode: "prod" });`,
      `globalThis.cfg = { mode: "prod" };`
    );
    assert.equal(resExt.ok, false);
    assert.equal(resExt.firstDiff.kind, "integrity");
  });

  it("fails on -0 vs +0 in properties, closure variables, boxed Numbers, and TypedArrays", () => {
    const resProp = verify(`globalThis.v = { z: -0 };`, `globalThis.v = { z: 0 };`);
    assert.equal(resProp.ok, false);
    assert.equal(resProp.firstDiff.kind, "primitive-value");
    assert.equal(resProp.firstDiff.path, "v.z");
    assert.equal(resProp.firstDiff.expected, "-0");
    assert.equal(resProp.firstDiff.actual, "0");

    const resScope = verify(
      `globalThis.sign = (() => { const z = -0; return () => 1 / z; })();`,
      `globalThis.sign = (() => { const z = 0; return () => 1 / z; })();`
    );
    assert.equal(resScope.ok, false);
    assert.equal(resScope.firstDiff.path, 'sign (scope var "z")');

    const resBoxed = verify(`globalThis.n = new Number(-0);`, `globalThis.n = new Number(0);`);
    assert.equal(resBoxed.ok, false);
    assert.equal(resBoxed.firstDiff.kind, "boxed-primitive");

    const resTa = verify(`globalThis.ta = new Float64Array([-0]);`, `globalThis.ta = new Float64Array([0]);`);
    assert.equal(resTa.ok, false);
    assert.equal(resTa.firstDiff.kind, "typedarray-element");
    assert.equal(resTa.firstDiff.path, "ta[0]");
  });

  it("fails on different Map entry order and Set entry order", () => {
    const resMap = verify(
      `globalThis.m = new Map([["a", 1], ["b", 2]]);`,
      `globalThis.m = new Map([["b", 2], ["a", 1]]);`
    );
    assert.equal(resMap.ok, false);
    assert.equal(resMap.firstDiff.path, "m (Map key #0)");

    const resSet = verify(
      `globalThis.s = new Set(["first", "second"]);`,
      `globalThis.s = new Set(["second", "first"]);`
    );
    assert.equal(resSet.ok, false);
    assert.equal(resSet.firstDiff.path, "s (Set entry #0)");
  });

  it("fails on getter vs data property without invoking throwing getters, and on descriptor attributes", () => {
    const resAcc = verify(
      `globalThis.obj = { get x() { throw new Error("must not be invoked by verifier"); } };`,
      `globalThis.obj = { x: 42 };`
    );
    assert.equal(resAcc.ok, false);
    assert.equal(resAcc.firstDiff.kind, "descriptor-kind");
    assert.equal(resAcc.firstDiff.path, "obj.x");

    const resEnum = verify(
      `globalThis.obj = Object.defineProperty({}, "secret", { value: 1, enumerable: false, writable: true, configurable: true });`,
      `globalThis.obj = { secret: 1 };`
    );
    assert.equal(resEnum.ok, false);
    assert.equal(resEnum.firstDiff.kind, "descriptor-attrs");
    assert.equal(resEnum.firstDiff.path, "obj.secret");
  });

  it("fails when function source is identical but a closure variable differs, reporting full path", () => {
    const orig = `
      globalThis._ = (function() {
        const root = globalThis;
        function lodash(v) { return root === globalThis ? v : null; }
        lodash.templateSettings = { imports: { _: lodash } };
        return lodash;
      })();
    `;
    const out = `
      globalThis._ = (function() {
        const root = { fakeGlobal: true };
        function lodash(v) { return root === globalThis ? v : null; }
        lodash.templateSettings = { imports: { _: lodash } };
        return lodash;
      })();
    `;
    const res = verify(orig, out);
    assert.equal(res.ok, false);
    assert.match(res.firstDiff.path, /\(scope var "root"\)$/);

    // Also test nested path when root._ itself matches and _.templateSettings.imports._ is a separate wrapper
    const origNested = `
      globalThis._ = {
        templateSettings: {
          imports: {
            _: (function() { const root = { scale: 10 }; return function helper(n) { return n * root.scale; }; })()
          }
        }
      };
    `;
    const outNested = `
      globalThis._ = {
        templateSettings: {
          imports: {
            _: (function() { const root = { scale: 99 }; return function helper(n) { return n * root.scale; }; })()
          }
        }
      };
    `;
    const resNested = verify(origNested, outNested);
    assert.equal(resNested.ok, false);
    assert.equal(resNested.firstDiff.path, '_.templateSettings.imports._ (scope var "root").scale');
  });

  it("fails when function source text is identical but strictness differs (normal and arrow)", () => {
    const resNormal = verify(
      `"use strict"; globalThis.fn = function check() { return this; };`,
      `globalThis.fn = function check() { return this; };`
    );
    assert.equal(resNormal.ok, false);
    assert.equal(resNormal.firstDiff.kind, "function-strictness");
    assert.equal(resNormal.firstDiff.path, "fn");

    const resArrow = verify(`"use strict"; globalThis.arr = () => 1;`, `globalThis.arr = () => 1;`);
    assert.equal(resArrow.ok, false);
    assert.equal(resArrow.firstDiff.kind, "function-strictness");
    assert.equal(resArrow.firstDiff.path, "arr");
  });

  it("fails on lost DAG object identity, sparse holes vs undefined, shared ArrayBuffer loss, fake Promises, and leaked intrinsic patches", () => {
    const resDag = verify(
      `const shared = { x: 1 }; globalThis.pair = { a: shared, b: shared };`,
      `globalThis.pair = { a: { x: 1 }, b: { x: 1 } };`
    );
    assert.equal(resDag.ok, false);
    assert.equal(resDag.firstDiff.kind, "object-identity");
    assert.equal(resDag.firstDiff.path, "pair.b");

    const resSparse = verify(`globalThis.arr = [, 1];`, `globalThis.arr = [undefined, 1];`);
    assert.equal(resSparse.ok, false);

    const resSubarray = verify(
      `const ab = new ArrayBuffer(8); globalThis.views = { a: new Int32Array(ab, 0, 2), b: new Uint8Array(ab, 0, 8) };`,
      `globalThis.views = { a: new Int32Array(new ArrayBuffer(8), 0, 2), b: new Uint8Array(new ArrayBuffer(8), 0, 8) };`
    );
    assert.equal(resSubarray.ok, false);
    assert.equal(resSubarray.firstDiff.kind, "object-identity");
    assert.equal(resSubarray.firstDiff.path, "views.b.buffer");

    const resFakePromise = verify(
      `globalThis.p = Promise.resolve(42);`,
      `globalThis.p = { then(fn) { return fn(42); } };`
    );
    assert.equal(resFakePromise.ok, false);
    assert.equal(resFakePromise.firstDiff.kind, "object-kind");
    assert.equal(resFakePromise.firstDiff.path, "p");

    const resLeak = verify(`globalThis.val = 1;`, `Object.prototype.__tempHelper = true; globalThis.val = 1;`);
    assert.equal(resLeak.ok, false);
    assert.equal(resLeak.firstDiff.path, "Object.prototype.__tempHelper");
  });
});
