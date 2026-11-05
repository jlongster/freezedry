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

// React 18 comes from the benchmark's dependencies (bench/node_modules, installed by
// `node bench/setup.js`), or from REACT_NODE_MODULES when set.
function findReact18NodeModules() {
  const candidates = [process.env.REACT_NODE_MODULES, LOCAL_NM, path.resolve(REACT_BENCH_DIR, "..", "node_modules")].filter(Boolean);
  for (const dir of candidates) {
    if (hasReact18(dir)) return dir;
  }
  throw new Error(
    "Could not locate react@18 in bench/react/node_modules or bench/node_modules. " +
      "Run `node bench/setup.js` (or `npm run bench:setup`)."
  );
}

const reactNodeModules = findReact18NodeModules();

const reactRequire = Module.createRequire(path.join(reactNodeModules, "index.js"));
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
