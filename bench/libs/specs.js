"use strict";

const fs = require("fs");
const path = require("path");

function readPkgFile(nmDir, relPath) {
  return fs.readFileSync(path.join(nmDir, relPath), "utf8");
}

const ROOT_EXPR =
  '(typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : this)';

const SPECS = [
  {
    id: "lodash",
    name: "Lodash",
    kind: "library",
    buildType: "umd",
    packages: ["lodash"],
    description:
      "Utility library; module init constructs LodashWrapper/LazyWrapper prototypes, 300+ methods, and lookup tables.",
    build(nmDir) {
      return readPkgFile(nmDir, "lodash/lodash.js");
    },
    smokeCode: `(function(root) {
      var _ = root._;
      var users = [
        { user: "fred", dept: "eng", score: 48 },
        { user: "barney", dept: "ops", score: 36 },
        { user: "pebbles", dept: "eng", score: 52 },
        { user: "wilma", dept: "ops", score: 44 }
      ];
      var grouped = _.mapValues(_.groupBy(users, "dept"), function(list) {
        return _.map(_.orderBy(list, ["score"], ["desc"]), "user");
      });
      var merged = _.merge({ a: { x: 1, arr: [1, 2] } }, { a: { y: 2, arr: [3] } });
      var chained = _([1, 2, 3, 4, 5, 6])
        .filter(function(n) { return n % 2 === 0; })
        .map(function(n) { return n * n; })
        .sum();
      var compiled = _.template("Hello <%= name %> (<%- tag %>)");
      return JSON.stringify({
        version: _.VERSION,
        chunk: _.chunk(["a", "b", "c", "d", "e"], 2),
        camel: _.camelCase("--foo-bar_baz--"),
        kebab: _.kebabCase("FooBarBaz"),
        uniq: _.uniqBy([2.1, 1.2, 2.3], Math.floor),
        grouped: grouped,
        merged: merged,
        chained: chained,
        tpl: compiled({ name: "Ada", tag: "<admin>" })
      });
    })`,
  },

  {
    id: "underscore",
    name: "Underscore",
    kind: "library",
    buildType: "umd",
    packages: ["underscore"],
    description:
      "Functional utility library; module init performs environment feature checks and mixes 100+ functions onto `_.prototype`.",
    build(nmDir) {
      return readPkgFile(nmDir, "underscore/underscore-umd.js");
    },
    smokeCode: `(function(root) {
      var _ = root._;
      var items = [
        { k: "a", v: 10 },
        { k: "b", v: 25 },
        { k: "a", v: 15 },
        { k: "c", v: 5 }
      ];
      var byKey = _.groupBy(items, "k");
      var sums = _.mapObject(byKey, function(arr) {
        return _.reduce(arr, function(acc, x) { return acc + x.v; }, 0);
      });
      var tpl = _.template("item:<%= id %>:<%- raw %>");
      return JSON.stringify({
        version: _.VERSION,
        sums: sums,
        sorted: _.pluck(_.sortBy(items, "v"), "v"),
        zip: _.zip(["x", "y"], [1, 2], [true, false]),
        flatten: _.flatten([1, [2, [3, [4]]]]),
        chain: _.chain([1, 2, 3, 4, 5]).filter(function(n) { return n > 2; }).map(function(n) { return n * 3; }).value(),
        tpl: tpl({ id: 7, raw: "<b>ok</b>" })
      });
    })`,
  },

  {
    id: "ramda",
    name: "Ramda",
    kind: "library",
    buildType: "umd",
    packages: ["ramda"],
    description:
      "Point-free curried functional library; module init wraps 250+ combinators in _curry1/_curry2/_curry3 dispatchers.",
    build(nmDir) {
      return readPkgFile(nmDir, "ramda/dist/ramda.js");
    },
    smokeCode: `(function(root) {
      var R = root.R;
      var transform = R.pipe(
        R.filter(R.propSatisfies(R.gt(R.__, 20), "age")),
        R.sortBy(R.prop("name")),
        R.map(R.evolve({ age: R.inc, name: R.toUpper }))
      );
      var data = [
        { name: "charlie", age: 25 },
        { name: "alice", age: 19 },
        { name: "bob", age: 31 }
      ];
      var xLens = R.lensPath(["coords", "x"]);
      return JSON.stringify({
        transformed: transform(data),
        lensed: R.over(xLens, R.multiply(10), { coords: { x: 4, y: 9 } }),
        grouped: R.groupBy(function(n) { return n % 2 === 0 ? "even" : "odd"; }, [1, 2, 3, 4, 5]),
        zipObj: R.zipObj(["a", "b", "c"], [10, 20, 30]),
        unnest: R.unnest([[1, 2], [3, [4]], [5]])
      });
    })`,
  },

  {
    id: "immutable",
    name: "Immutable.js",
    kind: "library",
    buildType: "umd",
    packages: ["immutable"],
    description:
      "Persistent HAMT/trie collections (Map, List, Set, OrderedMap, Record); builds prototype hierarchies and sentinels at init.",
    build(nmDir) {
      return readPkgFile(nmDir, "immutable/dist/immutable.js");
    },
    smokeCode: `(function(root) {
      var I = root.Immutable;
      var m1 = I.Map({ a: 1, b: 2, c: 3 });
      var m2 = m1.set("b", 20).set("d", 4);
      var m3 = I.Map({ a: 1, b: 20, c: 3, d: 4 });
      var list = I.List.of(10, 20, 30).push(40).unshift(5).filter(function(x) { return x >= 10; });
      var nested = I.fromJS({ user: { roles: ["viewer", "editor"], count: 2 } });
      var nested2 = nested.updateIn(["user", "roles"], function(r) { return r.push("admin"); });
      var Point = I.Record({ x: 0, y: 0 });
      var p = new Point({ x: 7, y: 9 });
      return JSON.stringify({
        m1b: m1.get("b"),
        m2b: m2.get("b"),
        equal: I.is(m2, m3),
        sameHash: m2.hashCode() === m3.hashCode(),
        list: list.toArray(),
        nestedOrig: nested.toJS(),
        nestedNext: nested2.toJS(),
        orderedKeys: I.OrderedMap([["z", 1], ["a", 2], ["m", 3]]).keySeq().toArray(),
        point: [p.x, p.y]
      });
    })`,
  },

  {
    id: "moment",
    name: "Moment.js (with locales)",
    kind: "library",
    buildType: "umd",
    packages: ["moment"],
    description:
      "Init-heavy date/time library with 135+ bundled locales registered via defineLocale() and regex token tables built at load.",
    build(nmDir) {
      return readPkgFile(nmDir, "moment/min/moment-with-locales.js");
    },
    smokeCode: `(function(root) {
      var moment = root.moment;
      var base = moment.utc("2026-03-15T14:25:00Z");
      var shifted = base.clone().add(10, "days").subtract(3, "hours");
      var dur = moment.duration({ hours: 50, minutes: 15 });
      return JSON.stringify({
        version: moment.version,
        localeCount: moment.locales().length,
        iso: shifted.toISOString(),
        en: base.clone().locale("en").format("dddd, MMMM Do YYYY, HH:mm"),
        fr: base.clone().locale("fr").format("dddd D MMMM YYYY HH:mm"),
        de: base.clone().locale("de").format("dddd, D. MMMM YYYY HH:mm"),
        ja: base.clone().locale("ja").format("YYYY年M月D日(ddd) HH:mm"),
        diffHours: shifted.diff(base, "hours"),
        durMinutes: dur.asMinutes(),
        leap2024: moment.utc([2024]).isLeapYear(),
        leap2026: moment.utc([2026]).isLeapYear()
      });
    })`,
  },

  {
    id: "chroma-js",
    name: "chroma.js",
    kind: "library",
    buildType: "umd",
    packages: ["chroma-js"],
    description:
      "Color conversion & scale library; module init registers RGB/HSL/Lab/LCH/CMYK color spaces, ColorBrewer palettes, and W3C named colors.",
    build(nmDir) {
      return readPkgFile(nmDir, "chroma-js/chroma.js");
    },
    smokeCode: `(function(root) {
      var chroma = root.chroma;
      var scale = chroma.scale(["#fafa6e", "#2A4858"]).mode("lch").colors(5);
      var bez = chroma.bezier(["yellow", "red", "black"]).scale().colors(4);
      var c = chroma("#336699");
      return JSON.stringify({
        version: chroma.version,
        scale: scale,
        bezier: bez,
        lab: c.lab().map(function(v) { return Math.round(v * 100) / 100; }),
        luminance: Math.round(c.luminance() * 10000) / 10000,
        contrast: Math.round(chroma.contrast("#ffffff", "#336699") * 100) / 100,
        mix: chroma.mix("red", "blue", 0.5, "lab").hex()
      });
    })`,
  },

  {
    id: "acorn",
    name: "Acorn",
    kind: "library",
    buildType: "umd",
    packages: ["acorn"],
    description:
      "ECMAScript parser; module init builds token types, keyword regexes, operator precedence tables, and Unicode identifier bitmaps.",
    build(nmDir) {
      return readPkgFile(nmDir, "acorn/dist/acorn.js");
    },
    smokeCode: `(function(root) {
      var acorn = root.acorn;
      var sample = [
        "const add = (a, b = 1) => a + b;",
        "class Counter { constructor(n) { this.n = n; } inc() { return ++this.n; } }",
        "export function calc(xs) { let s = 0; for (const x of xs) s += add(x); return s; }"
      ].join("\\n");
      var ast = acorn.parse(sample, { ecmaVersion: 2022, sourceType: "module", locations: true });
      var tokCount = 0;
      var iter = acorn.tokenizer(sample, { ecmaVersion: 2022, sourceType: "module" });
      while (iter.getToken().type !== acorn.tokTypes.eof) tokCount++;
      return JSON.stringify({
        version: acorn.version,
        topTypes: ast.body.map(function(n) { return n.type; }),
        classMethods: ast.body[1].body.body.map(function(m) { return m.key.name + ":" + m.kind; }),
        endLine: ast.loc.end.line,
        tokCount: tokCount
      });
    })`,
  },

  {
    id: "crc-32",
    name: "SheetJS crc-32",
    kind: "library",
    buildType: "umd",
    packages: ["crc-32"],
    description:
      "Lookup-table CRC-32 implementation; module init computes a 256-entry table and 16 slice-by-16 Int32Array subtables (4,096 entries).",
    build(nmDir) {
      return (
        readPkgFile(nmDir, "crc-32/crc32.js") +
        `\n;if (typeof CRC32 !== "undefined") ${ROOT_EXPR}.CRC32 = CRC32;\n`
      );
    },
    smokeCode: `(function(root) {
      var CRC32 = root.CRC32;
      return JSON.stringify({
        version: CRC32.version,
        str: CRC32.str("The quick brown fox jumps over the lazy dog"),
        utf8: CRC32.str("Prepack λ partial evaluation"),
        bstr: CRC32.bstr("123456789"),
        buf: CRC32.buf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]),
        seeded: CRC32.str("world", CRC32.str("hello "))
      });
    })`,
  },

  {
    id: "marked",
    name: "Marked",
    kind: "library",
    buildType: "umd",
    packages: ["marked"],
    description:
      "Markdown parser & compiler; module init constructs GFM/pedantic/normal block and inline grammar regex tables.",
    build(nmDir) {
      return readPkgFile(nmDir, "marked/lib/marked.umd.js");
    },
    smokeCode: `(function(root) {
      var marked = root.marked;
      var md = [
        "# Heading 1",
        "",
        "Paragraph with **bold**, *italic*, and \`code\`.",
        "",
        "- item one",
        "- item two",
        "",
        "| col A | col B |",
        "| --- | --- |",
        "| 1 | 2 |"
      ].join("\\n");
      var tokens = marked.lexer(md);
      var html = marked.parse(md);
      return JSON.stringify({
        tokenTypes: tokens.map(function(t) { return t.type; }),
        htmlLen: html.length,
        hasTable: html.indexOf("<table>") >= 0,
        hasStrong: html.indexOf("<strong>bold</strong>") >= 0
      });
    })`,
  },

  {
    id: "d3-scale",
    name: "D3 Scale + Array",
    kind: "library",
    buildType: "umd",
    packages: ["d3-scale", "d3-array", "d3-interpolate", "d3-color", "d3-format", "d3-time", "d3-time-format", "internmap"],
    description:
      "Data visualization quantitative/ordinal/time scales, array statistics, formatters, and color interpolators initialized on `d3`.",
    build(nmDir) {
      const files = [
        "internmap/dist/internmap.js",
        "d3-array/dist/d3-array.js",
        "d3-color/dist/d3-color.js",
        "d3-interpolate/dist/d3-interpolate.js",
        "d3-format/dist/d3-format.js",
        "d3-time/dist/d3-time.js",
        "d3-time-format/dist/d3-time-format.js",
        "d3-scale/dist/d3-scale.js",
      ];
      return files.map(f => readPkgFile(nmDir, f)).join("\n;\n");
    },
    smokeCode: `(function(root) {
      var d3 = root.d3;
      var lin = d3.scaleLinear().domain([0, 100]).range([0, 500]);
      var band = d3.scaleBand().domain(["Q1", "Q2", "Q3", "Q4"]).range([0, 400]).paddingInner(0.2);
      var color = d3.scaleLinear().domain([0, 1]).range(["#ff0000", "#0000ff"]);
      var fmt = d3.format(".2s");
      return JSON.stringify({
        lin25: lin(25),
        invert250: lin.invert(250),
        ticks: lin.ticks(5),
        bandQ2: Math.round(band("Q2") * 100) / 100,
        bandwidth: Math.round(band.bandwidth() * 100) / 100,
        colorMid: color(0.5),
        extent: d3.extent([14, -3, 42, 8, 29]),
        quantile: d3.quantile([10, 20, 30, 40, 50], 0.5),
        formatted: fmt(42000000)
      });
    })`,
  },

  {
    id: "redux",
    name: "Redux (store + middleware init)",
    kind: "app-workload",
    buildType: "esbuild-iife",
    packages: ["redux"],
    description:
      "Redux bundled into an ES2015 IIFE; module init composes reducers, applies logging/validation middleware, creates a store, and dispatches seed actions.",
    build(nmDir, esbuild) {
      const entry = `
        import { createStore, combineReducers, applyMiddleware, compose } from "redux";
        function todosReducer(state, action) {
          if (state === undefined) state = [];
          if (action.type === "ADD_TODO") {
            return state.concat([{ id: state.length + 1, text: action.text, done: false }]);
          }
          if (action.type === "TOGGLE_TODO") {
            return state.map(function(t) {
              return t.id === action.id ? { id: t.id, text: t.text, done: !t.done } : t;
            });
          }
          return state;
        }
        function statsReducer(state, action) {
          if (state === undefined) state = { dispatches: 0, lastType: "NONE" };
          return { dispatches: state.dispatches + 1, lastType: action.type };
        }
        var rootReducer = combineReducers({ todos: todosReducer, stats: statsReducer });
        var auditMiddleware = function(storeApi) {
          return function(next) {
            return function(action) {
              if (action && typeof action.text === "string") {
                action = { type: action.type, text: action.text.trim(), id: action.id };
              }
              return next(action);
            };
          };
        };
        var bootStore = createStore(rootReducer, compose(applyMiddleware(auditMiddleware)));
        bootStore.dispatch({ type: "ADD_TODO", text: "  build corpus  " });
        bootStore.dispatch({ type: "ADD_TODO", text: "measure startup" });
        bootStore.dispatch({ type: "TOGGLE_TODO", id: 1 });
        var root = ${ROOT_EXPR};
        root.ReduxBench = {
          bootSnapshot: bootStore.getState(),
          runScenario: function(extraTexts) {
            var s = createStore(rootReducer, applyMiddleware(auditMiddleware));
            for (var i = 0; i < extraTexts.length; i++) {
              s.dispatch({ type: "ADD_TODO", text: extraTexts[i] });
            }
            s.dispatch({ type: "TOGGLE_TODO", id: 2 });
            return s.getState();
          }
        };
      `;
      const res = esbuild.buildSync({
        stdin: { contents: entry, resolveDir: path.dirname(nmDir) },
        bundle: true,
        format: "iife",
        target: "es2015",
        write: false,
      });
      return res.outputFiles[0].text;
    },
    smokeCode: `(function(root) {
      var rb = root.ReduxBench;
      var next = rb.runScenario(["  alpha ", "beta", "gamma"]);
      return JSON.stringify({
        bootTodos: rb.bootSnapshot.todos,
        bootLast: rb.bootSnapshot.stats.lastType,
        nextTodos: next.todos,
        nextLast: next.stats.lastType
      });
    })`,
  },

  {
    id: "handlebars-app",
    name: "Handlebars (init template compile)",
    kind: "app-workload",
    buildType: "umd+app-init",
    packages: ["handlebars"],
    description:
      "App workload: loads Handlebars compiler+runtime, registers helpers/partials, compiles an invoice template AST to JS, and renders a boot view at module init.",
    build(nmDir) {
      const hb = readPkgFile(nmDir, "handlebars/dist/handlebars.js");
      const appInit = `
;(function(root) {
  var Handlebars = root.Handlebars;
  Handlebars.registerHelper("currency", function(n) {
    return "$" + Number(n).toFixed(2);
  });
  Handlebars.registerHelper("upper", function(s) {
    return String(s).toUpperCase();
  });
  Handlebars.registerPartial("lineItem", "<li>{{upper sku}}: {{qty}} x {{currency unitPrice}}</li>");
  var templateSrc = [
    "<section class=\\"invoice\\" data-id=\\"{{invoiceId}}\\">",
    "  <h1>Invoice for {{customer}}</h1>",
    "  <ul>{{#each lines}}{{> lineItem}}{{/each}}</ul>",
    "  {{#if paid}}<p class=\\"paid\\">PAID</p>{{else}}<p class=\\"due\\">DUE {{currency total}}</p>{{/if}}",
    "</section>"
  ].join("\\n");
  var compiledInvoice = Handlebars.compile(templateSrc);
  var bootHtml = compiledInvoice({
    invoiceId: "INV-100",
    customer: "Acme Corp",
    paid: false,
    total: 319.5,
    lines: [
      { sku: "kb-01", qty: 2, unitPrice: 89.75 },
      { sku: "ms-02", qty: 1, unitPrice: 140.0 }
    ]
  });
  root.HandlebarsApp = {
    bootHtml: bootHtml,
    renderInvoice: compiledInvoice
  };
})(${ROOT_EXPR});
`;
      return hb + "\n" + appInit;
    },
    smokeCode: `(function(root) {
      var app = root.HandlebarsApp;
      var dyn = app.renderInvoice({
        invoiceId: "INV-205",
        customer: "Globex",
        paid: true,
        total: 50,
        lines: [{ sku: "adp-9", qty: 2, unitPrice: 25 }]
      });
      return JSON.stringify({
        bootHtml: app.bootHtml,
        dynHtml: dyn
      });
    })`,
  },

  {
    id: "preact-ssr-app",
    name: "Preact SSR App (init + runtime renderToString)",
    kind: "app-workload",
    buildType: "umd+app-init",
    packages: ["preact", "preact-render-to-string"],
    description:
      "App workload: Preact + preact-render-to-string renders a multi-component documentation dashboard at module init and exposes dynamic SSR at runtime.",
    build(nmDir) {
      const preact = readPkgFile(nmDir, "preact/dist/preact.min.umd.js");
      const prts = readPkgFile(nmDir, "preact-render-to-string/dist/index.umd.js");
      const appInit = `
;(function(root) {
  var h = root.preact.h;
  var renderToString = root.preactRenderToString.renderToString;
  function Nav(props) {
    return h("nav", { class: "top-nav" }, props.links.map(function(l) {
      return h("a", { key: l.href, href: l.href, class: l.active ? "is-active" : "" }, l.label);
    }));
  }
  function MetricCard(props) {
    return h("article", { class: "metric metric-" + props.trend },
      h("h3", null, props.name),
      h("strong", null, String(props.value) + props.unit),
      h("span", null, "tags:" + props.tags.join(","))
    );
  }
  function Dashboard(props) {
    return h("main", { id: "dashboard", "data-env": props.env },
      h(Nav, { links: props.links }),
      h("section", { class: "grid" }, props.metrics.map(function(m) {
        return h(MetricCard, Object.assign({ key: m.name }, m));
      }))
    );
  }
  var bootHtml = renderToString(h(Dashboard, {
    env: "prod",
    links: [
      { href: "/", label: "Overview", active: true },
      { href: "/traces", label: "Traces", active: false },
      { href: "/alerts", label: "Alerts", active: false }
    ],
    metrics: [
      { name: "Cold Start", value: 14.2, unit: "ms", trend: "down", tags: ["v8", "init"] },
      { name: "Bundle Gzip", value: 42, unit: "KB", trend: "flat", tags: ["size"] },
      { name: "Throughput", value: 1280, unit: "rps", trend: "up", tags: ["http", "ssr"] }
    ]
  }));
  root.PreactSSRApp = {
    bootHtml: bootHtml,
    renderDashboard: function(env, metrics) {
      return renderToString(h(Dashboard, {
        env: env,
        links: [{ href: "/" + env, label: env.toUpperCase(), active: true }],
        metrics: metrics
      }));
    }
  };
})(${ROOT_EXPR});
`;
      return preact + "\n;\n" + prts + "\n" + appInit;
    },
    smokeCode: `(function(root) {
      var app = root.PreactSSRApp;
      var dyn = app.renderDashboard("staging", [
        { name: "Latency", value: 9.5, unit: "ms", trend: "down", tags: ["p50"] }
      ]);
      return JSON.stringify({
        bootHtml: app.bootHtml,
        dynHtml: dyn
      });
    })`,
  },

  {
    id: "react-ssr-app",
    name: "React 18 SSR App (init + runtime renderToString)",
    kind: "app-workload",
    buildType: "umd+app-init",
    packages: ["react", "react-dom"],
    description:
      "App workload: React 18 + ReactDOMServer legacy browser bundle renders a multi-component storefront catalog at module init and serves runtime SSR.",
    build(nmDir) {
      const react = readPkgFile(nmDir, "react/umd/react.production.min.js");
      const rds = readPkgFile(nmDir, "react-dom/umd/react-dom-server-legacy.browser.production.min.js");
      const appInit = `
;(function(root) {
  var h = root.React.createElement;
  var renderToString = root.ReactDOMServer.renderToString;
  var CurrencyCtx = root.React.createContext("USD");
  function StatusPill(props) {
    return h("span", { className: "pill pill-" + (props.inStock ? "ok" : "wait") },
      props.inStock ? "In Stock" : "Backorder"
    );
  }
  function ProductRow(props) {
    return h(CurrencyCtx.Consumer, null, function(ccy) {
      return h("tr", null,
        h("td", null, props.item.sku),
        h("td", null, props.item.title),
        h("td", null, ccy + " " + props.item.price.toFixed(2)),
        h("td", null, h(StatusPill, { inStock: props.item.inStock }))
      );
    });
  }
  function Storefront(props) {
    var total = props.items.reduce(function(acc, it) { return acc + it.price; }, 0);
    var availableCount = props.items.filter(function(it) { return it.inStock; }).length;
    return h(CurrencyCtx.Provider, { value: props.currency },
      h("div", { id: "storefront", "data-region": props.region },
        h("header", null, h("h1", null, props.heading), h("p", null, availableCount + " ready to ship")),
        h("table", null,
          h("tbody", null, props.items.map(function(it) {
            return h(ProductRow, { key: it.sku, item: it });
          }))
        ),
        h("footer", null, "Subtotal (" + props.currency + "): " + total.toFixed(2))
      )
    );
  }
  var bootItems = [
    { sku: "KB-87", title: "Mechanical Keyboard", price: 119.0, inStock: true },
    { sku: "MN-27", title: "27in 4K Display", price: 349.5, inStock: false },
    { sku: "MS-03", title: "Wireless Trackball", price: 54.25, inStock: true },
    { sku: "DK-12", title: "Thunderbolt Dock", price: 189.0, inStock: true }
  ];
  var bootHtml = renderToString(h(Storefront, {
    region: "us-east",
    currency: "USD",
    heading: "Hardware Catalog",
    items: bootItems
  }));
  root.ReactSSRApp = {
    bootHtml: bootHtml,
    renderCatalog: function(region, currency, heading, items) {
      return renderToString(h(Storefront, {
        region: region,
        currency: currency,
        heading: heading,
        items: items
      }));
    }
  };
})(${ROOT_EXPR});
`;
      return react + "\n;\n" + rds + "\n" + appInit;
    },
    smokeCode: `(function(root) {
      var app = root.ReactSSRApp;
      var dyn = app.renderCatalog("eu-west", "EUR", "Accessories", [
        { sku: "CB-01", title: "Braided USB-C Cable", price: 14.5, inStock: true },
        { sku: "ST-04", title: "Aluminum Stand", price: 42.0, inStock: false }
      ]);
      return JSON.stringify({
        bootHtml: app.bootHtml,
        dynHtml: dyn
      });
    })`,
  },

  {
    id: "yaml-router-app",
    name: "YAML Config + Mustache + Router App",
    kind: "app-workload",
    buildType: "umd+app-init",
    packages: ["js-yaml", "mustache"],
    description:
      "Init-heavy app workload: parses a 95-line YAML service/route manifest with js-yaml, compiles 10 parameterized REST routes into RegExps, and pre-parses Mustache views at module init.",
    build(nmDir) {
      const yaml = readPkgFile(nmDir, "js-yaml/dist/js-yaml.js");
      const mustache = readPkgFile(nmDir, "mustache/mustache.js");
      const appInit = `
;(function(root) {
  var jsyaml = root.jsyaml;
  var Mustache = root.Mustache;
  var manifestYaml = [
    "service:",
    "  name: edge-gateway",
    "  version: 2.4.0",
    "  defaults:",
    "    cacheTtl: 120",
    "    rateLimit: 500",
    "    corsOrigins:",
    "      - https://app.example.com",
    "      - https://admin.example.com",
    "templates:",
    "  ok: '[{{status}}] {{route}} -> {{service}} ({{paramsJson}}) ttl={{ttl}}'",
    "  notFound: '[404] No route for {{method}} {{path}}'",
    "  summary: 'Gateway {{name}}@{{version}}: {{routeCount}} routes across {{serviceCount}} upstreams'",
    "upstreams:",
    "  auth:",
    "    host: auth.internal",
    "    port: 8081",
    "    retries: 2",
    "  catalog:",
    "    host: catalog.internal",
    "    port: 8082",
    "    retries: 3",
    "  billing:",
    "    host: billing.internal",
    "    port: 8083",
    "    retries: 1",
    "  analytics:",
    "    host: analytics.internal",
    "    port: 8084",
    "    retries: 0",
    "routes:",
    "  - method: GET",
    "    pattern: /health",
    "    upstream: auth",
    "    ttl: 5",
    "  - method: POST",
    "    pattern: /v1/login",
    "    upstream: auth",
    "    ttl: 0",
    "  - method: GET",
    "    pattern: /v1/users/:userId",
    "    upstream: auth",
    "    ttl: 60",
    "  - method: GET",
    "    pattern: /v1/users/:userId/orgs/:orgId",
    "    upstream: auth",
    "    ttl: 90",
    "  - method: GET",
    "    pattern: /v1/products",
    "    upstream: catalog",
    "    ttl: 300",
    "  - method: GET",
    "    pattern: /v1/products/:sku",
    "    upstream: catalog",
    "    ttl: 300",
    "  - method: GET",
    "    pattern: /v1/categories/:cat/items/:sku",
    "    upstream: catalog",
    "    ttl: 180",
    "  - method: POST",
    "    pattern: /v1/invoices/:invoiceId/pay",
    "    upstream: billing",
    "    ttl: 0",
    "  - method: GET",
    "    pattern: /v1/invoices/:invoiceId",
    "    upstream: billing",
    "    ttl: 30",
    "  - method: POST",
    "    pattern: /v1/events/:stream",
    "    upstream: analytics",
    "    ttl: 0"
  ].join("\\n");

  var config = jsyaml.load(manifestYaml);
  Mustache.parse(config.templates.ok);
  Mustache.parse(config.templates.notFound);
  Mustache.parse(config.templates.summary);

  var compiledRoutes = config.routes.map(function(r) {
    var keys = [];
    var regexSrc = "^" + r.pattern.replace(/:([A-Za-z0-9_]+)/g, function(_, key) {
      keys.push(key);
      return "([^/]+)";
    }) + "$";
    var up = config.upstreams[r.upstream];
    return {
      method: r.method,
      pattern: r.pattern,
      re: new RegExp(regexSrc),
      keys: keys,
      endpoint: up.host + ":" + up.port,
      retries: up.retries,
      ttl: r.ttl != null ? r.ttl : config.service.defaults.cacheTtl
    };
  });

  var bootSummary = Mustache.render(config.templates.summary, {
    name: config.service.name,
    version: config.service.version,
    routeCount: compiledRoutes.length,
    serviceCount: Object.keys(config.upstreams).length
  });

  function dispatch(method, pathStr) {
    for (var i = 0; i < compiledRoutes.length; i++) {
      var rt = compiledRoutes[i];
      if (rt.method !== method) continue;
      var m = rt.re.exec(pathStr);
      if (m) {
        var params = {};
        for (var j = 0; j < rt.keys.length; j++) {
          params[rt.keys[j]] = decodeURIComponent(m[j + 1]);
        }
        return Mustache.render(config.templates.ok, {
          status: 200,
          route: rt.method + " " + rt.pattern,
          service: rt.endpoint,
          paramsJson: JSON.stringify(params),
          ttl: rt.ttl
        });
      }
    }
    return Mustache.render(config.templates.notFound, { method: method, path: pathStr });
  }

  root.YamlRouterApp = {
    bootSummary: bootSummary,
    corsOrigins: config.service.defaults.corsOrigins,
    dispatch: dispatch,
    dumpNormalized: function(obj) { return jsyaml.dump(obj, { sortKeys: true }).trim(); }
  };
})(${ROOT_EXPR});
`;
      return yaml + "\n;\n" + mustache + "\n" + appInit;
    },
    smokeCode: `(function(root) {
      var app = root.YamlRouterApp;
      return JSON.stringify({
        summary: app.bootSummary,
        cors: app.corsOrigins,
        r1: app.dispatch("GET", "/v1/users/42/orgs/acme"),
        r2: app.dispatch("GET", "/v1/categories/keyboards/items/KB-87"),
        r3: app.dispatch("POST", "/v1/invoices/inv_99/pay"),
        r4: app.dispatch("DELETE", "/v1/unknown"),
        dumped: app.dumpNormalized({ z: [1, 2], a: true })
      });
    })`,
  },

  {
    id: "moment-timezone",
    name: "Moment Timezone (full IANA data)",
    kind: "library",
    tier: "large",
    buildType: "umd",
    packages: ["moment", "moment-timezone"],
    description:
      "Moment core + full Moment Timezone data (~0.91 MB); module init unpacks base-60 IANA transition tables and links for 590+ timezones.",
    build(nmDir) {
      return (
        readPkgFile(nmDir, "moment/moment.js") +
        "\n;\n" +
        readPkgFile(nmDir, "moment-timezone/builds/moment-timezone-with-data.js")
      );
    },
    smokeCode: `(function(root) {
      var moment = root.moment;
      var zones = ["America/New_York", "Europe/London", "Asia/Tokyo", "Australia/Sydney", "Asia/Kolkata", "Pacific/Auckland"];
      var winterUtc = "2026-01-15T18:30:00Z";
      var summerUtc = "2026-07-15T18:30:00Z";
      var conversions = zones.map(function(z) {
        var w = moment.tz(winterUtc, z);
        var s = moment.tz(summerUtc, z);
        return {
          zone: z,
          winter: w.format("YYYY-MM-DD HH:mm:ss z (Z)"),
          winterDst: w.isDST(),
          summer: s.format("YYYY-MM-DD HH:mm:ss z (Z)"),
          summerDst: s.isDST()
        };
      });
      var beforeSpringForward = moment.tz("2026-03-08T06:30:00Z", "America/New_York");
      var afterSpringForward = beforeSpringForward.clone().add(1, "hour");
      var hopped = afterSpringForward.clone().tz("Asia/Tokyo");
      return JSON.stringify({
        tzVersion: moment.tz.version,
        dataVersion: moment.tz.dataVersion,
        zoneCount: moment.tz.names().length,
        conversions: conversions,
        springBefore: beforeSpringForward.format("YYYY-MM-DD HH:mm z"),
        springAfter: afterSpringForward.format("YYYY-MM-DD HH:mm z"),
        hoppedTokyo: hopped.format("YYYY-MM-DD HH:mm z")
      });
    })`,
  },

  {
    id: "prettier",
    name: "Prettier Standalone (+ Babel, PostCSS, HTML parsers)",
    kind: "library",
    tier: "large",
    buildType: "umd",
    packages: ["prettier"],
    description:
      "Prettier standalone formatter bundled with Babel, PostCSS, and HTML parser plugins (~1.07 MB); builds printer AST dispatchers and parser grammars at init.",
    build(nmDir) {
      const files = [
        "prettier/standalone.js",
        "prettier/parser-babel.js",
        "prettier/parser-postcss.js",
        "prettier/parser-html.js",
      ];
      return files.map(f => readPkgFile(nmDir, f)).join("\n;\n");
    },
    smokeCode: `(function(root) {
      var prettier = root.prettier;
      var plugins = root.prettierPlugins;
      var jsInput = "const compute=({items,taxRate=0.08})=>items.filter(x=>x.qty>0).map((it,idx)=>({idx,sku:it.sku,gross:+(it.qty*it.price*(1+taxRate)).toFixed(2)}));";
      var cssInput = ".card-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card-grid>.item:hover{color:#336699;transform:translateY(-2px)}";
      var htmlInput = "<section class='hero' data-mode='dark'><h1>  Prepack   Benchmark </h1><p>Fast <strong>startup</strong> &amp; compact bundles.</p></section>";
      var jsFormatted = prettier.format(jsInput, {
        parser: "babel",
        plugins: plugins,
        printWidth: 68,
        singleQuote: true,
        trailingComma: "all"
      });
      var cssFormatted = prettier.format(cssInput, {
        parser: "css",
        plugins: plugins,
        printWidth: 68
      });
      var htmlFormatted = prettier.format(htmlInput, {
        parser: "html",
        plugins: plugins,
        printWidth: 68
      });
      return JSON.stringify({
        version: prettier.version,
        js: jsFormatted,
        css: cssFormatted,
        html: htmlFormatted
      });
    })`,
  },

  {
    id: "highlight-js",
    name: "Highlight.js (all 190+ languages)",
    kind: "library",
    tier: "large",
    buildType: "esbuild-iife",
    packages: ["highlight.js"],
    description:
      "Full Highlight.js syntax highlighter (~1.72 MB ES2015 IIFE); module init registers all 193 language grammar factories and freezes core tables.",
    build(nmDir, esbuild) {
      const entry = `
        import hljs from "highlight.js";
        (${ROOT_EXPR}).hljs = hljs;
      `;
      const res = esbuild.buildSync({
        stdin: { contents: entry, resolveDir: path.dirname(nmDir) },
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2015",
        write: false,
      });
      return res.outputFiles[0].text;
    },
    smokeCode: `(function(root) {
      var hljs = root.hljs;
      var snippets = [
        ["javascript", "export async function fetchJson(url) { const res = await fetch(url); return { ok: res.ok, status: 200 }; }"],
        ["python", "@dataclass\\nclass Vector:\\n    x: float\\n    y: float\\n    def norm(self) -> float:\\n        return (self.x ** 2 + self.y ** 2) ** 0.5"],
        ["rust", "pub fn sum_even(xs: &[i64]) -> i64 { xs.iter().copied().filter(|n| n % 2 == 0).sum() }"],
        ["sql", "SELECT dept, COUNT(*) AS cnt, AVG(salary) AS avg_sal FROM employees WHERE active = TRUE GROUP BY dept HAVING COUNT(*) > 5;"],
        ["xml", "<manifest version=\\"1.0\\"><service name=\\"gateway\\" port=\\"8080\\"><tls enabled=\\"true\\"/></service></manifest>"]
      ];
      var highlighted = snippets.map(function(pair) {
        var r = hljs.highlight(pair[1], { language: pair[0], ignoreIllegals: true });
        return { lang: pair[0], relevance: r.relevance, html: r.value };
      });
      var auto = hljs.highlightAuto("fn main() { let mut v: Vec<u32> = vec![1, 2, 3]; println!(\\"{:?}\\", v); }", ["rust", "javascript", "python", "cpp"]);
      return JSON.stringify({
        version: hljs.versionString,
        languageCount: hljs.listLanguages().length,
        tsAliases: hljs.getLanguage("typescript").aliases,
        highlighted: highlighted,
        autoLang: auto.language,
        autoRelevance: auto.relevance
      });
    })`,
  },

  {
    id: "three",
    name: "Three.js (math + scene graph)",
    kind: "library",
    tier: "large",
    buildType: "esbuild-iife",
    packages: ["three"],
    description:
      "Three.js 3D engine (~1.90 MB ES2015 IIFE); module init constructs math LUTs, color management spaces, shader chunks, uniform libraries, and geometry/material classes.",
    build(nmDir, esbuild) {
      const entry = `
        import * as THREE from "three";
        (${ROOT_EXPR}).THREE = THREE;
      `;
      const res = esbuild.buildSync({
        stdin: { contents: entry, resolveDir: path.dirname(nmDir) },
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2015",
        write: false,
      });
      return res.outputFiles[0].text;
    },
    smokeCode: `(function(root) {
      var THREE = root.THREE;
      var round6 = function(n) {
        return Math.abs(n) < 1e-12 ? 0 : Math.round(n * 1000000) / 1000000;
      };
      var pos = new THREE.Vector3(3, -4, 12);
      var quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      var scale = new THREE.Vector3(2, 2, 2);
      var m4 = new THREE.Matrix4().compose(pos, quat, scale);
      var inv = m4.clone().invert();
      var identCheck = m4.clone().multiply(inv);
      var transformed = new THREE.Vector3(1, 0, 0).applyMatrix4(m4);

      var ray = new THREE.Ray(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
      var box = new THREE.Box3(new THREE.Vector3(-2, -2, -2), new THREE.Vector3(2, 2, 2));
      var hit = ray.intersectBox(box, new THREE.Vector3());

      var scene = new THREE.Scene();
      scene.name = "bench-scene";
      var rig = new THREE.Group();
      rig.name = "rig";
      rig.position.set(10, 5, -3);
      rig.rotation.set(0, Math.PI / 4, 0);

      var boxGeo = new THREE.BoxGeometry(2, 4, 6);
      var stdMat = new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.4, metalness: 0.2 });
      var crate = new THREE.Mesh(boxGeo, stdMat);
      crate.name = "crate";
      crate.position.set(1, 2, 3);
      rig.add(crate);

      var sphereGeo = new THREE.SphereGeometry(1.5, 8, 6);
      var basicMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, wireframe: true });
      var orb = new THREE.Mesh(sphereGeo, basicMat);
      orb.name = "orb";
      orb.position.set(-2, 0.5, 1);
      rig.add(orb);

      var sun = new THREE.DirectionalLight(0xffffff, 1.25);
      sun.name = "sun";
      sun.position.set(5, 10, 7);
      scene.add(rig);
      scene.add(sun);
      scene.updateMatrixWorld(true);

      var cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
      cam.position.set(0, 8, 20);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      var crateWorld = crate.getWorldPosition(new THREE.Vector3());
      var crateNdc = crateWorld.clone().project(cam);

      var uuidMap = {};
      var uuidSeq = 0;
      var uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      function canonicalize(val) {
        if (typeof val === "string") {
          if (uuidRe.test(val)) {
            if (!uuidMap[val]) uuidMap[val] = "uuid-" + (++uuidSeq);
            return uuidMap[val];
          }
          return val;
        }
        if (typeof val === "number") return round6(val);
        if (Array.isArray(val)) return val.map(canonicalize);
        if (val && typeof val === "object") {
          var out = {};
          var keys = Object.keys(val);
          for (var i = 0; i < keys.length; i++) {
            out[keys[i]] = canonicalize(val[keys[i]]);
          }
          return out;
        }
        return val;
      }
      var serialized = canonicalize(scene.toJSON());

      return JSON.stringify({
        revision: THREE.REVISION,
        det: round6(m4.determinant()),
        identDiag: [round6(identCheck.elements[0]), round6(identCheck.elements[5]), round6(identCheck.elements[10]), round6(identCheck.elements[15])],
        transformed: [round6(transformed.x), round6(transformed.y), round6(transformed.z)],
        rayHit: hit ? [round6(hit.x), round6(hit.y), round6(hit.z)] : null,
        crateWorld: [round6(crateWorld.x), round6(crateWorld.y), round6(crateWorld.z)],
        crateNdc: [round6(crateNdc.x), round6(crateNdc.y), round6(crateNdc.z)],
        geoCount: serialized.geometries.length,
        matCount: serialized.materials.length,
        childNames: serialized.object.children.map(function(c) { return c.name + ":" + c.type; }),
        rigMatrix: serialized.object.children[0].matrix
      });
    })`,
  },

  {
    id: "mathjs",
    name: "mathjs (eager typed-function registry)",
    kind: "library",
    tier: "large",
    buildType: "esbuild-iife",
    packages: ["mathjs"],
    description:
      "Init-heavy math engine (~2.11 MB IIFE); module init constructs 300+ multi-signature functions via typed-function, unit tables, physical constants, and expression algebra.",
    build(nmDir, esbuild) {
      const entry = `
        import * as mathNs from "mathjs";
        const math = Object.assign({}, mathNs);
        (${ROOT_EXPR}).math = math;
      `;
      const res = esbuild.buildSync({
        stdin: { contents: entry, resolveDir: path.dirname(nmDir) },
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2020",
        write: false,
      });
      return res.outputFiles[0].text;
    },
    smokeCode: `(function(root) {
      var m = root.math;
      var round6 = function(n) { return Math.round(n * 1000000) / 1000000; };
      var matA = [[4, 2, 1], [0, 3, -1], [2, 1, 5]];
      var solved = m.lusolve(matA, [9, 4, 17]).valueOf().map(function(row) { return round6(row[0]); });
      var invA = m.inv(matA).map(function(row) { return row.map(round6); });
      var quad = m.compile("a * x^2 + b * x + c");
      var fracSum = m.add(m.fraction(1, 3), m.fraction(1, 6));
      return JSON.stringify({
        version: m.version,
        det: round6(m.det(matA)),
        solved: solved,
        invRow0: invA[0],
        deriv: m.derivative("x^3 + 2*x^2 - 5*x + 7", "x").toString(),
        simplified: m.simplify("2 * x + 3 * x + x^2 / x").toString(),
        quadAt4: quad.evaluate({ a: 2, b: -3, c: 5, x: 4 }),
        complexProd: m.evaluate("(2 + 3i) * (4 - 5i)").toString(),
        fraction: fracSum.n + "/" + fracSum.d,
        inches: round6(m.unit("5.08 cm").toNumber("inch"))
      });
    })`,
  },

  {
    id: "babel-standalone",
    name: "@babel/standalone (preset-env + preset-react)",
    kind: "library",
    tier: "large",
    buildType: "umd",
    packages: ["@babel/standalone"],
    description:
      "Standalone Babel 7 compiler (~5.25 MB UMD); module init registers @babel/parser, @babel/traverse, @babel/generator, core-js compat tables, 100+ plugins, and built-in presets.",
    build(nmDir) {
      return readPkgFile(nmDir, "@babel/standalone/babel.js");
    },
    smokeCode: `(function(root) {
      var Babel = root.Babel;
      var snippet = [
        "class Acc {",
        "  constructor(base = 10) { this.base = base; }",
        "  compute(xs, ...extra) {",
        "    const all = [...xs, ...extra];",
        "    return all.reduce((sum, item) => sum + ((item?.val ?? 1) ** 2), this.base);",
        "  }",
        "}",
        "export const renderBadge = ({ label, count = 0 }) => <span className='badge'>{\`\${label}:\${count}\`}</span>;"
      ].join("\\n");
      var transformed = Babel.transform(snippet, {
        filename: "sample.jsx",
        presets: [
          ["env", { targets: { ie: "11" }, modules: "commonjs" }],
          ["react", { runtime: "classic" }]
        ],
        ast: true,
        comments: false
      });
      return JSON.stringify({
        version: Babel.version,
        presetCount: Object.keys(Babel.availablePresets).length,
        pluginCount: Object.keys(Babel.availablePlugins).length,
        topNodeTypes: transformed.ast.program.body.map(function(n) { return n.type; }),
        code: transformed.code
      });
    })`,
  },

  {
    id: "typescript",
    name: "TypeScript Compiler (lib/typescript.js)",
    kind: "library",
    tier: "large",
    buildType: "standalone-script",
    packages: ["typescript"],
    description:
      "Full TypeScript 5.9 compiler (~8.90 MB standalone script); module init constructs scanner/parser/binder/checker/emitter dispatch tables, token maps, and diagnostic catalogs.",
    build(nmDir) {
      return (
        readPkgFile(nmDir, "typescript/lib/typescript.js") +
        `\n;if (typeof ts !== "undefined") ${ROOT_EXPR}.ts = ts;\n`
      );
    },
    smokeCode: `(function(root) {
      var ts = root.ts;
      var src = [
        "export const enum Priority { Low = 1, Medium = 2, High = 3 }",
        "export interface Task<T = string> { readonly id: number; payload: T; priority?: Priority; }",
        "export class Queue<T> {",
        "  private items: Task<T>[] = [];",
        "  constructor(public readonly name: string) {}",
        "  enqueue(task: Task<T>): number {",
        "    this.items.push({ ...task, priority: task.priority ?? Priority.Medium });",
        "    return this.items.length;",
        "  }",
        "  highCount(): number {",
        "    return this.items.filter(t => t.priority === Priority.High).length;",
        "  }",
        "}"
      ].join("\\n");
      var transpiled = ts.transpileModule(src, {
        fileName: "queue.ts",
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2017,
          strict: true
        }
      });
      var sf = ts.createSourceFile("queue.ts", src, ts.ScriptTarget.ES2022, true);
      var nodeCount = 0;
      var identCount = 0;
      function visit(node) {
        nodeCount++;
        if (ts.isIdentifier(node)) identCount++;
        ts.forEachChild(node, visit);
      }
      visit(sf);
      return JSON.stringify({
        version: ts.version,
        diagCount: transpiled.diagnostics ? transpiled.diagnostics.length : 0,
        stmtKinds: sf.statements.map(function(s) { return ts.SyntaxKind[s.kind]; }),
        nodeCount: nodeCount,
        identCount: identCount,
        outputText: transpiled.outputText
      });
    })`,
  },
];

module.exports = { SPECS };
