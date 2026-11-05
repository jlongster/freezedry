"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { emit, BailoutError } = require("../lib/emit");
const { assertHeapIsomorphic } = require("./helpers/compare");

const FIXTURES_DIR = path.join(__dirname, "fixtures");

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8"));
}

function runInFreshVm(code) {
  const ctx = vm.createContext({});
  new vm.Script(code).runInContext(ctx);
  return ctx;
}

describe("lib/emit — JSON fixtures & heap isomorphism", () => {
  it("01-objects-cycles-protos: rebuilds cycles, null/custom protos, shadowed setters, __proto__ own key, descriptors, freeze/seal", async () => {
    const graph = loadFixture("01-objects-cycles-protos.json");
    const referenceScript = `
      (function(g) {
        const dict = Object.create(null);
        dict.dictKey = "dictVal";
        const baseProto = {};
        Object.defineProperty(baseProto, "inherited", {
          get: Object.getOwnPropertyDescriptor({ get inherited() { return this._v * 2; } }, "inherited").get,
          enumerable: true,
          configurable: true
        });
        Object.defineProperty(baseProto, "shadowedSetter", {
          set: Object.getOwnPropertyDescriptor({ set shadowedSetter(_v) { throw new Error('setter must not be called during emit'); } }, "shadowedSetter").set,
          enumerable: true,
          configurable: true
        });
        const shared = Object.freeze({ tag: "SHARED" });
        const sealed = Object.seal({ mut: 10 });
        const leaf = { big: 9007199254740993n, inf: -Infinity };
        const root = {};
        const child = {
          __proto__: baseProto,
          zFirst: 1,
          _v: 21,
          shadowedSetter: "safeOwnData",
          ["__proto__"]: "ownProtoProp",
          backToRoot: root,
          aLast: -0,
        };
        Object.defineProperty(child, "hidden", { value: NaN, enumerable: false, writable: false, configurable: true });
        root.self = root;
        root.child = child;
        root.dict = dict;
        root.s1 = shared;
        root.s2 = shared;
        root.sealed = sealed;
        root.leaf = leaf;
        root.pushRef = Array.prototype.push;
        root.globalRef = g;
        Object.defineProperty(g, "app", { value: root, writable: true, enumerable: true, configurable: false });
      })(globalThis);
    `;

    const res = emit(graph, { originalCode: referenceScript });
    assert.equal(res.bailouts.length, 0);
    assert.equal(typeof res.code, "string");
    // Must not use Object.setPrototypeOf on normal prototype chains!
    assert.equal(res.code.includes("setPrototypeOf"), false);

    const ctxExp = runInFreshVm(referenceScript);
    const ctxAct = runInFreshVm(res.code);
    await assertHeapIsomorphic(ctxExp, ctxAct);

    // Behavioral checks on rebuilt state
    assert.equal(vm.runInContext("app.self === app", ctxAct), true);
    assert.equal(vm.runInContext("app.child.backToRoot === app", ctxAct), true);
    assert.equal(vm.runInContext("app.s1 === app.s2 && Object.isFrozen(app.s1)", ctxAct), true);
    assert.equal(vm.runInContext("app.child.inherited", ctxAct), 42);
    assert.equal(vm.runInContext("app.child.shadowedSetter", ctxAct), "safeOwnData");
    assert.equal(
      vm.runInContext('Object.getOwnPropertyDescriptor(app.child, "__proto__").value', ctxAct),
      "ownProtoProp"
    );
    assert.deepEqual(Array.from(vm.runInContext("Object.keys(app.child)", ctxAct)), [
      "zFirst",
      "_v",
      "shadowedSetter",
      "__proto__",
      "backToRoot",
      "aLast",
    ]);
  });

  it("02-collections-builtins: arrays with holes & frozen arrays, cyclic Map/Set, shared ArrayBuffer views, boxed, Error, Promise, Symbol, bind, intrinsicPatches", async () => {
    const graph = loadFixture("02-collections-builtins.json");
    const referenceScript = `
      (function(g) {
        const symUniq = Symbol("myUnique");
        const symReg = Symbol.for("shared.reg");
        const holes = ["first", , undefined, 99, ,];
        holes.extra = true;
        holes[symUniq] = "onArray";
        const frozenArr = Object.freeze([10, 20, 30]);
        function keyFn(x) { "use strict"; return x + 1; }
        const bound = keyFn.bind(null, 41);
        const map = new Map();
        const cycKey = { mapRef: map };
        map.set(cycKey, "cyclicKeyVal").set(keyFn, "fnKeyVal").set(map, "selfMapKey");
        const set = new Set();
        set.add(symUniq).add(symReg).add(set);
        const dValid = new Date(1700000000000);
        const dInvalid = new Date(NaN);
        const re = /ab+c/gi;
        re.lastIndex = 7;
        const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
        const i32 = new Int32Array(buf, 0, 2);
        const u8 = new Uint8Array(buf, 4, 4);
        const dv = new DataView(buf, 2, 4);
        const err = new TypeError("bad input");
        Object.defineProperty(err, "stack", {
          value: "TypeError: bad input\\n    at init:1:1",
          writable: true,
          enumerable: false,
          configurable: true
        });
        err.code = "ERR_BAD";
        const pOk = Promise.resolve(123);
        const pFail = Promise.reject(err);
        pFail.catch(function(){});
        const bag = {
          holes,
          frozenArr,
          map,
          cycKey,
          fnKey: keyFn,
          bound,
          set,
          dValid,
          dInvalid,
          re,
          i32,
          u8,
          dv,
          xNegZero: new Number(-0),
          xStr: new String("ok"),
          xBig: Object(77n),
          xSym: Object(symUniq),
          err,
          pOk,
          pFail,
          [symUniq]: "onBag"
        };
        Object.defineProperty(bag, Symbol.toStringTag, {
          value: "freezedryBag",
          writable: false,
          enumerable: false,
          configurable: true
        });
        Object.defineProperty(Array.prototype, "__freezedryTestPatch", {
          value: "patched!",
          writable: true,
          enumerable: false,
          configurable: true
        });
        g.bag = bag;
      })(globalThis);
    `;

    const res = emit(graph, { originalCode: referenceScript });
    assert.equal(res.bailouts.length, 0);

    const ctxExp = runInFreshVm(referenceScript);
    const ctxAct = runInFreshVm(res.code);
    await assertHeapIsomorphic(ctxExp, ctxAct);

    // Behavioral assertions:
    // 1. Holes vs undefined in array
    assert.equal(vm.runInContext("0 in bag.holes && !(1 in bag.holes) && (2 in bag.holes) && !(4 in bag.holes)", ctxAct), true);
    assert.equal(vm.runInContext("bag.holes.length === 5 && bag.holes[2] === undefined", ctxAct), true);
    // 2. Shared ArrayBuffer across Int32Array, Uint8Array, and DataView!
    assert.equal(
      vm.runInContext("bag.i32.buffer === bag.u8.buffer && bag.u8.buffer === bag.dv.buffer", ctxAct),
      true
    );
    assert.equal(
      vm.runInContext("bag.u8[0] = 99; new Uint8Array(bag.i32.buffer)[4] === 99", ctxAct),
      true
    );
    // 3. Bound function works
    assert.equal(vm.runInContext("bag.bound()", ctxAct), 42);
    // 4. Cyclic Map key & function as Map key
    assert.equal(vm.runInContext("bag.map.get(bag.cycKey)", ctxAct), "cyclicKeyVal");
    assert.equal(vm.runInContext("bag.map.get(bag.fnKey)", ctxAct), "fnKeyVal");
    assert.equal(vm.runInContext("bag.map.get(bag.map)", ctxAct), "selfMapKey");
    // 5. Shared unique symbol across object, array, Set, and boxed Symbol!
    assert.equal(
      vm.runInContext(
        "const s = Object.getOwnPropertySymbols(bag)[0]; bag[s] === 'onBag' && bag.holes[s] === 'onArray' && bag.set.has(s) && bag.xSym.valueOf() === s",
        ctxAct
      ),
      true
    );
    // 6. Intrinsic patch applied
    assert.equal(vm.runInContext("[].__freezedryTestPatch", ctxAct), "patched!");
  });

  it("02-collections-builtins: rejected Promise does NOT trigger UnhandledPromiseRejection in fresh Node process", () => {
    const graph = loadFixture("02-collections-builtins.json");
    const { code } = emit(graph);
    const proc = childProcess.spawnSync(
      process.execPath,
      [
        "-e",
        `${code}\nsetTimeout(() => { globalThis.bag.pFail.then(() => process.exit(2), e => { if (e.message !== "bad input") process.exit(3); }); }, 10);`,
      ],
      { encoding: "utf8" }
    );
    assert.equal(proc.status, 0, `Child exited ${proc.status}: ${proc.stderr}`);
  });

  it("03-closures-scopes: shared mutable scopes, const immutability, per-iteration let loop scopes, strict+sloppy mix, lexical this, gen/async/method", async () => {
    const graph = loadFixture("03-closures-scopes.json");
    const res = emit(graph);
    assert.equal(res.bailouts.length, 0);
    const ctx = runInFreshVm(res.code);

    const evalJson = (expr) => JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, ctx));

    // 1. Shared counter mutated by `inc` and read by `get` (plus cyclic `holder` reference!)
    assert.deepEqual(evalJson("closures.get()"), {
      count: 5,
      sameHolder: true,
    });
    assert.equal(vm.runInContext("closures.inc(3)", ctx), 80);
    assert.deepEqual(evalJson("closures.get()"), {
      count: 8,
      sameHolder: true,
    });

    // 2. `const` immutability preserved: mutating `secret` throws TypeError!
    assert.throws(
      () => vm.runInContext("closures.tryMutateConst()", ctx),
      /Assignment to constant variable/
    );

    // 3. Per-iteration `let` loop scopes: mutating iteration 0's `i` does NOT affect iteration 1 or 2, while `sharedTotal` IS shared!
    assert.deepEqual(evalJson("closures.loops[0]()"), [0, 100]);
    assert.deepEqual(evalJson("closures.loops[2]()"), [1, 100]);
    assert.deepEqual(evalJson("closures.loops[3]()"), [2, 100]);
    assert.equal(vm.runInContext("closures.loops[1](50)", ctx), 50);
    assert.deepEqual(evalJson("closures.loops[0]()"), [50, 150]);
    assert.deepEqual(evalJson("closures.loops[2]()"), [1, 150]);
    assert.deepEqual(evalJson("closures.loops[3]()"), [2, 150]);

    // 4. Strict + sloppy mix sharing `var sharedVal`!
    assert.deepEqual(evalJson("(0, closures.sloppy)()"), [8, true]);
    assert.deepEqual(evalJson("(0, closures.strict)()"), [18, true]);
    assert.deepEqual(evalJson("(0, closures.sloppy)()"), [19, true]);

    // 5. Arrow with reproduced lexical `this`
    assert.equal(vm.runInContext("closures.arrowThis()", ctx), "boundLexicalThis!");

    // 6. Generator, Async function, and Concise Method with custom name & custom own property
    assert.deepEqual(evalJson("[...closures.gen(10)]"), [10, 11]);
    const asyncOut = await vm.runInContext("closures.asyncFn(21)", ctx);
    assert.equal(asyncOut, 42);
    assert.equal(vm.runInContext("closures.method('world')", ctx), "hello world");
    assert.equal(vm.runInContext("closures.method.name", ctx), "customGreetName");
    assert.equal(vm.runInContext("closures.method.tag", ctx), "taggedFn");
    assert.throws(() => vm.runInContext("new closures.method()", ctx), {
      name: "TypeError",
      message: /is not a constructor/,
    });
  });

  it("04-classes-inheritance: class extends unscoped BaseParam, super.method(), static members, prototype & method identity without duplicate creation", () => {
    const graph = loadFixture("04-classes-inheritance.json");
    const res = emit(graph);
    assert.equal(res.bailouts.length, 0);
    assert.equal(res.code.includes("setPrototypeOf"), false);

    const ctx = runInFreshVm(res.code);

    // Prebuilt instance has exact prototype chain & methods
    assert.equal(
      vm.runInContext("classes.prebuilt instanceof classes.Rect && classes.prebuilt instanceof classes.Shape", ctx),
      true
    );
    assert.equal(vm.runInContext("classes.prebuilt.describe()", ctx), "Shape:rect[6x7]");
    assert.equal(vm.runInContext("classes.prebuilt.area", ctx), 42);

    // Method identity mapped directly from class prototype onto graph node!
    assert.equal(
      vm.runInContext("classes.sharedDescribeRef === classes.Rect.prototype.describe", ctx),
      true
    );

    // Static field initializer `sideEffectInit()` was NOT re-executed; captured value preserved!
    assert.equal(vm.runInContext("classes.Rect.VERSION", ctx), "v2.0-captured");

    // Constructing new instances after rebuild mutates shared closure scope `createdCount` via `super()`!
    assert.equal(vm.runInContext("classes.Shape.totalCreated()", ctx), 1);
    assert.equal(vm.runInContext("classes.Rect.unit().describe()", ctx), "Shape:rect[1x1]");
    assert.equal(vm.runInContext("classes.Shape.totalCreated()", ctx), 2);
  });

  it("05-bailout-pending-promise: returns code: null with bailout reason when graph has bailouts", () => {
    const graph = loadFixture("05-bailout-pending-promise.json");
    const res = emit(graph);
    assert.equal(res.code, null);
    assert.equal(res.bailouts.length, 1);
    assert.match(res.bailouts[0].reason, /pending promise/);
    assert.throws(() => emit(graph, { throwOnBailout: true }), BailoutError);
  });
});

