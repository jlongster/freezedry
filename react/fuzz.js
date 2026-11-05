"use strict";

// Guard fuzzer: renders randomly mutated request data with the specialized renderer and with the
// real ReactDOMServer.renderToString (from an independently loaded copy of the app), and requires
// byte-identical output, or both throwing. Mutations are structural and type-confusing on purpose:
// deleted/nulled fields, wrong primitive types, special numbers, escaping-relevant strings, array
// truncation/duplication/emptying, extra object keys, objects replaced by arrays/strings.
//
//   node hybrid/react/fuzz.js [--n 2000] [--seed 1] [--mutations 3] [--bench /path/to/react-bench]

const path = require("path");
const fs = require("fs");

function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { f: next, int: (n) => Math.floor(next() * n), pick: (arr) => arr[Math.floor(next() * arr.length)] };
}

const STRINGS = ["", " ", "x", "<b>&amp;\"'</b>", " padded ", "javascript:alert(1)", "0", "true", "null", "😀", "a\u0000b", "\uD83D", "ns-x"];
const NUMBERS = [0, -0, 1, -1, 0.5, -2.25, 1e21, 1e-7, NaN, Infinity, -Infinity, 42, 3, 7, 1000000, -86400];

function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = clone(v[k]);
    return o;
  }
  return v;
}

// All (container, key) slots in the value.
function slots(v, out = [], depth = 0) {
  if (depth > 8 || v === null || typeof v !== "object") return out;
  for (const k of Object.keys(v)) {
    out.push([v, k]);
    slots(v[k], out, depth + 1);
  }
  return out;
}

function randomPrimitive(r) {
  switch (r.int(5)) {
    case 0:
      return r.pick(STRINGS);
    case 1:
      return r.pick(NUMBERS);
    case 2:
      return r.f() < 0.5;
    case 3:
      return null;
    default:
      return undefined;
  }
}

function mutate(data, r, count) {
  const d = clone(data);
  for (let i = 0; i < count; i++) {
    const all = slots(d);
    if (!all.length) break;
    const [obj, key] = r.pick(all);
    const v = obj[key];
    const kind = r.int(10);
    if (Array.isArray(v) && kind < 5) {
      if (kind === 0) obj[key] = [];
      else if (kind === 1) obj[key] = v.slice(0, 1);
      else if (kind === 2 && v.length) obj[key] = v.concat([clone(v[r.int(v.length)])]);
      else if (kind === 3) obj[key] = v.slice().reverse();
      else obj[key] = v.concat(v.map(clone));
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v) && kind < 3) {
      if (kind === 0) v[r.pick(["extra", "data-x", "className", "toString", "children"])] = randomPrimitive(r);
      else if (kind === 1) obj[key] = [];
      else obj[key] = r.pick(STRINGS);
      continue;
    }
    if (kind === 9 && !Array.isArray(obj)) {
      delete obj[key];
      continue;
    }
    if (typeof v === "number" && kind < 6) {
      obj[key] = r.pick(NUMBERS);
      continue;
    }
    if (typeof v === "string" && kind < 6) {
      obj[key] = r.f() < 0.5 ? r.pick(STRINGS) : v + r.pick(STRINGS);
      continue;
    }
    if (typeof v === "boolean" && kind < 6) {
      obj[key] = !v;
      continue;
    }
    obj[key] = randomPrimitive(r);
  }
  return d;
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
  };
  const n = Number(opt("n", 2000));
  const seed = Number(opt("seed", 1));
  const muts = Number(opt("mutations", 3));
  const bench = opt("bench", "/tmp/opencode/pp-wt/react-bench/react-bench");
  const util = require(path.join(bench, "harness-util.js"));
  const data = require(path.join(bench, "data.js"));
  const { React, ReactDOMServer } = require(path.join(bench, "react-deps.js"));
  const impl = require("./index.js");
  const src = fs.readFileSync(util.APP_JS_PATH, "utf8");
  const render = impl.prepare(src, util.makePrepareOpts({ noCache: args.includes("--no-cache") }));
  const App = require(util.APP_JS_PATH);
  const base = data.getSmallCorpus().concat(data.getLargeCorpus(5));
  const r = rng(seed);
  let same = 0;
  let bothThrow = 0;
  let bad = 0;
  const fb0 = render.stats.fallbacks;
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const input = mutate(r.pick(base), r, 1 + r.int(muts));
    let want;
    let wantErr = null;
    try {
      want = ReactDOMServer.renderToString(React.createElement(App, { data: clone(input) }));
    } catch (e) {
      wantErr = e;
    }
    let got;
    let gotErr = null;
    try {
      got = render(clone(input));
    } catch (e) {
      gotErr = e;
    }
    if (wantErr || gotErr) {
      if (wantErr && gotErr && String(wantErr.message) === String(gotErr.message)) bothThrow++;
      else {
        bad++;
        if (bad <= 3) console.log("THROW MISMATCH", i, wantErr && wantErr.message, "|", gotErr && gotErr.message);
      }
      continue;
    }
    if (got === want) same++;
    else {
      bad++;
      if (bad <= 3) {
        fs.writeFileSync(`/tmp/opencode/fuzz-fail-${i}.json`, JSON.stringify(input, (k, v) => (v === undefined ? "__undefined__" : v)));
        console.log("MISMATCH", i, JSON.stringify(util.formatFirstDiff(want, got)));
      }
    }
  }
  const fallbacks = render.stats.fallbacks - fb0;
  console.log(
    JSON.stringify({ inputs: n, identical: same, bothThrow, mismatches: bad, fallbacks, fallbackRate: +(fallbacks / n).toFixed(3), seconds: (Date.now() - t0) / 1000 })
  );
  const reasons = Object.entries(render.stats.fallbackReasons).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [k, v] of reasons) console.log(`  ${v}  ${k.slice(0, 150)}`);
  process.exitCode = bad ? 1 : 0;
}

if (require.main === module) main();

module.exports = { mutate, rng };
