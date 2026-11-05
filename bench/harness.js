"use strict";

const crypto = require("crypto");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const LAZY_RUNTIME_NAME = "LazyObjectsRuntime";

function sha256(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function makeSandbox() {
  const noop = () => {};
  const sandbox = {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console: {
      log: noop,
      warn: noop,
      error: noop,
      info: noop,
      debug: noop,
    },
  };
  sandbox.global = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

function buildVmRunnerSource(libCode, smokeCode) {
  return (
    "var global = this; var self = this; var window = this; var globalThis = this;\n" +
    libCode +
    "\n;\n(" +
    smokeCode +
    ")(this);"
  );
}

function buildNodeStandaloneScript(libCode, smokeCode, opts = {}) {
  const printDigest = opts.printDigest !== false;
  const expectedJson = opts.expectedJson || null;
  return `globalThis.global = globalThis;
globalThis.self = globalThis;
globalThis.window = globalThis;
(function(exports, module, define) {
${libCode}
}).call(globalThis);
const __out = (${smokeCode})(globalThis);
${expectedJson ? `if (__out !== ${JSON.stringify(expectedJson)}) process.exit(3);` : ""}
${printDigest ? `process.stdout.write(String(__out));` : `if (!__out) process.exit(3);`}
`;
}

function wrapWithLazyObjectsRuntime(code, runtimeName = LAZY_RUNTIME_NAME) {
  const runtimePrelude = `
var ${runtimeName} = {
  _lazyObjectIds: new Map(),
  _callback: null,
  setLazyObjectInitializer: function(callback) { this._callback = callback; },
  createLazyObject: function(id) {
    var obj = {};
    this._lazyObjectIds.set(obj, id);
    return obj;
  },
  hydrateObject: function(obj) {
    var lazyId = this._lazyObjectIds.get(obj);
    if (lazyId === undefined || lazyId === -1) return;
    this._lazyObjectIds.set(obj, -1);
    this._callback(obj, lazyId);
  }
};
var __hydrationHook = {
  get: function(t, p) { ${runtimeName}.hydrateObject(t); return Reflect.get(t, p); },
  set: function(t, p, v, r) { ${runtimeName}.hydrateObject(t); return Reflect.set(t, p, v, r); },
  has: function(t, p) { ${runtimeName}.hydrateObject(t); return Reflect.has(t, p); },
  getOwnPropertyDescriptor: function(t, p) { ${runtimeName}.hydrateObject(t); return Reflect.getOwnPropertyDescriptor(t, p); },
  ownKeys: function(t) { ${runtimeName}.hydrateObject(t); return Reflect.ownKeys(t); },
  defineProperty: function(t, p, d) { ${runtimeName}.hydrateObject(t); return Reflect.defineProperty(t, p, d); },
  isExtensible: function(t) { ${runtimeName}.hydrateObject(t); return Reflect.isExtensible(t); },
  preventExtensions: function(t) { ${runtimeName}.hydrateObject(t); return Reflect.preventExtensions(t); },
  deleteProperty: function(t, p) { ${runtimeName}.hydrateObject(t); return Reflect.deleteProperty(t, p); },
  getPrototypeOf: function(t) { ${runtimeName}.hydrateObject(t); return Reflect.getPrototypeOf(t); },
  setPrototypeOf: function(t, p) { ${runtimeName}.hydrateObject(t); return Reflect.setPrototypeOf(t, p); },
  apply: function(t, thisArg, args) { ${runtimeName}.hydrateObject(t); return Reflect.apply(t, thisArg, args); },
  construct: function(t, args, nt) { ${runtimeName}.hydrateObject(t); return Reflect.construct(t, args, nt); }
};
`;
  const createRe = new RegExp(`(${runtimeName}\\.createLazyObject\\(\\d+\\))`, "g");
  return runtimePrelude + "\n" + code.replace(createRe, "new Proxy($1, __hydrationHook)") + "\n";
}

function runInVm(libCode, smokeCode, timeoutMs = 60000) {
  try {
    const sandbox = makeSandbox();
    const src = buildVmRunnerSource(libCode, smokeCode);
    const out = new vm.Script(src).runInNewContext(sandbox, { timeout: timeoutMs });
    const json = String(out);
    return { ok: true, json, digest: sha256(json) };
  } catch (e) {
    return { ok: false, error: `${e && e.name ? e.name : "Error"}: ${e && e.message ? e.message : String(e)}` };
  }
}

function runInFreshNode(libCode, smokeCode, tmpDir, tag = "check", timeoutMs = 60000) {
  fs.mkdirSync(tmpDir, { recursive: true });
  const scriptFile = path.join(tmpDir, `${tag}-${process.pid}-${Math.random().toString(36).slice(2)}.js`);
  const fullSrc = buildNodeStandaloneScript(libCode, smokeCode, { printDigest: true });
  fs.writeFileSync(scriptFile, fullSrc, "utf8");
  try {
    const r = childProcess.spawnSync(process.execPath, [scriptFile], {
      env: Object.assign({}, process.env, { TZ: "UTC", LANG: "C", LC_ALL: "C" }),
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      encoding: "utf8",
    });
    if (r.error) {
      return { ok: false, error: `spawn error: ${r.error.message}` };
    }
    if (r.status !== 0) {
      const errLine = (r.stderr || "").trim().split("\n").slice(0, 4).join(" | ");
      return { ok: false, error: `exit ${r.status}${r.signal ? ` (${r.signal})` : ""}: ${errLine}` };
    }
    const json = r.stdout;
    return { ok: true, json, digest: sha256(json) };
  } finally {
    try {
      fs.unlinkSync(scriptFile);
    } catch (_e) {}
  }
}

module.exports = {
  LAZY_RUNTIME_NAME,
  sha256,
  makeSandbox,
  buildVmRunnerSource,
  buildNodeStandaloneScript,
  wrapWithLazyObjectsRuntime,
  runInVm,
  runInFreshNode,
};
