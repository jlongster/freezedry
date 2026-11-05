"use strict";

const vm = require("vm");
const { React, ReactDOMServer, reactRequire } = require("../react-deps");

function loadAppFromSource(appSource, opts) {
  const req = (opts && opts.require) || reactRequire;
  const filename = (opts && opts.appPath) || "app.js";
  const mod = { exports: {} };
  const wrapper = vm.compileFunction(
    appSource,
    ["exports", "require", "module", "__filename", "__dirname"],
    { filename }
  );
  wrapper(mod.exports, req, mod, filename, require("path").dirname(filename));
  return mod.exports;
}

module.exports = {
  name: "baseline (ReactDOMServer.renderToString)",
  prepare(appSource, opts = {}) {
    const App = loadAppFromSource(appSource, opts);
    const R = opts.React || React;
    const RDS = opts.ReactDOMServer || ReactDOMServer;

    function renderBaseline(data) {
      return RDS.renderToString(R.createElement(App, { data }));
    }

    renderBaseline.code = appSource;
    return renderBaseline;
  },
};
