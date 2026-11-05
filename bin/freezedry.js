#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { prepackSources, parseAssumeEntry } = require("../index.js");

function splitCsv(str) {
  return String(str)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function parseCliArgs(argv) {
  const opts = {
    inputs: [],
    out: null,
    verify: false,
    profile: undefined,
    assume: {},
    hasAssume: false,
    allowVolatile: [],
    tz: undefined,
    fallback: undefined,
    externalPath: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(
        [
          "Usage: freezedry <input.js> [options]",
          "  --out <out.js>               Write output JS to file (default: stdout)",
          "  --profile <name>             Target profile: ecmascript|browser|worker|node|bun|hermes|universal",
          "  --assume <NAME=JSON>         Assert global/property value or typeof:PATH=\"type\" (repeatable)",
          "  --allow-volatile <list>      Explicitly bake volatile APIs (e.g. Date.now,Math.random,new Date)",
          "  --assume-tz <zone>           Pin timezone during init and guard at runtime (e.g. UTC)",
          "  --fallback <mode>            Guard mismatch fallback: function|eval|throw|external (default: function)",
          "  --fallback-file <path>       External fallback module path when --fallback=external",
          "  --verify                     Verify heap isomorphism between original and rebuilt output",
        ].join("\n") + "\n"
      );
      process.exit(0);
    } else if (a === "--out" || a === "-o") {
      opts.out = argv[++i];
    } else if (a.startsWith("--out=")) {
      opts.out = a.slice("--out=".length);
    } else if (a === "--verify") {
      opts.verify = true;
    } else if (a === "--no-verify") {
      opts.verify = false;
    } else if (a === "--profile") {
      opts.profile = argv[++i];
    } else if (a.startsWith("--profile=")) {
      opts.profile = a.slice("--profile=".length);
    } else if (a === "--assume") {
      const parsed = parseAssumeEntry(argv[++i] || "");
      opts.assume[parsed.key] = parsed.value;
      opts.hasAssume = true;
    } else if (a.startsWith("--assume=")) {
      const parsed = parseAssumeEntry(a.slice("--assume=".length));
      opts.assume[parsed.key] = parsed.value;
      opts.hasAssume = true;
    } else if (a === "--allow-volatile") {
      opts.allowVolatile.push(...splitCsv(argv[++i] || ""));
    } else if (a.startsWith("--allow-volatile=")) {
      opts.allowVolatile.push(...splitCsv(a.slice("--allow-volatile=".length)));
    } else if (a === "--assume-tz") {
      opts.tz = argv[++i];
    } else if (a.startsWith("--assume-tz=")) {
      opts.tz = a.slice("--assume-tz=".length);
    } else if (a === "--fallback") {
      opts.fallback = argv[++i];
    } else if (a.startsWith("--fallback=")) {
      opts.fallback = a.slice("--fallback=".length);
    } else if (a === "--fallback-file") {
      opts.externalPath = argv[++i];
    } else if (a.startsWith("--fallback-file=")) {
      opts.externalPath = a.slice("--fallback-file=".length);
    } else if (a === "--seed" || a.startsWith("--seed=") || a === "--mathRandomSeed" || a.startsWith("--mathRandomSeed=")) {
      parseAssumeEntry("mathRandomSeed=0");
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      opts.inputs.push(a);
    }
  }

  if (opts.inputs.length === 0) {
    throw new Error(
      "Usage: freezedry <input.js> [--out out.js] [--profile NAME] [--assume NAME=JSON] [--allow-volatile LIST] [--assume-tz ZONE] [--fallback MODE] [--verify]"
    );
  }
  return opts;
}

if (require.main === module) {
  const cli = parseCliArgs(process.argv.slice(2));
  const sources = cli.inputs.map(filePath => ({
    filePath,
    fileContents: fs.readFileSync(filePath, "utf8"),
  }));

  const result = prepackSources(sources, {
    verify: cli.verify,
    profile: cli.profile,
    assume: cli.hasAssume ? cli.assume : undefined,
    allowVolatile: cli.allowVolatile.length > 0 ? cli.allowVolatile : undefined,
    tz: cli.tz,
    fallback: cli.fallback,
    externalPath: cli.externalPath,
  });

  if (result.bailouts && result.bailouts.length > 0) {
    for (const b of result.bailouts) {
      process.stderr.write(`[freezedry] bailout (emitting fallback): ${b.reason}${b.where ? ` (${b.where})` : ""}\n`);
    }
  }

  if (cli.out) fs.writeFileSync(cli.out, result.code, "utf8");
  else process.stdout.write(result.code);
}

module.exports = { parseCliArgs };
