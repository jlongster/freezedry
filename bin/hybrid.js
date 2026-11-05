#!/usr/bin/env node
"use strict";
const fs = require("fs");
const { prepackSources } = require("../index.js");
const args = process.argv.slice(2);
const input = args.find(a => !a.startsWith("--"));
const outIdx = args.indexOf("--out");
const result = prepackSources([{ filePath: input, fileContents: fs.readFileSync(input, "utf8") }], {});
if (outIdx >= 0) fs.writeFileSync(args[outIdx + 1], result.code);
else process.stdout.write(result.code);
