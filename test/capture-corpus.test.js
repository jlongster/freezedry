"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const SPECS = require("../bench/libs/specs").SPECS.filter((s) => s.tier !== "large");
const { createEnvironment } = require("../lib/run");
const { capture } = require("../lib/capture");
const { rebuildInFreshContext } = require("./helpers/rebuild");

const DIST_DIR = path.resolve(__dirname, "../bench/libs/dist");

test("captures and verifies real-world bench/libs/dist/*.js corpus without crashes", async (t) => {
  for (const spec of SPECS) {
    await t.test(`corpus: ${spec.id}`, async () => {
      const distPath = path.join(DIST_DIR, `${spec.id}.js`);
      const src = fs.readFileSync(distPath, "utf8");

      const graph = await capture(src, {
        env: "universal",
        filename: `${spec.id}.js`,
      });

      assert.equal(
        graph.bailouts.length,
        0,
        `Unexpected bailout on ${spec.id}: ${JSON.stringify(graph.bailouts)}`
      );
      assert.ok(graph.roots.length > 0, `Expected non-empty global roots on ${spec.id}`);

      // Verify rebuilt heap from JSON produces identical smoke test output to original bundle
      const origEnv = createEnvironment("universal");
      vm.runInContext(src, origEnv.ctx, { filename: `${spec.id}.js` });
      const expectedJson = vm.runInContext(`(${spec.smokeCode})(globalThis)`, origEnv.ctx);

      const rebuilt = rebuildInFreshContext(graph, { env: "universal" });
      const actualJson = vm.runInContext(`(${spec.smokeCode})(globalThis)`, rebuilt.ctx);
      assert.equal(actualJson, expectedJson);
    });
  }
});
