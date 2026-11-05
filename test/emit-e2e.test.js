"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { emit, prepackSources, prepackSourcesAsync, BailoutError } = require("../index");
const { assertHeapIsomorphic } = require("./helpers/compare");

function runInFreshVm(code) {
  const ctx = vm.createContext({});
  new vm.Script(code).runInContext(ctx);
  return ctx;
}

const CAPTURE_PATH = path.join(__dirname, "..", "lib", "capture.js");

describe("lib/emit — advanced corner cases & optimizations", () => {
  it("handles Babel-style self-overwriting FunctionDeclaration (_typeof) without NFE infinite recursion", () => {
    const graph = {
      version: 1,
      roots: [{ kind: "global", key: "checkType", value: { $: "fCaller" } }],
      intrinsicPatches: [],
      nodes: {
        sMod: {
          type: "scope",
          parent: null,
          vars: [{ name: "_typeof", value: { $: "fTypeof" }, kind: "fn" }],
        },
        fTypeof: {
          type: "function",
          kind: "normal",
          source:
            'function _typeof(o) { return _typeof = function(x) { return "fast:" + typeof x; }, _typeof(o); }',
          strict: false,
          name: "_typeof",
          scope: "sMod",
          props: [
            { key: "length", value: { prim: "number", value: 1 }, writable: false, enumerable: false, configurable: true },
            { key: "name", value: { prim: "string", value: "_typeof" }, writable: false, enumerable: false, configurable: true },
          ],
        },
        fCaller: {
          type: "function",
          kind: "arrow",
          source: "(v) => [_typeof.name, _typeof(v), _typeof.name]",
          strict: true,
          name: "",
          scope: "sMod",
        },
      },
    };

    const res = emit(graph);
    assert.equal(res.bailouts.length, 0);
    const ctx = runInFreshVm(res.code);
    const out = Array.from(vm.runInContext("checkType(42)", ctx));
    assert.deepEqual(out, ["_typeof", "fast:number", "_typeof"]);
  });

  it("deduplicates repeated leaf scope factories while keeping per-closure state & const immutability isolated", () => {
    const nodes = {
      sOuter: {
        type: "scope",
        parent: null,
        vars: [{ name: "globalBias", value: { prim: "number", value: 1000 }, kind: "let" }],
      },
      aList: {
        type: "array",
        length: 5,
        props: [],
      },
    };

    for (let i = 0; i < 5; i++) {
      nodes[`sLeaf${i}`] = {
        type: "scope",
        parent: "sOuter",
        vars: [
          { name: "mult", value: { prim: "number", value: i + 2 }, kind: "const" },
          { name: "calls", value: { prim: "number", value: 0 }, kind: "let" },
        ],
      };
      nodes[`fLeaf${i}`] = {
        type: "function",
        kind: "normal",
        source:
          "function adder(x) { calls += 1; if (x === 'mutateConst') mult = 99; return globalBias + x * mult + calls; }",
        strict: true,
        name: "adder",
        scope: `sLeaf${i}`,
      };
      nodes.aList.props.push({
        key: String(i),
        value: { $: `fLeaf${i}` },
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    const res = emit({
      version: 1,
      roots: [{ kind: "global", key: "adders", value: { $: "aList" } }],
      nodes,
    });
    assert.equal(res.bailouts.length, 0);
    // Template body should appear only ONCE, not 5 times!
    const occurrences = res.code.split("x === 'mutateConst'").length - 1;
    assert.equal(occurrences, 1);

    const ctx = runInFreshVm(res.code);
    assert.equal(vm.runInContext("adders[0](10)", ctx), 1021); // 1000 + 10*2 + 1
    assert.equal(vm.runInContext("adders[0](10)", ctx), 1022); // calls=2 on adders[0]
    assert.equal(vm.runInContext("adders[4](10)", ctx), 1061); // calls=1 on adders[4], mult=6
    assert.throws(
      () => vm.runInContext("adders[2]('mutateConst')", ctx),
      /Assignment to constant variable/
    );
  });

  it("emits compact representation for large sparse arrays and preserves function key deletion & reordering", async () => {
    const orig = `
      (function(g) {
        const sparse = new Array(50000);
        sparse[0] = "start";
        sparse[49999] = "end";
        // Wait: 49999 has 0 trailing holes; test 50000 with trailing holes:
        const sparseHoles = new Array(50000);
        sparseHoles[3] = "three";

        function customFn(a, b) { return a + b; }
        delete customFn.name;
        customFn.alpha = 1;
        Object.defineProperty(customFn, "name", { value: "readdedAfterAlpha", writable: false, enumerable: false, configurable: true });

        const wm = new WeakMap();
        const ws = new WeakSet();
        const aggErr = new AggregateError([new RangeError("r1")], "many errors");
        Object.defineProperty(aggErr, "stack", { value: "agg-stack", writable: true, enumerable: false, configurable: true });
        Object.defineProperty(aggErr.errors[0], "stack", { value: "r1-stack", writable: true, enumerable: false, configurable: true });

        g.res = { sparseHoles, customFn, wm, ws, aggErr };
      })(globalThis);
    `;

    const graph = {
      version: 1,
      roots: [{ kind: "global", key: "res", value: { $: "oRes" } }],
      nodes: {
        aSparse: {
          type: "array",
          length: 50000,
          props: [
            { key: "3", value: { prim: "string", value: "three" }, writable: true, enumerable: true, configurable: true },
          ],
        },
        fCustom: {
          type: "function",
          kind: "normal",
          source: "function customFn(a, b) { return a + b; }",
          strict: false,
          name: "readdedAfterAlpha",
          scope: null,
          props: [
            { key: "length", value: { prim: "number", value: 2 }, writable: false, enumerable: false, configurable: true },
            { key: "prototype", value: { $: "oFnProto" }, writable: true, enumerable: false, configurable: false },
            { key: "alpha", value: { prim: "number", value: 1 }, writable: true, enumerable: true, configurable: true },
            { key: "name", value: { prim: "string", value: "readdedAfterAlpha" }, writable: false, enumerable: false, configurable: true },
          ],
        },
        oFnProto: {
          type: "object",
          props: [
            { key: "constructor", value: { $: "fCustom" }, writable: true, enumerable: false, configurable: true },
          ],
        },
        wm: { type: "weakmap", props: [] },
        ws: { type: "weakset", props: [] },
        eRange: {
          type: "error",
          ctor: "RangeError",
          message: "r1",
          props: [
            { key: "stack", value: { prim: "string", value: "r1-stack" }, writable: true, enumerable: false, configurable: true },
            { key: "message", value: { prim: "string", value: "r1" }, writable: true, enumerable: false, configurable: true },
          ],
        },
        aErrs: {
          type: "array",
          length: 1,
          props: [
            { key: "0", value: { $: "eRange" }, writable: true, enumerable: true, configurable: true },
          ],
        },
        eAgg: {
          type: "error",
          ctor: "AggregateError",
          message: "many errors",
          props: [
            { key: "stack", value: { prim: "string", value: "agg-stack" }, writable: true, enumerable: false, configurable: true },
            { key: "errors", value: { $: "aErrs" }, writable: true, enumerable: false, configurable: true },
            { key: "message", value: { prim: "string", value: "many errors" }, writable: true, enumerable: false, configurable: true },
          ],
        },
        oRes: {
          type: "object",
          props: [
            { key: "sparseHoles", value: { $: "aSparse" }, writable: true, enumerable: true, configurable: true },
            { key: "customFn", value: { $: "fCustom" }, writable: true, enumerable: true, configurable: true },
            { key: "wm", value: { $: "wm" }, writable: true, enumerable: true, configurable: true },
            { key: "ws", value: { $: "ws" }, writable: true, enumerable: true, configurable: true },
            { key: "aggErr", value: { $: "eAgg" }, writable: true, enumerable: true, configurable: true },
          ],
        },
      },
    };

    const res = emit(graph);
    assert.equal(res.bailouts.length, 0);
    // 50,000-element sparse array must NOT emit 50,000 commas!
    assert.ok(res.stats.outputBytes < 1200, `Expected compact output, got ${res.stats.outputBytes} bytes`);

    const ctxExp = runInFreshVm(orig);
    const ctxAct = runInFreshVm(res.code);
    await assertHeapIsomorphic(ctxExp, ctxAct);
    assert.deepEqual(Array.from(vm.runInContext("Reflect.ownKeys(res.customFn)", ctxAct)), [
      "length",
      "prototype",
      "alpha",
      "name",
    ]);
  });

  it("supports top-level lexical const/let roots without leaking helper globals", () => {
    const graph = {
      version: 1,
      roots: [
        { kind: "lexical", key: "TOP_CONST", mutable: false, value: { prim: "number", value: 99 } },
        { kind: "lexical", key: "topLet", mutable: true, value: { $: "oData" } },
      ],
      nodes: {
        oData: {
          type: "object",
          props: [{ key: "ok", value: { prim: "boolean", value: true }, writable: true, enumerable: true, configurable: true }],
        },
      },
    };
    const res = emit(graph);
    assert.equal(res.bailouts.length, 0);
    const ctx = runInFreshVm(res.code);
    assert.equal(vm.runInContext("TOP_CONST === 99 && topLet.ok === true", ctx), true);
    assert.equal(vm.runInContext('"TOP_CONST" in globalThis || "topLet" in globalThis', ctx), false);
    assert.throws(
      () => vm.runInContext("TOP_CONST = 1", ctx),
      /Assignment to constant variable/
    );
  });

  it("wires index.js prepackSources errorHandler & fallbackOnBailout contract", () => {
    const seenDiags = [];
    const out = prepackSources("var x = 1;", {
      captureGraph: {
        version: 1,
        roots: [],
        nodes: {},
        bailouts: [{ reason: "Math.random volatile read", where: "input.js:1:9" }],
      },
      errorHandler(d) {
        seenDiags.push(d);
        return "Recover";
      },
    });
    assert.equal(out.code, null);
    assert.equal(seenDiags.length, 1);
    assert.equal(seenDiags[0].errorCode, "FZD_BAILOUT");

    const fb = prepackSources("var x = 42;", {
      captureGraph: {
        version: 1,
        roots: [],
        nodes: {},
        bailouts: [{ reason: "volatile", where: "input.js:1:1" }],
      },
      fallbackOnBailout: true,
    });
    assert.equal(fb.code, "var x = 42;");
    assert.equal(fb.fellBack, true);

    assert.throws(
      () =>
        prepackSources("var x = 1;", {
          captureGraph: {
            version: 1,
            roots: [],
            nodes: {},
            bailouts: [{ reason: "pending promise" }],
          },
          fallbackOnBailout: false,
        }),
      BailoutError
    );
  });
});

describe(
  "index.js — live end-to-end integration with H1 capture",
  { skip: !CAPTURE_PATH && "H1 capture module not present" },
  () => {
    it("captures, emits, and passes full heap isomorphism on adversarial closures, classes, loops, symbols, and collections", async () => {
      const program = `
        (function() {
          const uniq = Symbol("tag");
          const reg = Symbol.for("freezedry.e2e");

          // 1. Shared mutable counter + const object + cycle
          const counterApi = (function() {
            let count = 10;
            const cfg = Object.freeze({ step: 3 });
            const api = {
              inc() { count += cfg.step; return count; },
              peek: () => [count, api.inc === incRef],
            };
            const incRef = api.inc;
            return api;
          })();

          // 2. Per-iteration let loop closures
          const loopFns = [];
          for (let i = 0; i < 3; i++) {
            loopFns.push(
              () => i,
              (next) => { i = next; }
            );
          }
          loopFns[3](99); // mutate iteration 1 before snapshot!

          // 3. Class hierarchy with static members, getters, and super calls
          class Animal {
            static KIND = "fauna";
            constructor(name) { this.name = name; }
            speak() { return this.name + " makes a sound"; }
            get upper() { return this.name.toUpperCase(); }
          }
          class Dog extends Animal {
            static count = 1;
            constructor(name, breed) {
              super(name);
              this.breed = breed;
            }
            speak() { return super.speak() + " (woof)"; }
          }
          const rex = new Dog("Rex", "Husky");

          // 4. Shared ArrayBuffer across multiple TypedArray views + cyclic Map +函数 keys
          const ab = new ArrayBuffer(16);
          const i32 = new Int32Array(ab, 0, 2);
          i32[0] = 0x12345678;
          i32[1] = -42;
          const u8 = new Uint8Array(ab, 4, 8);
          u8[4] = 255;

          const map = new Map();
          const keyObj = { back: map, [uniq]: "secretSymVal", [reg]: 777 };
          map.set(keyObj, rex);
          map.set(Dog, u8);

          // 5. Strict + sloppy mix
          const mix = (function() {
            var n = 1;
            function sloppy() { return [++n, this === globalThis]; }
            const strict = (function() {
              "use strict";
              return function strict() { return [n += 5, this === undefined]; };
            })();
            return { sloppy, strict };
          })();

          globalThis.E2E = {
            counterApi,
            loopFns,
            Animal,
            Dog,
            rex,
            i32,
            u8,
            map,
            keyObj,
            mix,
            settledOk: Promise.resolve("ready"),
          };
        })();
      `;

      const asyncRes = await prepackSourcesAsync(program, {
        _captureModulePath: CAPTURE_PATH,
        env: "ecma",
      });
      assert.equal(typeof asyncRes.code, "string");

      // Also verify synchronous prepackSources entrypoint!
      const syncRes = prepackSources([{ filePath: "e2e.js", fileContents: program }], {
        _captureModulePath: CAPTURE_PATH,
        env: "ecma",
      });
      assert.equal(syncRes.code, asyncRes.code);

      const ctxExp = runInFreshVm(program);
      const ctxAct = runInFreshVm(syncRes.code);
      await assertHeapIsomorphic(ctxExp, ctxAct, { ignoreErrorStack: true });

      // Post-snapshot behavioral checks on the rebuilt heap!
      assert.equal(vm.runInContext("E2E.counterApi.inc()", ctxAct), 13);
      assert.deepEqual(Array.from(vm.runInContext("E2E.counterApi.peek()", ctxAct)), [13, true]);
      assert.equal(vm.runInContext("E2E.loopFns[0]()", ctxAct), 0);
      assert.equal(vm.runInContext("E2E.loopFns[2]()", ctxAct), 99);
      assert.equal(vm.runInContext("E2E.loopFns[4]()", ctxAct), 2);
      vm.runInContext("E2E.loopFns[1](77)", ctxAct);
      assert.equal(vm.runInContext("E2E.loopFns[0]()", ctxAct), 77);
      assert.equal(vm.runInContext("E2E.loopFns[2]()", ctxAct), 99);
      assert.equal(vm.runInContext("E2E.rex.speak()", ctxAct), "Rex makes a sound (woof)");
      assert.equal(vm.runInContext("E2E.rex.upper", ctxAct), "REX");
      assert.equal(vm.runInContext("E2E.i32.buffer === E2E.u8.buffer", ctxAct), true);
      assert.equal(vm.runInContext("E2E.map.get(E2E.keyObj) === E2E.rex", ctxAct), true);
      assert.equal(vm.runInContext("E2E.map.get(E2E.Dog) === E2E.u8", ctxAct), true);
      assert.deepEqual(Array.from(vm.runInContext("(0, E2E.mix.sloppy)()", ctxAct)), [2, true]);
      assert.deepEqual(Array.from(vm.runInContext("(0, E2E.mix.strict)()", ctxAct)), [7, true]);
    });
  }
);
