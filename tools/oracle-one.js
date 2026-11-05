"use strict";

// Run the full H4 oracle (heap isomorphism + smoke) for ONE workload and append a JSON line
// to the given results file. One process per workload avoids OOM/SIGSEGV on large bundles.
// Usage: node --max-old-space-size=12288 hybrid/tools/oracle-one.js <libId> <out.jsonl> [--zero-config]

const fs = require("node:fs");
const path = require("node:path");
const { prepackSources } = require("../index");

const id = process.argv[2];
const outFile = process.argv[3];
const zeroConfig = process.argv.includes("--zero-config");
const src = fs.readFileSync(path.resolve(__dirname, "../../bench/libs/dist", `${id}.js`), "utf8");
const t0 = Date.now();
const record = { id, mode: zeroConfig ? "zero-config" : "opt-ins", inputBytes: src.length };
try {
  const res = prepackSources([{ filePath: `${id}.js`, fileContents: src }], {
    useCorpusOptIns: !zeroConfig,
    timeout: 600000,
    fallbackOnBailout: false,
    verify: true,
    verifySmokeSpecId: id,
  });
  Object.assign(record, {
    status: "ISO-OK",
    outputBytes: res.code.length,
    bakedVolatiles: res.stats.bakedVolatiles,
    verifyStats: res.verifyResult && res.verifyResult.stats,
  });
} catch (e) {
  Object.assign(record, {
    status: e && e.verifyResult ? "DIFF" : "BAIL",
    error: String((e && e.message) || e).slice(0, 400),
  });
}
record.ms = Date.now() - t0;
fs.appendFileSync(outFile, `${JSON.stringify(record)}\n`);
console.log(`[ORACLE] ${id.padEnd(18)} ${record.status} ${record.ms}ms ${record.error || ""}`);
