"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { capture } = require("../lib/capture");

async function assertBails(src, expectedSubstring, opts = {}) {
  const graph = await capture(src, opts);
  assert.ok(
    graph.bailouts.length > 0,
    `Expected bailout matching "${expectedSubstring}", got 0 bailouts`
  );
  const reasons = graph.bailouts.map((b) => b.reason).join(" | ");
  assert.match(reasons, new RegExp(expectedSubstring, "i"));
  return graph;
}

test("bails on pending Promise", async () => {
  await assertBails(`globalThis.p = new Promise(() => {});`, "pending promise");
});

test("bails on unhandled background promise rejection during init", async () => {
  await assertBails(
    `Promise.resolve().then(() => { throw new Error("async init boom"); }); globalThis.ok = 1;`,
    "unhandled promise rejection"
  );
});

test("bails on uncaught synchronous init exception", async () => {
  await assertBails(`throw new TypeError("sync failure");`, "uncaught exception during init");
});

test("bails on unstarted, suspended, closed, and async generator objects", async () => {
  await assertBails(
    `function* g() { yield 1; } globalThis.gen = g();`,
    "generator object \\(state: suspended\\)"
  );
  await assertBails(
    `function* g() { yield 1; yield 2; } const it = g(); it.next(); globalThis.gen = it;`,
    "generator object \\(state: suspended\\)"
  );
  await assertBails(
    `function* g() { yield 1; } const it = g(); it.next(); it.next(); globalThis.gen = it;`,
    "generator object \\(state: closed\\)"
  );
  await assertBails(
    `async function* ag() { yield 1; } globalThis.gen = ag();`,
    "generator object"
  );
});

test("bails on Proxy objects, Proxy functions, and revoked Proxies without triggering traps", async () => {
  let trapFired = false;
  await assertBails(
    `
    const p = new Proxy({ a: 1 }, {
      ownKeys() { globalThis.__trapRan = true; throw new Error("trap!"); },
      get() { globalThis.__trapRan = true; throw new Error("trap!"); },
      getPrototypeOf() { globalThis.__trapRan = true; throw new Error("trap!"); },
    });
    globalThis.p = p;
    `,
    "Proxy object",
    {
      afterRun(ctx, _intrinsics, meta) {
        trapFired = Boolean(meta.globalObj.__trapRan);
      },
    }
  );
  assert.equal(trapFired, false);

  await assertBails(
    `globalThis.pf = new Proxy(function() {}, {});`,
    "Proxy function"
  );

  await assertBails(
    `const r = Proxy.revocable({}, {}); r.revoke(); globalThis.rp = r.proxy;`,
    "Proxy object"
  );
});

test("bails on WeakMap/WeakSet with contents, WeakRef, and FinalizationRegistry", async () => {
  await assertBails(
    `const k = {}; const wm = new WeakMap([[k, 42]]); globalThis.hold = { k, wm };`,
    "WeakMap with contents"
  );
  await assertBails(
    `const k = {}; const ws = new WeakSet([k]); globalThis.hold = { k, ws };`,
    "WeakSet with contents"
  );
  await assertBails(
    `const k = {}; globalThis.wr = new WeakRef(k); globalThis.k = k;`,
    "WeakRef"
  );
  await assertBails(
    `const fr = new FinalizationRegistry(() => {}); globalThis.fr = fr;`,
    "FinalizationRegistry"
  );
});

test("bails on sloppy and strict Arguments objects", async () => {
  await assertBails(
    `(function(a, b) { globalThis.args = arguments; })(1, 2);`,
    "Arguments object"
  );
  await assertBails(
    `(function(a) { "use strict"; globalThis.args = arguments; })(1);`,
    "Arguments object"
  );
});

test("bails on Array, Map, Set, String, and RegExp iterator objects", async () => {
  await assertBails(
    `const it = [10, 20, 30].values(); it.next(); globalThis.it = it;`,
    "iterator object"
  );
  await assertBails(
    `const m = new Map([[1, 2]]); globalThis.it = m.entries();`,
    "Map iterator object"
  );
  await assertBails(
    `const s = new Set([1, 2]); globalThis.it = s.values();`,
    "Set iterator object"
  );
  await assertBails(
    `globalThis.it = "abc"[Symbol.iterator]();`,
    "iterator object"
  );
  await assertBails(
    `globalThis.it = (/a/g)[Symbol.matchAll]("aba");`,
    "iterator object"
  );
});

test("bails on live instances, static private members, and detached methods with private fields (#x)", async () => {
  await assertBails(
    `class Secret { static #s = 7; static getS() { return this.#s; } } globalThis.Secret = Secret;`,
    "private"
  );
  await assertBails(
    `class Secret { #x = 7; } globalThis.inst = new Secret();`,
    "private fields"
  );
  await assertBails(
    `class Secret { #m() { return 1; } } globalThis.inst = Object.setPrototypeOf(new Secret(), null);`,
    "private methods"
  );
  await assertBails(
    `function leak() { class Secret { #m() { return 1; } pub() { return this.#m(); } } return Secret.prototype.pub; } globalThis.orphaned = leak();`,
    "private"
  );
});

test("bails on host objects, non-intrinsic native functions, Intl instances, and SharedArrayBuffer", async () => {
  await assertBails(
    `globalThis.leakedFn = injectedHostFn;`,
    "host function|native or host function",
    {
      env: { globals: { injectedHostFn: setTimeout } },
    }
  );
  await assertBails(
    `globalThis.leakedBuf = injectedBuf;`,
    "Buffer|host object",
    {
      env: { globals: { injectedBuf: Buffer.from([1, 2, 3]) } },
    }
  );
  await assertBails(
    `globalThis.nf = new Intl.NumberFormat("en-US");`,
    "Intl\\.NumberFormat"
  );
  await assertBails(
    `globalThis.sab = new SharedArrayBuffer(16);`,
    "SharedArrayBuffer"
  );
});

test("bails on `with` scopes and uninitialized TDZ closure variables", async () => {
  await assertBails(
    `const envObj = { a: 10 }; with (envObj) { globalThis.fn = function() { return a; }; }`,
    "with"
  );
  await assertBails(
    `
    try {
      (function() {
        globalThis.leakedTdz = () => lateVar;
        throw new Error("abort before let init");
        let lateVar = 123;
      })();
    } catch {}
    `,
    "TDZ"
  );
});
