"use strict";

// Correctness harness: node bench/react/check.js --impl <module> [--limit N] [--only small|large] [--json out.json] [--all-mismatches]
//
// For every input in the fixed 500-input corpus (data.js getCheckCorpus()), checks
//   renderFn(data) === ReactDOMServer.renderToString(<App data={data} />)
// byte-for-byte. Each side gets its own deep copy of the input, so an implementation
// that mutates its input cannot affect the reference (and vice versa).

const fs = require("fs");
const path = require("path");
const { React, ReactDOMServer } = require("./react-deps");
const { getCheckCorpus, corpusFingerprint } = require("./data");
const {
  APP_JS_PATH,
  loadImpl,
  makePrepareOpts,
  unwrapPrepared,
  measureCodeSize,
  formatFirstDiff,
} = require("./harness-util");

function parseArgs(argv) {
  const args = { impl: null, limit: Infinity, only: "all", json: null, allMismatches: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--impl") args.impl = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--only") args.only = argv[++i];
    else if (a === "--json") args.json = argv[++i];
    else if (a === "--all-mismatches") args.allMismatches = true;
    else if (a === "--quiet") args.quiet = true;
    else if (a === "-h" || a === "--help") {
      console.log(
        "usage: node bench/react/check.js --impl <module> [--limit N] [--only small|large|all] [--json out.json] [--all-mismatches]"
      );
      process.exit(0);
    } else if (!args.impl && !a.startsWith("--")) args.impl = a;
    else throw new Error("unknown argument: " + a);
  }
  return args;
}

function deepCopy(v) {
  return structuredClone(v);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const impl = loadImpl(args.impl);
  const appSource = fs.readFileSync(APP_JS_PATH, "utf8");
  // Reference App is loaded independently of the implementation (plain require).
  const RefApp = require(APP_JS_PATH);
  const reference = data => ReactDOMServer.renderToString(React.createElement(RefApp, { data }));

  const corpus = getCheckCorpus()
    .map((data, index) => ({ data, index, variant: data.requestId.endsWith("-large") ? "large" : "small" }))
    .filter(e => args.only === "all" || e.variant === args.only)
    .slice(0, args.limit);

  const t0 = process.hrtime.bigint();
  const prepared = unwrapPrepared(impl.prepare(appSource, makePrepareOpts()));
  const prepareMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const size = measureCodeSize(prepared.code);
  const appSize = measureCodeSize(appSource);

  let pass = 0;
  const failures = [];
  let firstReported = false;
  for (const entry of corpus) {
    const expected = reference(deepCopy(entry.data));
    let actual;
    let error = null;
    try {
      actual = prepared.renderFn(deepCopy(entry.data));
    } catch (e) {
      error = e;
    }
    if (error === null && actual === expected) {
      pass++;
      continue;
    }
    const failure = {
      index: entry.index,
      requestId: entry.data.requestId,
      variant: entry.variant,
    };
    if (error !== null) {
      failure.kind = "throw";
      failure.error = String((error && error.stack) || error).split("\n").slice(0, 6).join("\n");
    } else if (typeof actual !== "string") {
      failure.kind = "type";
      failure.error = "renderFn returned " + typeof actual;
    } else {
      failure.kind = "mismatch";
      failure.diff = formatFirstDiff(expected, actual);
    }
    failures.push(failure);
    if (!args.quiet && (!firstReported || args.allMismatches)) {
      firstReported = true;
      printFailure(failure);
    }
  }

  const summary = {
    impl: impl.name,
    implPath: impl.implPath,
    corpusFingerprint: corpusFingerprint(getCheckCorpus()),
    total: corpus.length,
    pass,
    fail: failures.length,
    throws: failures.filter(f => f.kind === "throw").length,
    mismatches: failures.filter(f => f.kind === "mismatch").length,
    prepareMs: Math.round(prepareMs * 10) / 10,
    generatedCode: Object.assign({ measuredFrom: prepared.codeSource }, size),
    appSource: appSize,
    stats: prepared.stats,
    failures: failures.slice(0, 50),
  };

  console.log("");
  console.log(`impl:            ${summary.impl}  (${path.relative(process.cwd(), impl.implPath)})`);
  console.log(`result:          ${pass}/${corpus.length} byte-identical` + (failures.length ? `  (${summary.mismatches} mismatches, ${summary.throws} throws)` : "  OK"));
  console.log(`corpus:          ${getCheckCorpus().length} inputs, fingerprint ${summary.corpusFingerprint}`);
  console.log(`prepare():       ${summary.prepareMs} ms`);
  console.log(
    `generated code:  ${size.bytes} bytes (${size.gzipBytes} gzip, ${size.lines} lines) [${prepared.codeSource}]` +
      `   vs app.js ${appSize.bytes} bytes (${appSize.gzipBytes} gzip)`
  );
  if (failures.length > 1) {
    console.log(
      "failing inputs:  " +
        failures
          .slice(0, 20)
          .map(f => f.index)
          .join(", ") +
        (failures.length > 20 ? ", ..." : "")
    );
  }
  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify(summary, null, 2) + "\n");
  }
  process.exitCode = failures.length === 0 ? 0 : 1;
}

function printFailure(f) {
  console.log(`\nFAIL input #${f.index} (${f.requestId}, ${f.variant}): ${f.kind}`);
  if (f.kind === "mismatch") {
    const d = f.diff;
    console.log(`  first difference at offset ${d.offset} (expected length ${d.expectedLength}, actual ${d.actualLength})`);
    console.log(`  expected char ${d.expectedChar}, actual char ${d.actualChar}`);
    console.log(`  expected: ${d.expectedSnippet}`);
    console.log(`  actual:   ${d.actualSnippet}`);
  } else {
    console.log("  " + f.error.replace(/\n/g, "\n  "));
  }
}

main();
