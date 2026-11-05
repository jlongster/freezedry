"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { capture } = require("../lib/capture");
const { rebuildInFreshContext, evalJson } = require("./helpers/rebuild");

test("captures primitives including special numbers (NaN, -0, +/-Infinity) and BigInt", async () => {
  const src = `
    globalThis.prims = {
      nan: NaN,
      negZero: -0,
      posZero: 0,
      inf: Infinity,
      negInf: -Infinity,
      big: 900719925474099312345n,
      undef: undefined,
      nul: null,
      boolT: true,
      boolF: false,
      str: "hello\\u0000world",
    };
  `;
  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);
  const { ctx } = rebuildInFreshContext(graph);
  const check = evalJson(
    ctx,
    `[
      Number.isNaN(prims.nan),
      Object.is(prims.negZero, -0),
      Object.is(prims.posZero, +0),
      prims.inf === Infinity,
      prims.negInf === -Infinity,
      prims.big === 900719925474099312345n,
      prims.undef === undefined,
      prims.nul === null,
      prims.boolT === true,
      prims.boolF === false,
      prims.str.length === 11,
    ]`
  );
  assert.deepEqual(check, Array(11).fill(true));
});

test("captures arbitrary cycles across objects, arrays, Maps, Sets, and closures", async () => {
  const src = `
    const a = { name: "a" };
    const b = { name: "b", back: a };
    a.next = b;
    a.self = a;

    const arr = [1];
    arr.push(arr);
    arr.extra = a;

    const m = new Map();
    m.set(m, a);
    m.set(a, m);

    const s = new Set();
    s.add(s);
    s.add(b);

    const fnCycle = (function() {
      const box = {};
      function reader() { return box.fn === reader && box.self === box; }
      box.fn = reader;
      box.self = box;
      return box;
    })();

    globalThis.cycles = { a, b, arr, m, s, fnCycle };
  `;
  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);
  const { ctx } = rebuildInFreshContext(graph);
  const checks = evalJson(
    ctx,
    `[
      cycles.a.self === cycles.a,
      cycles.a.next === cycles.b,
      cycles.b.back === cycles.a,
      cycles.arr[1] === cycles.arr,
      cycles.arr.extra === cycles.a,
      cycles.m.get(cycles.m) === cycles.a,
      cycles.m.get(cycles.a) === cycles.m,
      cycles.s.has(cycles.s),
      cycles.s.has(cycles.b),
      cycles.fnCycle.fn(),
    ]`
  );
  assert.deepEqual(checks, Array(10).fill(true));
});

test("captures classes, inheritance, built-in Map subclassing, super methods, and null-proto objects", async () => {
  const src = `
    class Animal {
      constructor(name) { this.name = name; }
      speak() { return this.name + " makes a sound"; }
      static kindLabel() { return "animal"; }
    }
    class Dog extends Animal {
      constructor(name, breed) { super(name); this.breed = breed; }
      speak() { return super.speak() + " (woof)"; }
      static kindLabel() { return super.kindLabel() + ":dog"; }
    }
    class UpperMap extends Map {
      get(k) { return super.get(String(k).toUpperCase()); }
      set(k, v) { return super.set(String(k).toUpperCase(), v); }
    }
    const um = new UpperMap();
    um.set("hello", 42);

    const protoObj = { greet() { return "hi " + this.who; } };
    const subLiteral = {
      __proto__: protoObj,
      who: "world",
      greet() { return super.greet() + "!"; },
    };

    const dict = Object.create(null);
    dict.key = "val";

    globalThis.oop = { Animal, Dog, rex: new Dog("Rex", "Collie"), UpperMap, um, subLiteral, dict };
  `;

  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);
  const { ctx } = rebuildInFreshContext(graph);
  const res = evalJson(
    ctx,
    `({
      isDog: oop.rex instanceof oop.Dog,
      isAnimal: oop.rex instanceof oop.Animal,
      speak: oop.rex.speak(),
      staticLabel: oop.Dog.kindLabel(),
      newDogSpeak: new oop.Dog("Max", "Pug").speak(),
      umGet: oop.um.get("hello"),
      umNew: (() => { const m2 = new oop.UpperMap(); m2.set("abc", 7); return m2.get("abc"); })(),
      subLit: oop.subLiteral.greet(),
      dictNullProto: Object.getPrototypeOf(oop.dict) === null && oop.dict.key === "val",
    })`
  );
  assert.deepEqual(res, {
    isDog: true,
    isAnimal: true,
    speak: "Rex makes a sound (woof)",
    staticLabel: "animal:dog",
    newDogSpeak: "Max makes a sound (woof)",
    umGet: 42,
    umNew: 7,
    subLit: "hi world!",
    dictNullProto: true,
  });
});