describe("lib/emit — adversarial & bailout edge cases", () => {
  it("avoids generated prefix collisions when user code uses __h$ and __h1$", () => {
    const graph = {
      version: 1,
      roots: [{ kind: "global", key: "fn", value: { $: "f1" } }],
      intrinsicPatches: [],
      nodes: {
        s1: {
          type: "scope",
          parent: null,
          vars: [{ name: "__h$", value: { prim: "number", value: 10 }, kind: "let" }],
        },
        f1: {
          type: "function",
          kind: "normal",
          source: "function test(__h1$) { return __h$ + __h1$; }",
          strict: true,
          name: "test",
          scope: "s1",
        },
      },
    };
    const res = emit(graph);
    assert.equal(res.bailouts.length, 0);
    assert.ok(res.code.includes("__h2$"));
    const ctx = runInFreshVm(res.code);
    assert.equal(vm.runInContext("fn(32)", ctx), 42);
  });

  it("produces deterministic output across repeated calls", () => {
    const graph = loadFixture("02-collections-builtins.json");
    const r1 = emit(graph);
    const r2 = emit(graph);
    assert.equal(r1.code, r2.code);
  });

  it("handles computed symbol concise methods and regular function prototype identity", () => {
    const graph = {
      version: 1,
      roots: [{ kind: "global", key: "out", value: { $: "oRoot" } }],
      intrinsicPatches: [],
      nodes: {
        sym: { type: "symbol", description: "iter", registered: null },
        s1: {
          type: "scope",
          parent: null,
          vars: [{ name: "sym", value: { symbol: "sym" }, kind: "const" }],
        },
        fComp: {
          type: "function",
          kind: "method",
          source: "[sym](x) { return x * 3; }",
          strict: true,
          name: "[iter]",
          scope: "s1",
        },
        fCtor: {
          type: "function",
          kind: "normal",
          source: "function Widget(id) { this.id = id; }",
          strict: true,
          name: "Widget",
          scope: null,
          props: [
            { key: "length", value: { prim: "number", value: 1 }, writable: false, enumerable: false, configurable: true },
            { key: "name", value: { prim: "string", value: "Widget" }, writable: false, enumerable: false, configurable: true },
            { key: "prototype", value: { $: "oWidgetProto" }, writable: true, enumerable: false, configurable: false },
          ],
        },
        oWidgetProto: {
          type: "object",
          proto: { intrinsic: "Object.prototype" },
          props: [
            { key: "constructor", value: { $: "fCtor" }, writable: true, enumerable: false, configurable: true },
            { key: { symbol: "sym" }, value: { $: "fComp" }, writable: true, enumerable: true, configurable: true },
          ],
        },
        oInst: {
          type: "object",
          proto: { $: "oWidgetProto" },
          props: [{ key: "id", value: { prim: "number", value: 7 }, writable: true, enumerable: true, configurable: true }],
        },
        oRoot: {
          type: "object",
          props: [
            { key: "Widget", value: { $: "fCtor" }, writable: true, enumerable: true, configurable: true },
            { key: "inst", value: { $: "oInst" }, writable: true, enumerable: true, configurable: true },
            { key: "sym", value: { symbol: "sym" }, writable: true, enumerable: true, configurable: true },
          ],
        },
      },
    };
    const res = emit(graph);
    assert.equal(res.bailouts.length, 0);
    const ctx = runInFreshVm(res.code);
    assert.equal(vm.runInContext("out.inst instanceof out.Widget", ctx), true);
    assert.equal(vm.runInContext("out.inst[out.sym](9)", ctx), 27);
  });

  it("bails cleanly on direct eval, with, unbound arrow this/arguments, standalone super, and private-field instances", () => {
    const cases = [
      {
        label: "direct eval",
        node: { type: "function", kind: "normal", source: "function f(x) { return eval(x); }", strict: false },
        match: /direct eval/,
      },
      {
        label: "with statement",
        node: { type: "function", kind: "normal", source: "function f(o) { with (o) { return a; } }", strict: false },
        match: /with statement/,
      },
      {
        label: "arrow capturing this without value",
        node: { type: "function", kind: "arrow", source: "(x) => this.y + x", strict: true },
        match: /captures this/,
      },
      {
        label: "arrow capturing arguments",
        node: { type: "function", kind: "arrow", source: "() => arguments[0]", strict: false },
        match: /captures arguments/,
      },
      {
        label: "standalone method using super",
        node: { type: "function", kind: "method", source: "m() { return super.foo(); }", strict: true },
        match: /super/,
      },
    ];

    for (const c of cases) {
      const res = emit({
        version: 1,
        roots: [{ kind: "global", key: "bad", value: { $: "f1" } }],
        nodes: { f1: c.node },
      });
      assert.equal(res.code, null, `Expected bailout for ${c.label}`);
      assert.match(res.bailouts[0].reason, c.match);
    }

    // Class with #private field: allowed when 0 instances exist, bails when an instance exists!
    const okClassOnly = emit({
      version: 1,
      roots: [{ kind: "global", key: "Box", value: { $: "cBox" } }],
      nodes: {
        cBox: {
          type: "function",
          kind: "class",
          source: "class Box { #v = 10; get() { return this.#v; } }",
          strict: true,
          props: [
            { key: "length", value: { prim: "number", value: 0 }, writable: false, enumerable: false, configurable: true },
            { key: "name", value: { prim: "string", value: "Box" }, writable: false, enumerable: false, configurable: true },
            { key: "prototype", value: { $: "oBoxProto" }, writable: false, enumerable: false, configurable: false },
          ],
        },
        oBoxProto: { type: "object" },
      },
    });
    assert.equal(okClassOnly.bailouts.length, 0);
    const ctxBox = runInFreshVm(okClassOnly.code);
    assert.equal(vm.runInContext("new Box().get()", ctxBox), 10);

    const bailInstance = emit({
      version: 1,
      roots: [{ kind: "global", key: "inst", value: { $: "oInst" } }],
      nodes: {
        cBox: {
          type: "function",
          kind: "class",
          source: "class Box { #v = 10; get() { return this.#v; } }",
          strict: true,
          props: [
            { key: "prototype", value: { $: "oBoxProto" }, writable: false, enumerable: false, configurable: false },
          ],
        },
        oBoxProto: {
          type: "object",
          props: [{ key: "constructor", value: { $: "cBox" }, writable: true, enumerable: false, configurable: true }],
        },
        oInst: { type: "object", proto: { $: "oBoxProto" }, props: [] },
      },
    });
    assert.equal(bailInstance.code, null);
    assert.match(bailInstance.bailouts[0].reason, /private members/);
  });

  it("does NOT falsely bail when eval or with appears in strings, comments, properties, or shadowed params", () => {
    const graph = {
      version: 1,
      roots: [{ kind: "global", key: "safe", value: { $: "fSafe" } }],
      nodes: {
        fSafe: {
          type: "function",
          kind: "normal",
          source: `function safe(eval, obj) {
            // with (x) eval("nope")
            const msg = "with (a) eval(b)";
            return eval(2) + (obj ? obj.eval(3) : 0) + msg.length;
          }`,
          strict: false,
          name: "safe",
          scope: null,
        },
      },
    };
    const res = emit(graph);
    assert.equal(res.bailouts.length, 0);
    const ctx = runInFreshVm(res.code);
    assert.equal(vm.runInContext("safe(x => x * 10, { eval: y => y + 1 })", ctx), 20 + 4 + 16);
  });
});
