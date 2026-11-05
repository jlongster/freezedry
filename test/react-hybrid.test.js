"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { specialize, assertSame } = require("./helpers/react-app");
const { instrument } = require("../react/instrument");

const HEADER = 'var React = require("react");\nvar h = React.createElement;\n';

describe("react-hybrid: specialization basics", () => {
  it("text, attributes, escaping and <!-- --> separators come from the template", () => {
    const src = `${HEADER}
function App(props) {
  var d = props.data;
  return h("div", { className: "c " + d.cls, title: d.title, "data-n": d.n },
    "Hello ", d.name, " ", d.last, "!", h("b", null, d.n));
}
module.exports = App;`;
    const train = [
      { cls: "a", title: "t", n: 1, name: "Ada", last: "L" },
      { cls: "b", title: "<x>", n: 2.5, name: "", last: "&" },
    ];
    const r = specialize(src, train);
    assert.equal(r.stats.disabled, null);
    const fb = assertSame(r, [
      ...train,
      { cls: "\"'", title: "", n: -0, name: "x", last: "" },
      { cls: "z", title: "javascript:x", n: NaN, name: "😀", last: "y" },
      { cls: "z", title: 7, n: 1e21, name: 0, last: 5 },
    ]);
    assert.equal(fb, 0, "string/number values never need a fallback");
  });

  it("guards boolean/nullish attribute values and unknown types fall back", () => {
    const src = `${HEADER}
function App(props) {
  var d = props.data;
  return h("input", { type: "checkbox", disabled: d.dis, "data-x": d.x, defaultChecked: d.on, value: d.v });
}
module.exports = App;`;
    const train = [
      { dis: true, x: "a", on: false, v: "1" },
      { dis: undefined, x: false, on: true, v: 2 },
    ];
    const r = specialize(src, train);
    assertSame(r, [
      ...train,
      { dis: null, x: null, on: null, v: null },
      { dis: "yes", x: true, on: 0, v: true },
      { dis: {}, x: [], on: "x", v: {} },
    ]);
  });

  it("conditionals: untraced branches fall back, traced ones do not", () => {
    const src = `${HEADER}
function Badge(props) { return props.n > 5 ? h("i", null, "many ", props.n) : props.n > 0 ? h("i", null, "few") : null; }
function App(props) { return h("p", null, h(Badge, { n: props.data.n }), props.data.ok ? "yes" : "no"); }
module.exports = App;`;
    const r = specialize(src, [
      { n: 9, ok: true },
      { n: 3, ok: false },
    ]);
    assert.equal(assertSame(r, [{ n: 10, ok: false }, { n: 1, ok: true }]), 0);
    assert.equal(assertSame(r, [{ n: 0, ok: true }]), 1, "n <= 0 was never traced");
  });

  it("lists: map callbacks become loops over any length", () => {
    const src = `${HEADER}
function Item(props) { return h("li", { className: props.active ? "on" : "off" }, props.item.label, " (", props.item.count, ")"); }
function App(props) {
  var d = props.data;
  if (!d.items.length) return h("p", null, "empty");
  return h("ul", null, d.items.map(function (it, i) {
    return h(Item, { key: it.id, item: it, active: it.id === d.sel });
  }));
}
module.exports = App;`;
    const mk = (n) => ({ sel: "i1", items: Array.from({ length: n }, (_, i) => ({ id: "i" + i, label: "L<" + i, count: i })) });
    const r = specialize(src, [mk(0), mk(1), mk(2)]);
    assert.equal(assertSame(r, [mk(0), mk(5), mk(37)]), 0);
    assertSame(r, [{ sel: "x", items: "not an array" }, { sel: "x", items: [null] }]);
  });

  it("useId inside nested lists reproduces React's tree ids", () => {
    const src = `${HEADER}
function Opt(props) { var id = React.useId(); return h("label", { htmlFor: id }, props.o); }
function Group(props) { var id = React.useId(); return h("fieldset", { id: id }, props.g.map(function (o) { return h(Opt, { key: o, o: o }); })); }
function App(props) { return h("form", null, h("h1", null, "x"), props.data.groups.map(function (g, i) { return h(Group, { key: i, g: g }); })); }
module.exports = App;`;
    const r = specialize(src, [{ groups: [["a"], ["b", "c"]] }, { groups: [] }]);
    const big = { groups: Array.from({ length: 40 }, (_, i) => Array.from({ length: (i % 7) + 1 }, (_, j) => `o${i}-${j}`)) };
    assert.equal(assertSame(r, [big, { groups: [["x", "y", "z"]] }]), 0);
  });

  it("context, useMemo, props spreading and style objects", () => {
    const src = `${HEADER}
var Theme = React.createContext("light");
function Btn(props) {
  var theme = React.useContext(Theme);
  var p = Object.assign({}, props.extra, { className: "btn btn-" + theme, disabled: Boolean(props.off) });
  return h("button", p, props.children);
}
function App(props) {
  var d = props.data;
  var total = React.useMemo(function () { var s = 0; for (var i = 0; i < d.xs.length; i++) s += d.xs[i]; return s; }, [d.xs]);
  return h(Theme.Provider, { value: d.theme },
    h("div", { style: { width: d.w, opacity: d.o, color: d.c } }, h(Btn, { extra: d.extra, off: d.off }, "Total ", total)));
}
module.exports = App;`;
    const train = [
      { theme: "dark", xs: [1, 2], w: 10, o: 0.5, c: "red", extra: { "data-a": "1" }, off: false },
      { theme: "light", xs: [], w: 3, o: 1, c: " blue ", extra: { "data-a": "2" }, off: true },
    ];
    const r = specialize(src, train);
    assert.equal(assertSame(r, [{ theme: "x<", xs: [5], w: 7, o: 0.25, c: "#fff", extra: { "data-a": "&" }, off: 1 }]), 0);
    // A different key set in the spread object, or a zero/empty style value, needs another path.
    assert.equal(assertSame(r, [Object.assign({}, train[0], { extra: { "data-b": "1" } })]), 1);
    assert.equal(assertSame(r, [Object.assign({}, train[0], { w: 0 })]), 1);
    assertSame(r, [Object.assign({}, train[0], { c: "" }), Object.assign({}, train[0], { extra: null })]);
  });

  it("calls the app's own pure helpers at runtime instead of re-implementing them", () => {
    const src = `${HEADER}
function money(x) { return "$" + x.toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ","); }
function App(props) { return h("span", null, money(props.data.amount)); }
module.exports = App;`;
    const r = specialize(src, [{ amount: 1 }, { amount: 1234.5 }]);
    assert.match(r.code, /money\(/);
    assert.equal(assertSame(r, [{ amount: 9876543.21 }, { amount: -3 }]), 0);
    assertSame(r, [{ amount: "7" }, { amount: null }]);
  });

  it("dangerouslySetInnerHTML and constant <select defaultValue> subtrees", () => {
    const src = `${HEADER}
function App(props) {
  var d = props.data;
  return h("div", null,
    h("span", { dangerouslySetInnerHTML: { __html: d.html } }),
    h("select", { defaultValue: d.sort, name: "s" }, h("option", { value: "a" }, "A"), h("option", { value: "b" }, "B")));
}
module.exports = App;`;
    const r = specialize(src, [
      { html: "<b>x</b>", sort: "a" },
      { html: "", sort: "b" },
    ]);
    assert.equal(assertSame(r, [{ html: "<i>&amp;</i>", sort: "b" }]), 0);
    assert.equal(assertSame(r, [{ html: "y", sort: "c" }]), 1, "untraced select value is pinned by an equality guard");
  });

  it("errors thrown by the app propagate identically through the fallback", () => {
    const src = `${HEADER}
function App(props) { return h("p", null, props.data.user.name); }
module.exports = App;`;
    const r = specialize(src, [{ user: { name: "a" } }]);
    assertSame(r, [{ user: null }, {}, { user: { name: "b" } }]);
  });
});

describe("react-hybrid: soundness boundaries", () => {
  it("impure helpers poison their frames (always fall back there)", () => {
    const src = `${HEADER}
var counter = 0;
function next() { counter++; return counter; }
function App(props) { return h("p", null, props.data.x, " #", next()); }
module.exports = App;`;
    const r = specialize(src, [{ x: "a" }, { x: "b" }]);
    assert.ok(Object.keys(r.stats.poisoned).length > 0 || r.stats.disabled);
    assertSame(r, [{ x: "c" }]);
  });

  it("frames reading a shared object that another frame mutates are not learned", () => {
    const src = `${HEADER}
var cache = { last: "none" };
function Writer(props) { cache.last = props.v; return h("i", null, props.v); }
function Reader() { return h("b", null, cache.last); }
function App(props) { var d = props.data; return h("p", null, h(Reader), d.w ? h(Writer, { v: d.v }) : null); }
module.exports = App;`;
    const r = specialize(src, [{ w: false, v: "a" }, { w: true, v: "b" }]);
    assert.ok(r.stats.poisoned["reads shared mutable object"] >= 1, JSON.stringify(r.stats.poisoned));
    // Reader must fall back: its output depends on what earlier renders wrote.
    assert.equal(assertSame(r, [{ w: false, v: "c" }]), 1);
  });

  it("volatile reads (Math.random, Date) poison the frame", () => {
    const src = `${HEADER}
function App(props) { return h("p", null, props.data.x, Math.random() < 2 ? "!" : "?"); }
module.exports = App;`;
    const r = specialize(src, [{ x: "a" }]);
    assert.ok(Object.values(r.stats.poisoned).length > 0);
    assert.equal(assertSame(r, [{ x: "q" }]), 1);
  });

  it("unsupported syntax disables specialization (pure fallback, still correct)", () => {
    const src = `${HEADER}
class C extends React.Component { render() { return h("p", null, this.props.data.x); } }
module.exports = C;`;
    const r = specialize(src, [{ x: "a" }]);
    assert.ok(r.stats.disabled);
    assertSame(r, [{ x: "z" }]);
  });

  it("non-plain data (getters) is rejected by the opt-in plain-data check", () => {
    const src = `${HEADER}
function App(props) { return h("p", null, props.data.a, props.data.a); }
module.exports = App;`;
    const r = specialize(src, [{ a: "x" }, { a: "" }], { checkPlainData: true });
    assert.equal(assertSame(r, [{ a: "q" }, [], { a: Object.create(null) }].slice(0, 1)), 0);
    let k = 0;
    const tricky = {
      get a() {
        k++;
        return "v" + k;
      },
    };
    // The template reads `a` once per read in the original code, in the same order.
    k = 0;
    const got = r.render(tricky);
    k = 0;
    const { RDS, React, loadApp } = require("./helpers/react-app");
    const want = RDS.renderToString(React.createElement(loadApp(src), { data: tricky }));
    assert.equal(got, want);
  });
});

describe("react-hybrid: instrumenter", () => {
  it("classifies pure helpers and closure variables", () => {
    const { fns } = instrument(`
var T = [1, 2];
var state = {};
function pure(a) { return a + T[0]; }
function writes(a) { state.x = a; return a; }
function usesGlobal() { return Date.now(); }
function outer(xs) { var k = 2; return xs.map(function (x) { return x * k; }); }
module.exports = outer;`);
    const byName = (n) => fns.find((f) => f.name === n);
    assert.equal(byName("pure").pure, true);
    assert.equal(byName("writes").pure, false);
    assert.equal(byName("usesGlobal").pure, false);
    const cb = fns.find((f) => f.parent === byName("outer").fid);
    assert.deepEqual(cb.freeLocals, ["k"]);
  });
});
