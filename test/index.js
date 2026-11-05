"use strict";

const fs = require("fs");
const path = require("path");

for (const entry of fs.readdirSync(__dirname).sort()) {
  if (entry.endsWith(".test.js")) {
    require(path.join(__dirname, entry));
  }
}
