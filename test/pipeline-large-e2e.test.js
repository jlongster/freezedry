"use strict";

// Large-tier (bench/LARGE.md) end-to-end oracle. Each workload compiles in 20-180 s and needs
// up to 12 GB heap, so it runs one subprocess per workload and is gated behind FREEZEDRY_E2E_LARGE=1.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const LARGE = require("../bench/libs/specs").SPECS.filter((s) => s.tier === "large");
const TOOL = path.resolve(__dirname, "../tools/oracle-one.js");
// Bails cleanly (original code is kept); never a miscompile.
const EXPECTED_BAIL = new Set(["prettier"]);

describe("End-to-End pipeline over large bench workloads (one process per workload)", { skip: process.env.FREEZEDRY_E2E_LARGE !== "1" }, () => {
  for (const spec of LARGE) {
    it(`${spec.id}: ISO-OK under corpus opt-ins`, () => {
      const tmpBase = os.tmpdir();
      const out = path.join(fs.mkdtempSync(path.join(tmpBase, "hyb-large-")), "oracle.jsonl");
      const r = childProcess.spawnSync(process.execPath, ["--max-old-space-size=12288", TOOL, spec.id, out], {
        encoding: "utf8",
        env: Object.assign({}, process.env, { TZ: "UTC" }),
      });
      assert.equal(r.status, 0, r.stderr);
      const rec = JSON.parse(fs.readFileSync(out, "utf8").trim());
      if (EXPECTED_BAIL.has(spec.id)) {
        assert.equal(rec.status, "BAIL", JSON.stringify(rec));
        return;
      }
      assert.equal(rec.status, "ISO-OK", JSON.stringify(rec));
    });
  }
});
