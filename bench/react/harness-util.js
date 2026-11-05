"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { generateRequest, getTrainingCorpus } = require("./data");

// React is loaded lazily (only when an implementation touches opts.React etc.), so cold-start
// measurements of implementations that do not need React at runtime do not pay for loading it.
const REACT_BENCH_DIR = __dirname;
const reactDeps = () => require("./react-deps");

const APP_JS_PATH = path.join(REACT_BENCH_DIR, "app", "app.js");
const APP_JSX_PATH = path.join(REACT_BENCH_DIR, "app", "app.jsx");

function resolveImplPath(spec) {
  if (!spec) {
    throw new Error("Missing --impl <module> argument");
  }
  const candidates = [
    path.resolve(process.cwd(), spec),
    path.resolve(process.cwd(), spec + ".js"),
    path.resolve(REACT_BENCH_DIR, spec),
    path.resolve(REACT_BENCH_DIR, spec + ".js"),
    path.resolve(REACT_BENCH_DIR, "impl", spec),
    path.resolve(REACT_BENCH_DIR, "impl", spec + ".js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return c;
    }
  }
  return require.resolve(spec, { paths: [process.cwd(), REACT_BENCH_DIR] });
}

function loadImpl(spec) {
  const implPath = resolveImplPath(spec);
  const mod = require(implPath);
  const impl = mod && mod.default ? mod.default : mod;
  if (!impl || typeof impl.prepare !== "function") {
    throw new Error(
      `Implementation module "${implPath}" must export { name, prepare(appSource, opts) -> renderFn(data) -> string }`
    );
  }
  return {
    name: impl.name || path.basename(implPath, ".js"),
    prepare: impl.prepare.bind(impl),
    implPath,
    rawModule: impl,
  };
}

function makePrepareOpts(extra = {}) {
  const opts = {
    appPath: APP_JS_PATH,
    jsxPath: APP_JSX_PATH,
    reactBenchDir: REACT_BENCH_DIR,
    rootProp: "data",
    generateSampleInput: generateRequest,
    trainingInputs: getTrainingCorpus,
  };
  const lazy = {
    reactNodeModules: () => reactDeps().reactNodeModules,
    require: () => reactDeps().reactRequire,
    React: () => reactDeps().React,
    ReactDOMServer: () => reactDeps().ReactDOMServer,
  };
  for (const key of Object.keys(lazy)) {
    Object.defineProperty(opts, key, { enumerable: true, configurable: true, get: lazy[key] });
  }
  for (const key of Object.keys(extra)) {
    Object.defineProperty(opts, key, { enumerable: true, configurable: true, writable: true, value: extra[key] });
  }
  return opts;
}

function unwrapPrepared(prepared) {
  if (typeof prepared === "function") {
    const explicitCode =
      typeof prepared.code === "string"
        ? prepared.code
        : typeof prepared.generatedCode === "string"
        ? prepared.generatedCode
        : null;
    return {
      renderFn: prepared,
      code: explicitCode !== null ? explicitCode : Function.prototype.toString.call(prepared),
      codeSource: explicitCode !== null ? "explicit" : "fn.toString()",
      stats: prepared.stats || null,
    };
  }
  if (prepared && typeof prepared.render === "function") {
    const explicitCode =
      typeof prepared.code === "string"
        ? prepared.code
        : typeof prepared.generatedCode === "string"
        ? prepared.generatedCode
        : typeof prepared.render.code === "string"
        ? prepared.render.code
        : null;
    return {
      renderFn: prepared.render,
      code:
        explicitCode !== null
          ? explicitCode
          : Function.prototype.toString.call(prepared.render),
      codeSource: explicitCode !== null ? "explicit" : "fn.toString()",
      stats: prepared.stats || prepared.render.stats || null,
    };
  }
  throw new Error(
    "prepare(appSource, opts) must return a renderFn(data) -> string (or { render, code })"
  );
}

function measureCodeSize(code) {
  const buf = Buffer.from(code || "", "utf8");
  const gzipBuf = zlib.gzipSync(buf, { level: 9 });
  let lines = 1;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 10) lines++;
  }
  return {
    bytes: buf.length,
    kb: Math.round((buf.length / 1024) * 100) / 100,
    gzipBytes: gzipBuf.length,
    gzipKb: Math.round((gzipBuf.length / 1024) * 100) / 100,
    lines: buf.length === 0 ? 0 : lines,
  };
}

function formatFirstDiff(expected, actual, contextRadius = 80) {
  const minLen = Math.min(expected.length, actual.length);
  let pos = 0;
  while (pos < minLen && expected.charCodeAt(pos) === actual.charCodeAt(pos)) {
    pos++;
  }
  const start = Math.max(0, pos - contextRadius);
  const expEnd = Math.min(expected.length, pos + contextRadius);
  const actEnd = Math.min(actual.length, pos + contextRadius);

  const prefix = start > 0 ? "..." : "";
  const expSuffix = expEnd < expected.length ? "..." : "";
  const actSuffix = actEnd < actual.length ? "..." : "";

  const expBefore = expected.slice(start, pos);
  const expAfter = expected.slice(pos, expEnd);
  const actBefore = actual.slice(start, pos);
  const actAfter = actual.slice(pos, actEnd);

  return {
    offset: pos,
    expectedLength: expected.length,
    actualLength: actual.length,
    expectedChar:
      pos < expected.length
        ? `${JSON.stringify(expected[pos])} (U+${expected
            .charCodeAt(pos)
            .toString(16)
            .toUpperCase()
            .padStart(4, "0")})`
        : "<EOF>",
    actualChar:
      pos < actual.length
        ? `${JSON.stringify(actual[pos])} (U+${actual
            .charCodeAt(pos)
            .toString(16)
            .toUpperCase()
            .padStart(4, "0")})`
        : "<EOF>",
    expectedSnippet:
      prefix + JSON.stringify(expBefore) + " >>> " + JSON.stringify(expAfter) + expSuffix,
    actualSnippet:
      prefix + JSON.stringify(actBefore) + " >>> " + JSON.stringify(actAfter) + actSuffix,
  };
}

module.exports = {
  APP_JS_PATH,
  APP_JSX_PATH,
  resolveImplPath,
  loadImpl,
  makePrepareOpts,
  unwrapPrepared,
  measureCodeSize,
  formatFirstDiff,
};
