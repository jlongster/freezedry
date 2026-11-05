#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { prepackSources } = require("../index.js");

function parseCliArgs(argv) {
  const opts = {
    input: null,
    out: null,
    verify: false,
    profile: undefined,
    assume: {},
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      opts.out = argv[++i];
    } else if (a === "--verify") {
      opts.verify = true;
    } else if (a === "--profile") {
      opts.profile = argv[++i];
    } else if (a === "--assume") {
      const spec = argv[++i] || "";
      const eq = spec.indexOf("=");
      if (eq < 0) {
        throw new Error(`--assume expects NAME=JSON, got: ${spec}`);
      }
      const name = spec.slice(0, eq);
      const rawJson = spec.slice(eq + 1);
      opts.assume[name] = JSON.parse(rawJson);
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    } else if (!opts.input) {
      opts.input = a;
    }
  }

  if (!opts.input) {
    throw new Error("Usage: node hybrid/bin/hybrid.js <input.js> [--out out.js] [--assume NAME=JSON] [--verify]");
  }
  return opts;
}

const cli = parseCliArgs(process.argv.slice(2));
const result = prepackSources([{ filePath: cli.input, fileContents: fs.readFileSync(cli.input, "utf8") }], {
  verify: cli.verify,
  profile: cli.profile,
  assume: Object.keys(cli.assume).length > 0 ? cli.assume : undefined,
});

if (cli.out) fs.writeFileSync(cli.out, result.code);
else process.stdout.write(result.code);
