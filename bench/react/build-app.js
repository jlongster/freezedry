"use strict";

const fs = require("fs");
const path = require("path");
const { reactRequire } = require("./react-deps");

const JSX_PATH = path.join(__dirname, "app", "app.jsx");
const JS_PATH = path.join(__dirname, "app", "app.js");

function compileApp() {
  const Babel = reactRequire("@babel/standalone");
  const jsxSource = fs.readFileSync(JSX_PATH, "utf8");
  const result = Babel.transform(jsxSource, {
    filename: "app.jsx",
    plugins: [
      ["transform-react-jsx", { runtime: "classic", useBuiltIns: true }],
    ],
    retainLines: false,
  });

  const header =
    "// GENERATED FROM react-bench/app/app.jsx BY `node react-bench/build-app.js`.\n" +
    "// Do not edit by hand; edit app.jsx and re-run build-app.js.\n\n";
  const cleaned = result.code.replace(/\/\*#__PURE__\*\//g, "");
  const output = header + cleaned + "\n";
  fs.writeFileSync(JS_PATH, output, "utf8");
  return output;
}

if (require.main === module) {
  const out = compileApp();
  console.log(
    `Compiled ${path.relative(process.cwd(), JSX_PATH)} -> ${path.relative(
      process.cwd(),
      JS_PATH
    )} (${Buffer.byteLength(out, "utf8")} bytes)`
  );
}

module.exports = { compileApp, JSX_PATH, JS_PATH };
