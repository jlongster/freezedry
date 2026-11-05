"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { capture } = require("../lib/capture");
const { rebuildInFreshContext, evalJson } = require("./helpers/rebuild");

test("captures shared scope between multiple closures and counters mutated during init", async () => {
  const src = `
    (function(initial) {
      let count = initial;
      const step = 2;
      function inc() { count += step; return count; }
      function dec() { count -= 1; return count; }
      const peek = () => count;
      // Mutate counter during init before capture
      inc();
      inc();
      inc();
      globalThis.counter = { inc, dec, peek };
    })(10);
  `;

  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);

  // Verify inc, dec, and peek point to the EXACT SAME scope node ID in graph.nodes
  const counterRoot = graph.roots.find((r) => r.key === "counter");
  const counterNode = graph.nodes[counterRoot.value.$];
  const fnIds = counterNode.props.map((p) => p.value.$);
  assert.equal(fnIds.length, 3);
  const scopeIds = fnIds.map((id) => graph.nodes[id].scope);
  assert.ok(scopeIds[0], "expected non-null scope id");
  assert.equal(scopeIds[0], scopeIds[1]);
  assert.equal(scopeIds[1], scopeIds[2]);

  const scopeNode = graph.nodes[scopeIds[0]];
  assert.equal(scopeNode.type, "scope");
  assert.equal(scopeNode.parent, null);
  const countVar = scopeNode.vars.find((v) => v.name === "count");
  const stepVar = scopeNode.vars.find((v) => v.name === "step");
  assert.deepEqual(countVar, { name: "count", value: { prim: "number", value: 16 }, kind: "let" });
  assert.deepEqual(stepVar, { name: "step", value: { prim: "number", value: 2 }, kind: "const" });

  // Verify rebuilt runtime state shares live mutable bindings across inc, dec, peek
  const { ctx } = rebuildInFreshContext(graph);
  const out = evalJson(
    ctx,
    `[counter.peek(), counter.inc(), counter.dec(), counter.dec(), counter.peek()]`
  );
  assert.deepEqual(out, [16, 18, 17, 16, 16]);
});

test("distinct factory invocations get distinct scope nodes", async () => {
  const src = `
    function makeAdder(n) {
      let acc = n;
      return function add(x) { acc += x; return acc; };
    }
    globalThis.a1 = makeAdder(10);
    globalThis.a2 = makeAdder(100);
    globalThis.a1(5);
  `;
  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);

  const f1 = graph.nodes[graph.roots.find((r) => r.key === "a1").value.$];
  const f2 = graph.nodes[graph.roots.find((r) => r.key === "a2").value.$];
  assert.notEqual(f1.scope, f2.scope);

  const { ctx } = rebuildInFreshContext(graph);
  assert.deepEqual(evalJson(ctx, "[a1(1), a2(1), a1(4)]"), [16, 101, 20]);
});

test("captures nested function, block, catch, and script lexical scopes with parent links", async () => {
  const src = `
    let scriptBias = 1000;
    (function outer(paramVal) {
      var fnVar = 100;
      {
        const blockFactor = 2;
        try {
          throw 7;
        } catch (caughtVal) {
          globalThis.compute = function compute(x) {
            return scriptBias + paramVal + fnVar + blockFactor * x + caughtVal;
          };
          globalThis.bumpBias = () => { scriptBias += 500; };
        }
      }
    })(20);
  `;

  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);

  const computeFn = graph.nodes[graph.roots.find((r) => r.key === "compute").value.$];
  const chain = [];
  let cur = computeFn.scope;
  while (cur) {
    chain.push(graph.nodes[cur]);
    cur = graph.nodes[cur].parent;
  }
  // Expect 4 nested scope levels: catch -> block -> outer function -> script
  assert.equal(chain.length, 4);
  assert.deepEqual(
    chain.map((s) => s.vars.map((v) => `${v.name}:${v.kind}`)),
    [["caughtVal:let"], ["blockFactor:const"], ["paramVal:param", "fnVar:var"], ["scriptBias:let"]]
  );

  const { ctx } = rebuildInFreshContext(graph);
  assert.deepEqual(evalJson(ctx, "[compute(3), (bumpBias(), compute(3))]"), [1133, 1633]);
});

test("captures shadowed variables with identical names across nested closures", async () => {
  const src = `
    globalThis.pair = (function(x) {
      var readOuter = function() { return x; };
      var readBoth = (function(x) {
        return function() { return x * 10 + readOuter(); };
      })(4);
      return { readOuter, readBoth };
    })(9);
  `;

  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);
  const { ctx } = rebuildInFreshContext(graph);
  assert.deepEqual(evalJson(ctx, "[pair.readOuter(), pair.readBoth()]"), [9, 49]);
});

