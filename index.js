"use strict";

// Public API, compatible with Prepack's prepackSources so bench/run.js can drive it.
// Pipeline: run -> capture -> emit -> guard -> (verify). See DESIGN.md.
const { verify, verifySmoke, verifyMutationProbe } = require("./lib/verify");
const { getHybridVersion, adaptPrepackOptions, createPrepackSources } = require("./lib/bench-adapter");

const prepackSources = createPrepackSources();
const prepackVersion = getHybridVersion();

module.exports = {
  prepackSources,
  prepackVersion,
  createPrepackSources,
  adaptPrepackOptions,
  verify,
  verifySmoke,
  verifyMutationProbe,
};
