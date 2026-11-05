"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { run } = require("../lib/run");
const { capture } = require("../lib/capture");
const { rebuildInFreshContext, evalJson } = require("./helpers/rebuild");

test("run defaults to pure ECMAScript + globalThis environment", async () => {
  const src = `
    globalThis.checks = {
      thisIsGlobalThis: this === globalThis,
      hasArray: typeof Array === "function",
      hasGlobal: typeof global,
      hasSelf: typeof self,
      hasWindow: typeof window,
      hasConsole: typeof console,
      hasWasm: typeof WebAssembly,
    };
  `;
  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);
  const { ctx } = rebuildInFreshContext(graph);
  const checks = evalJson(ctx, "checks");
  assert.deepEqual(checks, {
    thisIsGlobalThis: true,
    hasArray: true,
    hasGlobal: "undefined",
    hasSelf: "undefined",
    hasWindow: "undefined",
    hasConsole: "undefined",
    hasWasm: "undefined",
  });
});

test("run supports configurable target environments (browser, worker, node, universal, custom)", async () => {
  const probeSrc = `
    globalThis.envReport = {
      g: typeof global !== "undefined" && global === globalThis,
      s: typeof self !== "undefined" && self === globalThis,
      w: typeof window !== "undefined" && window === globalThis,
      refSelf: typeof self !== "undefined" ? self : null,
    };
  `;

  const browserGraph = await capture(probeSrc, { env: "browser" });
  assert.equal(browserGraph.bailouts.length, 0);
  // Pre-configured window/self aliases should NOT show up as mutated roots
  assert.deepEqual(
    browserGraph.roots.map((r) => r.key),
    ["envReport"]
  );
  const browserRebuilt = rebuildInFreshContext(browserGraph, { env: "browser" });
  assert.deepEqual(evalJson(browserRebuilt.ctx, "[envReport.g, envReport.s, envReport.w, envReport.refSelf === window]"), [
    false,
    true,
    true,
    true,
  ]);

  const nodeGraph = await capture(probeSrc, { env: "node" });
  const nodeRebuilt = rebuildInFreshContext(nodeGraph, { env: "node" });
  assert.deepEqual(evalJson(nodeRebuilt.ctx, "[envReport.g, envReport.s, envReport.w]"), [true, false, false]);

  const workerGraph = await capture(probeSrc, { env: "worker" });
  const workerRebuilt = rebuildInFreshContext(workerGraph, { env: "worker" });
  assert.deepEqual(evalJson(workerRebuilt.ctx, "[envReport.g, envReport.s, envReport.w]"), [false, true, false]);

  const universalGraph = await capture(probeSrc, { env: "universal" });
  const universalRebuilt = rebuildInFreshContext(universalGraph, { env: "universal" });
  assert.deepEqual(evalJson(universalRebuilt.ctx, "[envReport.g, envReport.s, envReport.w]"), [true, true, true]);
});

test("beforeRun hook enables Track H3 environment & volatile API tracing cleanly", async () => {
  const envReads = [];
  const src = `
    var hasModule = typeof module;
    var hasDoc;
    try { document; hasDoc = "yes"; } catch (e) { hasDoc = e.name; }
    globalThis.result = { hasModule, hasDoc, r: Math.random(), ok: this === globalThis };
  `;

  const graph = await capture(src, {
    beforeRun(ctx, intrinsicsMap, meta) {
      assert.equal(intrinsicsMap.get(meta.globalObj.Array.prototype.push), "Array.prototype.push");

      // 1. Install prototype proxy on globalObj to observe missing global lookups without breaking globalThis!
      const origProto = Object.getPrototypeOf(meta.globalObj);
      const trap = new Proxy(origProto, {
        has(t, k) {
          if (Reflect.has(t, k)) return true;
          envReads.push(String(k));
          meta.addAssumption({ kind: "typeof", expr: `typeof ${String(k)}`, observed: "undefined" });
          return false;
        },
      });
      Object.setPrototypeOf(meta.globalObj, trap);

      // 2. Deterministic Math.random wrapper during run, restored before capture
      const origRandom = meta.globalObj.Math.random;
      meta.globalObj.Math.random = () => 0.25;

      return () => {
        Object.setPrototypeOf(meta.globalObj, origProto);
        meta.globalObj.Math.random = origRandom;
      };
    },
  });

  assert.equal(graph.bailouts.length, 0);
  // Restored wrappers must not appear as intrinsicPatches!
  assert.equal(graph.intrinsicPatches.length, 0);
  assert.deepEqual(envReads, ["module", "document"]);
  assert.equal(graph.assumptions.length, 2);
  assert.deepEqual(graph.assumptions[0], {
    kind: "typeof",
    expr: "typeof module",
    observed: "undefined",
  });

  const { ctx } = rebuildInFreshContext(graph);
  assert.deepEqual(evalJson(ctx, "result"), {
    hasModule: "undefined",
    hasDoc: "ReferenceError",
    r: 0.25,
    ok: true,
  });
});

test("run drains microtasks chained after synchronous script init", async () => {
  const src = `
    globalThis.log = ["sync-start"];
    Promise.resolve("m1")
      .then((v) => {
        globalThis.log.push(v);
        return Promise.resolve("m2");
      })
      .then((v) => {
        globalThis.log.push(v);
        globalThis.ready = true;
      });
    globalThis.log.push("sync-end");
  `;
  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);
  const { ctx } = rebuildInFreshContext(graph);
  assert.deepEqual(evalJson(ctx, "[ready, log]"), [
    true,
    ["sync-start", "sync-end", "m1", "m2"],
  ]);
});

test("captures intrinsicPatches (polyfills) and root property descriptors", async () => {
  const src = `
    if (!Array.prototype.first) {
      Object.defineProperty(Array.prototype, "first", {
        value: function first() { return this[0]; },
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
    Object.defineProperty(globalThis, "READONLY_ROOT", {
      value: 99,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  `;
  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);
  assert.equal(graph.intrinsicPatches.length, 1);
  assert.equal(graph.intrinsicPatches[0].path, "Array.prototype");
  assert.equal(graph.intrinsicPatches[0].key, "first");

  const { ctx } = rebuildInFreshContext(graph);
  const res = evalJson(
    ctx,
    `({
      firstVal: [10, 20].first(),
      enumFirst: Object.prototype.propertyIsEnumerable.call(Array.prototype, "first"),
      rootDesc: Object.getOwnPropertyDescriptor(globalThis, "READONLY_ROOT"),
    })`
  );
  assert.equal(res.firstVal, 10);
  assert.equal(res.enumFirst, false);
  assert.deepEqual(res.rootDesc, {
    value: 99,
    writable: false,
    enumerable: false,
    configurable: false,
  });
});

test("run accepts multi-file source arrays", async () => {
  const sources = [
    { filePath: "part1.js", fileContents: "globalThis.base = 20;" },
    { filePath: "part2.js", fileContents: "globalThis.doubled = globalThis.base * 2;" },
  ];
  const res = await run(sources);
  assert.equal(res.error, null);
  assert.equal(res.globalObj.doubled, 40);
});