test("captures named FunctionExpression self-reference hidden from [[Scopes]]", async () => {
  const src = `
    globalThis.thunk = (function fact(n) {
      if (n <= 1) return 1;
      return n <= 0 ? 1 : function() { return fact(n - 1) * n; };
    })(5);
    globalThis.recFact = (function fact(n) {
      return n <= 1 ? 1 : n * fact(n - 1);
    });
    globalThis.wrappedFact = (function selfRef(n) {
      return n <= 1 ? 1 : (() => n * selfRef(n - 1))();
    });
  `;

  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);
  const { ctx } = rebuildInFreshContext(graph);
  assert.deepEqual(evalJson(ctx, "[recFact(5), wrappedFact(6)]"), [120, 720]);
});

test("captures self-overwriting strict FunctionDeclaration helpers (Babel _typeof pattern)", async () => {
  const src = `
    "use strict";
    (function() {
      function lazyHelper(x) {
        lazyHelper = function(y) { return y * 10; };
        return lazyHelper(x);
      }
      globalThis.callHelper = function(v) { return lazyHelper(v); };
    })();
  `;

  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);
  const { ctx } = rebuildInFreshContext(graph);
  assert.deepEqual(evalJson(ctx, "[callHelper(3), callHelper(7)]"), [30, 70]);
});

test("captures all function kinds, strictness, dynamic Function(), custom props, and bound functions", async () => {
  const src = `
    function sloppyFn(a, b) { return typeof this; }
    function strictFn(a) { "use strict"; return typeof this; }
    strictFn.customTag = "meta";
    Object.defineProperty(strictFn, "length", { value: 9, configurable: true });

    const obj = {
      arrow: (x) => x + 1,
      method(x) { "use strict"; return x * 2; },
      *gen(x) { yield x; yield x + 1; },
      async afn(x) { return x + 10; },
      async *agen(x) { yield x * 3; },
      get prop() { return this._v; },
      set prop(v) { this._v = v * 2; },
      _v: 5,
    };

    const dyn = new Function("a", "b", "'use strict'; return a + b;");
    const ctxObj = { base: 100 };
    function sumWithBase(a, b, c) { return this.base + a + b + c; }
    const boundOnce = sumWithBase.bind(ctxObj, 10);
    const boundTwice = boundOnce.bind({ base: 999 }, 20);

    globalThis.suite = { sloppyFn, strictFn, obj, dyn, boundTwice, ctxObj };
  `;

  const graph = await capture(src);
  assert.equal(graph.bailouts.length, 0);

  const fnNodes = Object.values(graph.nodes).filter((n) => n.type === "function");
  const byName = new Map(fnNodes.map((f) => [f.name, f]));
  assert.equal(byName.get("sloppyFn").strict, false);
  assert.equal(byName.get("sloppyFn").kind, "normal");
  assert.equal(byName.get("strictFn").strict, true);
  assert.equal(byName.get("arrow").kind, "arrow");
  assert.equal(byName.get("method").kind, "method");
  assert.equal(byName.get("method").strict, true);
  assert.equal(byName.get("gen").kind, "generator");
  assert.equal(byName.get("afn").kind, "async");
  assert.equal(byName.get("agen").kind, "asyncGenerator");
  assert.equal(byName.get("get prop").kind, "getter");
  assert.equal(byName.get("set prop").kind, "setter");
  assert.ok(byName.get("bound bound sumWithBase").bound !== null);

  const { ctx } = rebuildInFreshContext(graph);
  const syncRes = evalJson(
    ctx,
    `({
      sloppyThis: suite.sloppyFn.call(undefined),
      strictThis: suite.strictFn.call(undefined),
      strictTag: suite.strictFn.customTag,
      strictLen: suite.strictFn.length,
      arrow: suite.obj.arrow(4),
      method: suite.obj.method(6),
      gen: [...suite.obj.gen(7)],
      get1: suite.obj.prop,
      get2: (suite.obj.prop = 9, suite.obj.prop),
      dyn: suite.dyn(8, 9),
      bound1: suite.boundTwice(30),
      boundAfterMutate: (suite.ctxObj.base = 200, suite.boundTwice(30)),
    })`
  );
  assert.deepEqual(syncRes, {
    sloppyThis: "object",
    strictThis: "undefined",
    strictTag: "meta",
    strictLen: 9,
    arrow: 5,
    method: 12,
    gen: [7, 8],
    get1: 5,
    get2: 18,
    dyn: 17,
    bound1: 160,
    boundAfterMutate: 260,
  });

  // Also check async and asyncGenerator functions in rebuilt context
  vm.runInContext(
    `suite.afnOut = null; suite.agenOut = [];
     suite.obj.afn(5).then(v => { suite.afnOut = v; });
     (async () => { for await (const item of suite.obj.agen(4)) suite.agenOut.push(item); })();`,
    ctx
  );
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(evalJson(ctx, "[suite.afnOut, suite.agenOut]"), [15, [12]]);
});
