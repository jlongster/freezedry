"use strict";
// Public API, compatible with Prepack's prepackSources so bench/run.js can drive it.
// Pipeline: run -> capture -> emit -> guard -> (verify). See DESIGN.md.
function prepackSources(sources, options = {}) {
  throw new Error("hybrid: not implemented yet");
}
module.exports = { prepackSources };