test("captures getters/setters, frozen/sealed/non-extensible objects, and sparse arrays", async () => {
  const src = `
    const acc = { _x: 3 };
    Object.defineProperty(acc, "val", {
      get() { return this._x * 10; },
      set(v) { this._x = v; },
      enumerable: true,
      configurable: false,
    });
    const frozenObj = Object.freeze({ a: 1, b: [2, 3] });
    const sealedObj = Object.seal({ s: 10 });
    const nonExtObj = Object.preventExtensions({ p: 20 });
    const sparse = [10, , 30, ,];
    sparse.tag = "sparse-arr";

    globalThis.shapes = { acc, frozenObj, sealedObj, nonExtObj, sparse };
  `;

  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);
  const { ctx } = rebuildInFreshContext(graph);
  const res = evalJson(
    ctx,
    `({
      get1: shapes.acc.val,
      get2: (shapes.acc.val = 8, shapes.acc.val),
      accConfigurable: Object.getOwnPropertyDescriptor(shapes.acc, "val").configurable,
      isFrozen: Object.isFrozen(shapes.frozenObj),
      isSealed: Object.isSealed(shapes.sealedObj) && !Object.isFrozen(shapes.sealedObj),
      isNonExt: !Object.isExtensible(shapes.nonExtObj) && !Object.isSealed(shapes.nonExtObj),
      sparseLen: shapes.sparse.length,
      hasHole1: !(1 in shapes.sparse),
      hasHole3: !(3 in shapes.sparse),
      sparseVals: [shapes.sparse[0], shapes.sparse[2], shapes.sparse.tag],
    })`
  );
  assert.deepEqual(res, {
    get1: 30,
    get2: 80,
    accConfigurable: false,
    isFrozen: true,
    isSealed: true,
    isNonExt: true,
    sparseLen: 4,
    hasHole1: true,
    hasHole3: true,
    sparseVals: [10, 30, "sparse-arr"],
  });
});

