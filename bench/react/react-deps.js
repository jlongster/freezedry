"use strict";

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

const fs = require("fs");
const path = require("path");
const Module = require("module");

const REACT_BENCH_DIR = __dirname;
const LOCAL_NM = path.join(REACT_BENCH_DIR, "node_modules");

function hasReact18(nmDir) {
  try {
    const pkgPath = path.join(nmDir, "react", "package.json");
    if (!fs.existsSync(pkgPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return typeof pkg.version === "string" && pkg.version.startsWith("18.");
  } catch (_err) {
    return false;
  }
}

function findReact18NodeModules() {
  const candidates = [
    LOCAL_NM,
    path.resolve(REACT_BENCH_DIR, "..", "bench", "node_modules"),
    "/tmp/opencode/pp-wt/bench/bench/node_modules",
  ];
  for (const dir of candidates) {
    if (hasReact18(dir)) return dir;
  }
  throw new Error(
    "Could not locate react@18.3.1 in react-bench/node_modules or bench/node_modules. " +
      "Run `node bench/setup.js` or install react@18.3.1 and react-dom@18.3.1."
  );
}

const reactNodeModules = findReact18NodeModules();

// Ensure react-bench/node_modules exists (gitignored) so standard CommonJS resolution
// inside react-bench/ always finds react@18.3.1 instead of root node_modules (react@16).
if (reactNodeModules !== LOCAL_NM && !fs.existsSync(LOCAL_NM)) {
  try {
    fs.symlinkSync(reactNodeModules, LOCAL_NM, "dir");
  } catch (_err) {
    // Ignore race if parallel processes create the symlink simultaneously.
  }
}

const reactRequire = Module.createRequire(path.join(REACT_BENCH_DIR, "index.js"));
const React = reactRequire("react");
const ReactDOMServer = reactRequire("react-dom/server");

if (!React.version || !React.version.startsWith("18.")) {
  throw new Error(`Expected React 18.x, got ${React.version}`);
}

module.exports = {
  React,
  ReactDOMServer,
  reactNodeModules,
  reactRequire,
  REACT_BENCH_DIR,
};
