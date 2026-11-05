"use strict";

// End-to-end: specialize the shared react-bench app, check a slice of the 500-input corpus
// byte-for-byte and a batch of fuzzed inputs. Skipped when the benchmark is not present.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BENCH = process.env.REACT_BENCH_DIR || "/tmp/opencode/pp-wt/react-bench/react-bench";
const present = fs.existsSync(path.join(BENCH, "data.js")) && fs.existsSync(path.join(BENCH, "app", "app.js"));

describe("react-hybrid on react-bench", { skip: !present && "react-bench not found" }, () => {
  it("matches renderToString on the check corpus and on fuzzed inputs", () => {
    const util = require(path.join(BENCH, "harness-util.js"));
    const data = require(path.join(BENCH, "data.js"));
    const { React, ReactDOMServer } = require(path.join(BENCH, "react-deps.js"));
    const impl = require("../react/index.js");
    const { mutate, rng } = require("../react/fuzz.js");
    const r = impl.build(fs.readFileSync(util.APP_JS_PATH, "utf8"), util.makePrepareOpts({ trainSmall: 40, trainLarge: 4 }));
    assert.equal(r.stats.disabled, null);
    assert.equal(r.stats.selfCheckMismatches, 0);
    const App = require(util.APP_JS_PATH);
    const ref = (d) => ReactDOMServer.renderToString(React.createElement(App, { data: d }));
    const corpus = data.getCheckCorpus();
    const sample = corpus.slice(0, 150).concat(corpus.slice(475, 480));
    for (const d of sample) assert.equal(r.render(d), ref(d));
    assert.ok(r.stats.fallbacks <= 15, `fallbacks ${r.stats.fallbacks}`);
    const g = rng(7);
    for (let i = 0; i < 400; i++) {
      const d = mutate(corpus[g.int(150)], g, 1 + g.int(4));
      let want;
      let wantErr = null;
      try {
        want = ref(d);
      } catch (e) {
        wantErr = e.message;
      }
      let got;
      let gotErr = null;
      try {
        got = r.render(d);
      } catch (e) {
        gotErr = e.message;
      }
      assert.equal(gotErr, wantErr);
      assert.equal(got, want);
    }
  });
});