test("captures Date, RegExp, TypedArray views sharing ArrayBuffer, DataView, Error, Boxed, and empty WeakMap/WeakSet", async () => {
  const src = `
    const validDate = new Date(1700000000000);
    const invalidDate = new Date(NaN);
    const re = /foo(\\d+)/gi;
    re.lastIndex = 5;

    const full = new Int32Array(8);
    for (let i = 0; i < 8; i++) full[i] = (i + 1) * 100;
    const sub1 = full.subarray(2, 5);
    const sub2 = full.subarray(4, 8);
    const dv = new DataView(full.buffer, 4, 12);
    const bigArr = new BigInt64Array([1n, -2n, 999999999999n]);

    const err = new TypeError("bad type");
    err.code = "E_BAD";

    const boxed = [new Number(-0), new String("hi"), new Boolean(false), Object(7n)];
    const emptyWm = new WeakMap();
    const emptyWs = new WeakSet();

    globalThis.built = {
      validDate, invalidDate, re, full, sub1, sub2, dv, bigArr, err, boxed, emptyWm, emptyWs
    };
  `;

  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);
  const { ctx } = rebuildInFreshContext(graph);
  const res = evalJson(
    ctx,
    `({
      dValid: built.validDate.getTime(),
      dInvalid: Number.isNaN(built.invalidDate.getTime()),
      reSrc: built.re.source,
      reFlags: built.re.flags,
      reLast: built.re.lastIndex,
      sharedBuf1: built.full.buffer === built.sub1.buffer,
      sharedBuf2: built.sub1.buffer === built.sub2.buffer,
      sharedDv: built.dv.buffer === built.full.buffer,
      sub1Vals: [...built.sub1],
      mutationShared: (built.sub1[2] = 9999, built.sub2[0]),
      bigVals: [...built.bigArr].map(String),
      errCheck: built.err instanceof TypeError && built.err.message === "bad type" && built.err.code === "E_BAD",
      boxedTypes: built.boxed.map(x => typeof x),
      boxedNegZero: Object.is(built.boxed[0].valueOf(), -0),
      boxedStr: built.boxed[1].valueOf(),
      boxedBool: built.boxed[2].valueOf(),
      boxedBig: built.boxed[3].valueOf() === 7n,
      wmWorks: (() => { const k = {}; built.emptyWm.set(k, 12); return built.emptyWm.get(k) === 12; })(),
      wsWorks: (() => { const k = {}; built.emptyWs.add(k); return built.emptyWs.has(k); })(),
    })`
  );
  assert.deepEqual(res, {
    dValid: 1700000000000,
    dInvalid: true,
    reSrc: "foo(\\d+)",
    reFlags: "gi",
    reLast: 5,
    sharedBuf1: true,
    sharedBuf2: true,
    sharedDv: true,
    sub1Vals: [300, 400, 500],
    mutationShared: 9999,
    bigVals: ["1", "-2", "999999999999"],
    errCheck: true,
    boxedTypes: ["object", "object", "object", "object"],
    boxedNegZero: true,
    boxedStr: "hi",
    boxedBool: false,
    boxedBig: true,
    wmWorks: true,
    wsWorks: true,
  });
});

test("captures unique, registered, and well-known Symbols across keys, values, Maps, and closures", async () => {
  const src = `
    const uniq = Symbol("secret");
    const emptyUniq = Symbol();
    const reg = Symbol.for("freezedry.test.token");
    const obj = {
      [uniq]: "hidden-val",
      [reg]: "reg-val",
      [Symbol.toStringTag]: "CustomBox",
      keepUniq: uniq,
      keepEmpty: emptyUniq,
      iterRef: Symbol.iterator,
    };
    const m = new Map([[uniq, 77]]);
    const readSecret = (o) => o[uniq] + ":" + m.get(uniq);
    globalThis.syms = { obj, readSecret, reg };
  `;

  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);
  const { ctx } = rebuildInFreshContext(graph);
  const res = evalJson(
    ctx,
    `({
      tag: Object.prototype.toString.call(syms.obj),
      regMatch: syms.reg === Symbol.for("freezedry.test.token") && syms.obj[Symbol.for("freezedry.test.token")] === "reg-val",
      uniqIdentity: syms.obj[syms.obj.keepUniq] === "hidden-val",
      closureRead: syms.readSecret(syms.obj),
      emptyDesc: syms.obj.keepEmpty.description === undefined,
      iterIntrinsic: syms.obj.iterRef === Symbol.iterator,
    })`
  );
  assert.deepEqual(res, {
    tag: "[object CustomBox]",
    regMatch: true,
    uniqIdentity: true,
    closureRead: "hidden-val:77",
    emptyDesc: true,
    iterIntrinsic: true,
  });
});

test("captures settled fulfilled and rejected Promises (including cyclic payload)", async () => {
  const src = `
    const box = { label: "done" };
    box.selfPromise = Promise.resolve(box);
    const rejected = Promise.reject(new RangeError("out of bounds"));
    globalThis.promises = { box, rejected };
  `;

  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);

  const { ctx } = rebuildInFreshContext(graph);
  vm.runInContext(
    `globalThis.out = {};
     promises.box.selfPromise.then(v => { out.sameBox = (v === promises.box); });
     promises.rejected.catch(e => { out.err = e instanceof RangeError && e.message === "out of bounds"; });`,
    ctx
  );
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(evalJson(ctx, "out"), {
    sameBox: true,
    err: true,
  });
});
