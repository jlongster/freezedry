"use strict";

// Source-to-source instrumentation of the (known) app module for concolic tracing.
//
// The app keeps running in V8 with its own semantics; every operation is routed through a hook
// (`__h.*`, see trace.js) that computes the concrete result with the real operator/function and,
// when an operand is symbolic (derived from the unknown request data), also records the symbolic
// expression and every control-flow decision. Functions get a thin wrapper so the tracer can open
// a frame when React calls a component, or when Array#map calls a callback that builds elements.
//
// Also performs the static analyses the tracer and code generator rely on: lexical scopes (to tell
// closure reads apart from locals and module bindings), module bindings that are never reassigned
// (safe to reference by name from generated code), and a conservative purity check that decides
// which functions may be called back opaquely ("call the original helper at runtime").

const acorn = require("acorn");

class InstrumentError extends Error {}

const SAFE_GLOBALS = new Set([
  "Math",
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "JSON",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "undefined",
  "NaN",
  "Infinity",
  "RegExp",
  "encodeURIComponent",
  "encodeURI",
  "decodeURIComponent",
  "decodeURI",
]);
const SAFE_GLOBAL_CALLS = new Set([
  "String",
  "Number",
  "Boolean",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "encodeURI",
  "decodeURIComponent",
  "decodeURI",
]);
const SAFE_STATIC_CALLS = {
  Math: null, // every Math.* except random (checked below)
  Object: new Set(["keys", "values", "entries", "is", "freeze", "getPrototypeOf", "assign"]),
  Array: new Set(["isArray", "from", "of"]),
  JSON: new Set(["stringify", "parse"]),
  Number: new Set(["isFinite", "isInteger", "isNaN", "isSafeInteger", "parseFloat", "parseInt"]),
  String: new Set(["fromCharCode", "fromCodePoint"]),
};
const MUTATOR_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
  "setTime",
  "call",
  "apply",
  "bind",
]);
const COMMONJS_PARAMS = ["exports", "require", "module", "__filename", "__dirname"];

function instrument(source) {
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true });
  } catch (err) {
    throw new InstrumentError(`parse error: ${err.message}`);
  }
  const analysis = analyze(ast, source);
  const gen = new Generator(source, analysis);
  const code = gen.program(ast);
  return {
    code,
    fns: analysis.fns.map((f) => ({
      fid: f.fid,
      parent: f.parent,
      name: f.name,
      kind: f.kind,
      source: f.fid === 0 ? null : source.slice(f.node.start, f.node.end),
      freeLocals: [...f.freeLocals.keys()],
      pure: f.pure,
      moduleLevel: f.parent === 0,
      declaration: !!f.node && f.node.type === "FunctionDeclaration",
    })),
    moduleBindings: analysis.moduleBindings,
    constModuleBindings: analysis.constModuleBindings,
  };
}

// ---------------------------------------------------------------------------------------------
// Scope analysis

function analyze(ast, source) {
  const fns = [];
  const refs = new Map(); // Identifier node -> { decl, write }
  const moduleFn = makeFn(null, -1, "module");
  moduleFn.fid = 0;
  fns.push(moduleFn);
  const fnByNode = new Map();

  function makeFn(node, parent, kind) {
    return {
      fid: fns.length,
      node,
      parent,
      kind,
      name: node && node.id ? node.id.name : null,
      freeLocals: new Map(), // name -> declFid (declared in a strictly enclosing function)
      calls: [],
      impure: null,
      pure: false,
      usesThis: false,
    };
  }

  function makeScope(parent, fid, isFunc) {
    return { parent, fid, isFunc, vars: new Map() };
  }

  function declare(scope, name, info) {
    if (!scope.vars.has(name)) {
      scope.vars.set(name, Object.assign({ name, fid: scope.fid, writes: 0, mutated: false, init: null }, info));
    }
    return scope.vars.get(name);
  }

  function funcScope(scope) {
    while (!scope.isFunc) scope = scope.parent;
    return scope;
  }

  function patternNames(p, out) {
    if (!p) return out;
    switch (p.type) {
      case "Identifier":
        out.push(p);
        break;
      case "AssignmentPattern":
        patternNames(p.left, out);
        break;
      case "RestElement":
        patternNames(p.argument, out);
        break;
      case "ArrayPattern":
        for (const e of p.elements) patternNames(e, out);
        break;
      case "ObjectPattern":
        for (const prop of p.properties) patternNames(prop.type === "RestElement" ? prop : prop.value, out);
        break;
      default:
        break;
    }
    return out;
  }

  // Hoist `var` and function declarations of a function body (not descending into nested functions).
  function hoistVars(node, scope) {
    if (!node || typeof node.type !== "string") return;
    switch (node.type) {
      case "VariableDeclaration":
        if (node.kind === "var") {
          for (const d of node.declarations) {
            for (const id of patternNames(d.id, [])) {
              const v = declare(scope, id.name, { kind: "var" });
              if (d.init && d.id.type === "Identifier") v.init = v.init === null ? d.init : "multi";
            }
          }
        }
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "ClassDeclaration":
      case "ClassExpression":
        return;
      default:
        break;
    }
    for (const child of childNodes(node)) hoistVars(child, scope);
  }

  function hoistLexical(statements, scope) {
    for (const s of statements) {
      if (s.type === "VariableDeclaration" && s.kind !== "var") {
        for (const d of s.declarations) {
          for (const id of patternNames(d.id, [])) {
            const v = declare(scope, id.name, { kind: s.kind });
            if (d.init && d.id.type === "Identifier") v.init = d.init;
          }
        }
      } else if (s.type === "FunctionDeclaration") {
        const v = declare(scope, s.id.name, { kind: "fn" });
        v.init = s;
      } else if (s.type === "ClassDeclaration") {
        declare(scope, s.id.name, { kind: "class" });
      }
    }
  }

  function lookup(scope, name) {
    for (let s = scope; s; s = s.parent) {
      if (s.vars.has(name)) return s.vars.get(name);
    }
    return null;
  }

  let curFn = moduleFn;

  function ref(id, scope, write) {
    const decl = lookup(scope, id.name);
    refs.set(id, { decl, write, fn: curFn.fid });
    if (decl && write) decl.writes++;
    if (decl && decl.fid !== 0 && decl.fid !== curFn.fid) {
      // Closure reference: free in every function between curFn and the declaring function.
      for (let f = curFn; f && f.fid !== decl.fid; f = fns[f.parent]) {
        f.freeLocals.set(id.name, decl.fid);
      }
    }
    return decl;
  }

  function walkFunction(node, scope) {
    const fn = makeFn(node, curFn.fid, node.type === "ArrowFunctionExpression" ? "arrow" : "function");
    fns.push(fn);
    fnByNode.set(node, fn);
    if (node.async || node.generator) {
      fn.impure = "async/generator";
    }
    const outer = curFn;
    let fscope = scope;
    if (node.type === "FunctionExpression" && node.id) {
      fscope = makeScope(scope, outer.fid, false);
      declare(fscope, node.id.name, { kind: "fnexpr", fid: fn.fid }).init = node;
    }
    const s = makeScope(fscope, fn.fid, true);
    curFn = fn;
    for (const p of node.params) for (const id of patternNames(p, [])) declare(s, id.name, { kind: "param" });
    if (node.type !== "ArrowFunctionExpression") declare(s, "arguments", { kind: "arguments" });
    if (node.body.type === "BlockStatement") {
      hoistVars(node.body, s);
      hoistLexical(node.body.body, s);
    }
    for (const p of node.params) walkPattern(p, s, true);
    if (node.body.type === "BlockStatement") {
      for (const st of node.body.body) walk(st, s);
    } else {
      walk(node.body, s);
    }
    curFn = outer;
  }

  function walkPattern(p, scope, isDecl) {
    if (!p) return;
    switch (p.type) {
      case "Identifier":
        if (!isDecl) ref(p, scope, true);
        else refs.set(p, { decl: lookup(scope, p.name), write: true, fn: curFn.fid, declaration: true });
        break;
      case "AssignmentPattern":
        walkPattern(p.left, scope, isDecl);
        walk(p.right, scope);
        break;
      case "RestElement":
        walkPattern(p.argument, scope, isDecl);
        break;
      case "ArrayPattern":
        for (const e of p.elements) walkPattern(e, scope, isDecl);
        break;
      case "ObjectPattern":
        for (const prop of p.properties) {
          if (prop.type === "RestElement") walkPattern(prop, scope, isDecl);
          else {
            if (prop.computed) walk(prop.key, scope);
            walkPattern(prop.value, scope, isDecl);
          }
        }
        break;
      case "MemberExpression":
        walkMemberWrite(p, scope);
        break;
      default:
        walk(p, scope);
    }
  }

  function walkMemberWrite(m, scope) {
    walk(m.object, scope);
    if (m.computed) walk(m.property, scope);
    curFn.calls.push({ type: "memberWrite", node: m });
    markMutated(m.object);
  }

  function markMutated(obj) {
    while (obj.type === "MemberExpression") obj = obj.object;
    if (obj.type === "Identifier") {
      const d = refs.get(obj) && refs.get(obj).decl;
      if (d) d.mutated = true;
    }
  }

  function walk(node, scope) {
    if (!node) return;
    switch (node.type) {
      case "Program": {
        const s = makeScope(null, 0, true);
        for (const name of COMMONJS_PARAMS) declare(s, name, { kind: "param" });
        hoistVars(node, s);
        hoistLexical(node.body, s);
        moduleScope = s;
        for (const st of node.body) walk(st, s);
        return;
      }
      case "Identifier":
        ref(node, scope, false);
        return;
      case "FunctionDeclaration":
        walkFunction(node, scope);
        return;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        walkFunction(node, scope);
        return;
      case "ClassDeclaration":
      case "ClassExpression":
        curFn.impure = curFn.impure || "class";
        classes.push(node);
        return;
      case "BlockStatement": {
        const s = makeScope(scope, curFn.fid, false);
        hoistLexical(node.body, s);
        for (const st of node.body) walk(st, s);
        return;
      }
      case "SwitchStatement": {
        walk(node.discriminant, scope);
        const s = makeScope(scope, curFn.fid, false);
        for (const c of node.cases) hoistLexical(c.consequent, s);
        for (const c of node.cases) {
          walk(c.test, s);
          for (const st of c.consequent) walk(st, s);
        }
        return;
      }
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const s = makeScope(scope, curFn.fid, false);
        const init = node.type === "ForStatement" ? node.init : node.left;
        if (init && init.type === "VariableDeclaration" && init.kind !== "var") hoistLexical([init], s);
        if (node.type === "ForStatement") {
          walk(node.init, s);
          walk(node.test, s);
          walk(node.update, s);
        } else {
          if (node.left.type === "VariableDeclaration") walk(node.left, s);
          else walkPattern(node.left, s, false);
          walk(node.right, s);
        }
        walk(node.body, s);
        return;
      }
      case "CatchClause": {
        const s = makeScope(scope, curFn.fid, false);
        if (node.param) for (const id of patternNames(node.param, [])) declare(s, id.name, { kind: "let" });
        walkPattern(node.param, s, true);
        hoistLexical(node.body.body, s);
        for (const st of node.body.body) walk(st, s);
        return;
      }
      case "VariableDeclaration":
        for (const d of node.declarations) {
          walkPattern(d.id, scope, true);
          walk(d.init, scope);
        }
        return;
      case "MemberExpression":
        walk(node.object, scope);
        if (node.computed) walk(node.property, scope);
        return;
      case "Property":
        if (node.computed) walk(node.key, scope);
        walk(node.value, scope);
        return;
      case "LabeledStatement":
        walk(node.body, scope);
        return;
      case "BreakStatement":
      case "ContinueStatement":
        return;
      case "AssignmentExpression":
        if (node.left.type === "Identifier") ref(node.left, scope, true);
        else walkPattern(node.left, scope, false);
        if (node.operator !== "=" && node.left.type === "Identifier") {
          // compound assignment also reads the target
        }
        walk(node.right, scope);
        return;
      case "UpdateExpression":
        if (node.argument.type === "Identifier") ref(node.argument, scope, true);
        else walkMemberWrite(node.argument, scope);
        return;
      case "UnaryExpression":
        if (node.operator === "delete" && node.argument.type === "MemberExpression") {
          walkMemberWrite(node.argument, scope);
          return;
        }
        walk(node.argument, scope);
        return;
      case "ThisExpression":
        curFn.usesThis = true;
        return;
      case "CallExpression":
      case "NewExpression":
        curFn.calls.push({ type: node.type, node, scope });
        walk(node.callee, scope);
        for (const a of node.arguments) walk(a, scope);
        return;
      default:
        for (const child of childNodes(node)) walk(child, scope);
    }
  }

  let moduleScope = null;
  const classes = [];
  walk(ast, null);

  // A binding is "mutated" if any member write or mutator method call is rooted at it, or it is the
  // target of Object.assign (aliasing through other functions is not tracked; see README).
  for (const f of fns) {
    for (const c of f.calls) {
      if (c.type !== "CallExpression") continue;
      const callee = c.node.callee;
      if (callee.type !== "MemberExpression" || callee.computed) continue;
      if (MUTATOR_METHODS.has(callee.property.name)) markMutated(callee.object);
      if (
        callee.object.type === "Identifier" &&
        callee.object.name === "Object" &&
        callee.property.name === "assign" &&
        c.node.arguments[0]
      ) {
        markMutated(c.node.arguments[0]);
      }
    }
  }

  // Module bindings that generated code may reference by name: declared at module level and never
  // reassigned after their declaration.
  const moduleBindings = [...moduleScope.vars.keys()].filter((n) => !COMMONJS_PARAMS.includes(n));
  const constModuleBindings = moduleBindings.filter((n) => {
    const v = moduleScope.vars.get(n);
    if (v.kind === "class") return false;
    return v.writes === 0 && v.init !== "multi";
  });

  computePurity(fns, refs, moduleScope, fnByNode);

  return { fns, refs, fnByNode, moduleScope, moduleBindings, constModuleBindings };
}

// Conservative syntactic purity: the function's result depends only on its arguments, the values of
// its free closure variables and immutable module bindings, and it has no observable side effects.
function computePurity(fns, refs, moduleScope, fnByNode) {
  const reasons = new Map();
  for (const f of fns) {
    if (f.fid === 0) continue;
    const r = localImpurity(f);
    if (r) reasons.set(f.fid, r);
  }
  // Fixpoint over calls to other module-level functions and nested functions.
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of fns) {
      if (f.fid === 0 || reasons.has(f.fid)) continue;
      for (const dep of f.deps || []) {
        if (reasons.has(dep)) {
          reasons.set(f.fid, `calls impure function #${dep}`);
          changed = true;
          break;
        }
      }
    }
  }
  for (const f of fns) {
    f.pure = f.fid !== 0 && !reasons.has(f.fid);
    f.impureReason = reasons.get(f.fid) || null;
  }

  function within(fid, ancestor) {
    for (let x = fid; x !== -1 && x !== undefined; x = fns[x].parent) if (x === ancestor) return true;
    return false;
  }

  function localImpurity(f) {
    if (f.impure) return f.impure;
    f.deps = new Set();
    // Nested functions are part of this function's computation.
    for (const g of fns) {
      if (g.fid !== f.fid && g.fid !== 0 && within(g.fid, f.fid)) {
        if (g.impure) return g.impure;
        if (g.usesThis && g.kind === "arrow") return "this";
      }
    }
    if (f.usesThis) return "this";
    for (const [id, info] of refs) {
      if (!within(info.fn, f.fid)) continue;
      const d = info.decl;
      if (!d) {
        if (!SAFE_GLOBALS.has(id.name)) return `global ${id.name}`;
        continue;
      }
      const declaredInside = d.fid !== 0 && within(d.fid, f.fid);
      if (info.write && !info.declaration && !declaredInside) return `writes ${id.name}`;
      if (d.fid === 0 && !declaredInside) {
        if (d.kind === "param") return `module param ${id.name}`;
        if (d.writes > 1 || d.init === "multi") return `mutable module binding ${id.name}`;
        if (d.kind === "fn") {
          f.deps.add(fnByNode.get(d.init).fid);
          continue;
        }
        if (d.mutated) return `mutated module binding ${id.name}`;
        if (d.init && d.init.type && /Function/.test(d.init.type) && fnByNode.has(d.init)) {
          f.deps.add(fnByNode.get(d.init).fid);
          continue;
        }
        if (!d.init || !isLiteralInit(d.init)) return `module binding ${id.name} is not a literal constant`;
      }
    }
    for (const g of fns) {
      if (g.fid === 0 || !within(g.fid, f.fid)) continue;
      for (const c of g.calls) {
        const r = callImpurity(c, f);
        if (r) return r;
      }
    }
    return null;
  }

  function isLiteralInit(init) {
    switch (init.type) {
      case "Literal":
        return true;
      case "TemplateLiteral":
        return init.expressions.length === 0;
      case "UnaryExpression":
        return isLiteralInit(init.argument);
      case "ArrayExpression":
        return init.elements.every((e) => e && e.type !== "SpreadElement" && isLiteralInit(e));
      case "ObjectExpression":
        return init.properties.every(
          (p) => p.type === "Property" && !p.computed && p.kind === "init" && !p.method && isLiteralInit(p.value)
        );
      default:
        return false;
    }
  }

  function localLiteralVar(node, f) {
    if (node.type !== "Identifier") return false;
    const info = refs.get(node);
    const d = info && info.decl;
    if (!d || d.fid === 0 || !within(d.fid, f.fid)) return false;
    return d.init && d.init !== "multi" && (d.init.type === "ArrayExpression" || d.init.type === "ObjectExpression");
  }

  function callImpurity(c, f) {
    if (c.type === "memberWrite") {
      return localLiteralVar(c.node.object, f) ? null : "member write";
    }
    const callee = c.node.callee;
    if (c.type === "NewExpression") {
      if (callee.type === "Identifier" && !refs.get(callee).decl && ["RegExp", "Array", "Set", "Map"].includes(callee.name)) {
        return null;
      }
      return "new";
    }
    if (callee.type === "Identifier") {
      const info = refs.get(callee);
      const d = info.decl;
      if (!d) return SAFE_GLOBAL_CALLS.has(callee.name) ? null : `calls global ${callee.name}`;
      if (d.fid === 0 && (d.kind === "fn" || (d.init && fnByNode.has(d.init)))) return null; // via deps
      if (d.init && d.init !== "multi" && fnByNode.has(d.init) && d.writes <= 1) {
        f.deps.add(fnByNode.get(d.init).fid);
        return null;
      }
      return `calls ${callee.name}`;
    }
    if (callee.type === "MemberExpression") {
      if (callee.computed || callee.property.type !== "Identifier") return "computed method call";
      const name = callee.property.name;
      const obj = callee.object;
      if (obj.type === "Identifier") {
        const info = refs.get(obj);
        const d = info && info.decl;
        if (!d) {
          if (!Object.prototype.hasOwnProperty.call(SAFE_STATIC_CALLS, obj.name)) return `calls ${obj.name}.${name}`;
          const allowed = SAFE_STATIC_CALLS[obj.name];
          if (obj.name === "Math") return name === "random" ? "Math.random" : null;
          if (!allowed.has(name)) return `calls ${obj.name}.${name}`;
          if (obj.name === "Object" && name === "assign") {
            const t = c.node.arguments[0];
            return t && t.type === "ObjectExpression" ? null : "Object.assign onto non-literal";
          }
          return null;
        }
        if (d.fid === 0) {
          if (d.kind === "param" || !d.init || d.init === "multi" || !isLiteralInit(d.init)) {
            return `method call on module binding ${obj.name}`;
          }
        }
        if (MUTATOR_METHODS.has(name) && !localLiteralVar(obj, f)) return `mutator .${name}()`;
        return null;
      }
      if (MUTATOR_METHODS.has(name)) return `mutator .${name}()`;
      return null;
    }
    return "complex callee";
  }
}

function childNodes(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x.type === "string") out.push(x);
    } else if (v && typeof v === "object" && typeof v.type === "string") {
      out.push(v);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Code generation

const H = "__h";

class Generator {
  constructor(source, analysis) {
    this.src = source;
    this.a = analysis;
    this.fnStack = [];
  }

  bail(node, what) {
    throw new InstrumentError(`unsupported syntax for tracing: ${what} at offset ${node.start}`);
  }

  program(ast) {
    const directives = [];
    let i = 0;
    while (i < ast.body.length && ast.body[i].directive !== undefined) directives.push(ast.body[i++]);
    const prologue = directives.map((d) => this.src.slice(d.start, d.end)).join("\n");
    this.fnStack.push({ fid: 0, temps: 0 });
    const body = ast.body
      .slice(i)
      .map((s) => this.gen(s))
      .join("\n");
    const ctx = this.fnStack.pop();
    const regs = this.registrations(ast.body);
    const temps = ctx.temps ? `var ${range(ctx.temps).map((k) => `__t${k}`).join(", ")};\n` : "";
    const mod = this.a.constModuleBindings
      .map((n) => `${JSON.stringify(n)}: function () { return ${n}; }`)
      .join(",\n  ");
    return `${prologue}\n${temps}${regs}${body}\n;${H}.mod({\n  ${mod}\n});\n`;
  }

  // Function declarations are hoisted: register them at the top of their scope.
  registrations(statements) {
    let out = "";
    for (const s of statements) {
      if (s.type === "FunctionDeclaration") {
        const fn = this.a.fnByNode.get(s);
        out += `${H}.F(${fn.fid}, ${s.id.name}, ${this.getter(fn)});\n`;
      }
    }
    return out;
  }

  getter(fn) {
    if (fn.freeLocals.size === 0) return "null";
    return `function () { return [${[...fn.freeLocals.keys()].join(", ")}]; }`;
  }

  temp() {
    const ctx = this.fnStack[this.fnStack.length - 1];
    return `__t${ctx.temps++}`;
  }

  splice(node) {
    const kids = childNodes(node).sort((x, y) => x.start - y.start);
    let out = "";
    let pos = node.start;
    for (const k of kids) {
      out += this.src.slice(pos, k.start) + this.gen(k);
      pos = k.end;
    }
    return out + this.src.slice(pos, node.end);
  }

  test(node) {
    return `${H}.t(${this.gen(node)})`;
  }

  args(list) {
    return `[${list.map((a) => (a.type === "SpreadElement" ? `...${H}.sp(${this.gen(a.argument)})` : this.gen(a))).join(", ")}]`;
  }

  memberKey(m) {
    if (m.computed) return this.gen(m.property);
    if (m.property.type === "PrivateIdentifier") this.bail(m, "private field");
    return JSON.stringify(m.property.name);
  }

  closureInfo(id) {
    const info = this.a.refs.get(id);
    if (!info || !info.decl) return null;
    const cur = this.fnStack[this.fnStack.length - 1].fid;
    if (info.decl.fid === 0 || info.decl.fid === cur) return null;
    return info.decl.fid;
  }

  gen(node) {
    if (!node) return "";
    const src = this.src;
    switch (node.type) {
      case "Identifier": {
        const declFid = this.closureInfo(node);
        if (declFid !== null) return `${H}.cv(${declFid}, ${JSON.stringify(node.name)}, ${node.name})`;
        return node.name;
      }
      case "Literal":
      case "ThisExpression":
      case "Super":
      case "EmptyStatement":
      case "DebuggerStatement":
      case "BreakStatement":
      case "ContinueStatement":
        if (node.type === "Super") this.bail(node, "super");
        return src.slice(node.start, node.end);
      case "TemplateLiteral":
        return `${H}.tpl(${JSON.stringify(node.quasis.map((q) => q.value.cooked))}, [${node.expressions
          .map((e) => this.gen(e))
          .join(", ")}])`;
      case "TaggedTemplateExpression":
        return this.bail(node, "tagged template");
      case "ChainExpression":
        return this.bail(node, "optional chaining");
      case "MetaProperty":
        return this.bail(node, "meta property");
      case "AwaitExpression":
      case "YieldExpression":
      case "ClassExpression":
      case "ClassDeclaration":
      case "ImportExpression":
        return this.bail(node, node.type);
      case "MemberExpression":
        if (node.optional) this.bail(node, "optional chaining");
        return `${H}.g(${this.gen(node.object)}, ${this.memberKey(node)})`;
      case "CallExpression": {
        if (node.optional) this.bail(node, "optional call");
        const callee = node.callee;
        if (callee.type === "Identifier" && callee.name === "eval") this.bail(node, "eval");
        if (callee.type === "MemberExpression") {
          if (callee.optional) this.bail(node, "optional chaining");
          if (callee.object.type === "Super") this.bail(node, "super call");
          return `${H}.mc(${this.gen(callee.object)}, ${this.memberKey(callee)}, ${this.args(node.arguments)})`;
        }
        if (callee.type === "Super") this.bail(node, "super call");
        return `${H}.c(${this.gen(callee)}, ${this.args(node.arguments)})`;
      }
      case "NewExpression":
        return `${H}.n(${this.gen(node.callee)}, ${this.args(node.arguments)})`;
      case "SequenceExpression":
        return `(${node.expressions.map((e) => this.gen(e)).join(", ")})`;
      case "BinaryExpression":
        if (node.left.type === "PrivateIdentifier") this.bail(node, "#x in");
        return `${H}.b(${JSON.stringify(node.operator)}, ${this.gen(node.left)}, ${this.gen(node.right)})`;
      case "LogicalExpression":
        return `${H}.L(${JSON.stringify(node.operator)}, ${this.gen(node.left)}, () => (${this.gen(node.right)}))`;
      case "ConditionalExpression":
        return `(${this.test(node.test)} ? ${this.gen(node.consequent)} : ${this.gen(node.alternate)})`;
      case "UnaryExpression": {
        const op = node.operator;
        if (op === "typeof") {
          if (node.argument.type === "Identifier" && !(this.a.refs.get(node.argument) || {}).decl) {
            return src.slice(node.start, node.end);
          }
          return `${H}.u("typeof", ${this.gen(node.argument)})`;
        }
        if (op === "delete") {
          if (node.argument.type !== "MemberExpression") this.bail(node, "delete identifier");
          return `${H}.del(${this.gen(node.argument.object)}, ${this.memberKey(node.argument)})`;
        }
        if (op === "void") return `(void ${this.gen(node.argument)})`;
        return `${H}.u(${JSON.stringify(op)}, ${this.gen(node.argument)})`;
      }
      case "UpdateExpression": {
        const arg = node.argument;
        const op = node.operator === "++" ? "+" : "-";
        if (arg.type === "Identifier") {
          const write = this.writeMark(arg);
          const read = this.gen(arg);
          if (node.prefix) return `(${write}${arg.name} = ${H}.b("${op}", ${H}.u("+", ${read}), 1))`;
          const t = this.temp();
          return `(${write}${t} = ${H}.u("+", ${read}), ${arg.name} = ${H}.b("${op}", ${t}, 1), ${t})`;
        }
        if (arg.type === "MemberExpression") {
          return `${H}.upd(${this.gen(arg.object)}, ${this.memberKey(arg)}, "${op}", ${node.prefix})`;
        }
        return this.bail(node, "update target");
      }
      case "AssignmentExpression": {
        const left = node.left;
        const op = node.operator;
        if (op === "&&=" || op === "||=" || op === "??=") this.bail(node, "logical assignment");
        if (left.type === "Identifier") {
          const write = this.writeMark(left);
          const rhs =
            op === "="
              ? this.gen(node.right)
              : `${H}.b(${JSON.stringify(op.slice(0, -1))}, ${this.gen(left)}, ${this.gen(node.right)})`;
          return `(${write}${left.name} = ${rhs})`;
        }
        if (left.type === "MemberExpression") {
          if (op === "=") return `${H}.s(${this.gen(left.object)}, ${this.memberKey(left)}, ${this.gen(node.right)})`;
          return `${H}.so(${this.gen(left.object)}, ${this.memberKey(left)}, ${JSON.stringify(op.slice(0, -1))}, ${this.gen(
            node.right
          )})`;
        }
        return this.bail(node, "destructuring assignment");
      }
      case "ObjectExpression": {
        const parts = [];
        for (const p of node.properties) {
          if (p.type === "SpreadElement") {
            parts.push(`${H}.SPREAD`, this.gen(p.argument));
            continue;
          }
          if (p.kind !== "init") this.bail(p, "getter/setter");
          const key = p.computed
            ? `${H}.key(${this.gen(p.key)})`
            : p.key.type === "Identifier"
            ? JSON.stringify(p.key.name)
            : JSON.stringify(String(p.key.value));
          if (!p.computed && key === '"__proto__"' && !p.shorthand) this.bail(p, "__proto__ literal");
          parts.push(key, this.gen(p.value));
        }
        return `${H}.o([${parts.join(", ")}])`;
      }
      case "ArrayExpression":
        return `${H}.a([${node.elements
          .map((e) => (e === null ? "" : e.type === "SpreadElement" ? `...${H}.sp(${this.gen(e.argument)})` : this.gen(e)))
          .join(", ")}])`;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        return this.fn(node);
      case "IfStatement":
        return `if (${this.test(node.test)}) ${this.gen(node.consequent)}${
          node.alternate ? ` else ${this.gen(node.alternate)}` : ""
        }`;
      case "WhileStatement":
        return `while (${this.test(node.test)}) ${this.gen(node.body)}`;
      case "DoWhileStatement":
        return `do ${this.gen(node.body)} while (${this.test(node.test)});`;
      case "ExpressionStatement":
        // `void` keeps ASI behaviour intact even though rewritten expressions may start with "(".
        return `void (${this.gen(node.expression)});`;
      case "ForStatement":
        return `for (${node.init ? this.genForInit(node.init) : ""}; ${node.test ? this.test(node.test) : ""}; ${
          node.update ? this.gen(node.update) : ""
        }) ${this.gen(node.body)}`;
      case "ForInStatement":
      case "ForOfStatement": {
        if (node.left.type !== "VariableDeclaration" && node.left.type !== "Identifier") this.bail(node, "for-in target");
        if (node.left.type === "VariableDeclaration" && node.left.declarations[0].id.type !== "Identifier") {
          this.bail(node, "for-in pattern");
        }
        const kw = node.type === "ForInStatement" ? "in" : "of";
        const left = node.left.type === "VariableDeclaration" ? src.slice(node.left.start, node.left.end) : node.left.name;
        if (node.left.type === "Identifier" && this.closureInfo(node.left) !== null) this.bail(node, "for-in closure target");
        return `for (${left} ${kw} ${H}.forin(${this.gen(node.right)})) ${this.gen(node.body)}`;
      }
      case "SwitchStatement": {
        const t = this.temp();
        const cases = node.cases
          .map(
            (c) =>
              `${c.test ? `case ${H}.t(${H}.b("===", ${t}, ${this.gen(c.test)}))` : "default"}: ${c.consequent
                .map((s) => this.gen(s))
                .join("\n")}`
          )
          .join("\n");
        return `switch ((${t} = ${this.gen(node.discriminant)}, true)) {\n${cases}\n}`;
      }
      case "CatchClause": {
        const body = this.gen(node.body);
        const param = node.param ? `(${src.slice(node.param.start, node.param.end)}) ` : "";
        if (node.param && node.param.type !== "Identifier") this.bail(node, "catch pattern");
        return `catch ${param}{ ${H}.caught(); ${body.slice(1)}`;
      }
      case "BlockStatement":
        return `{\n${this.registrations(node.body)}${node.body.map((s) => this.gen(s)).join("\n")}\n}`;
      case "VariableDeclarator":
        if (node.id.type !== "Identifier") this.bail(node, "destructuring declaration");
        return node.init ? `${node.id.name} = ${this.gen(node.init)}` : node.id.name;
      case "VariableDeclaration":
        return `${node.kind} ${node.declarations.map((d) => this.gen(d)).join(", ")};`;
      case "Property":
      case "SpreadElement":
      case "RestElement":
      case "ObjectPattern":
      case "ArrayPattern":
      case "AssignmentPattern":
        return this.bail(node, node.type);
      default:
        return this.splice(node);
    }
  }

  genForInit(init) {
    if (init.type !== "VariableDeclaration") return this.gen(init);
    return `${init.kind} ${init.declarations.map((d) => this.gen(d)).join(", ")}`;
  }

  writeMark(id) {
    const declFid = this.closureInfo(id);
    return declFid !== null ? `${H}.cw(${declFid}), ` : "";
  }

  fn(node) {
    const fn = this.a.fnByNode.get(node);
    if (node.async || node.generator) this.bail(node, "async/generator function");
    for (const p of node.params) {
      if (p.type !== "Identifier") this.bail(p, "parameter pattern");
    }
    const params = node.params.map((p) => p.name).join(", ");
    this.fnStack.push({ fid: fn.fid, temps: 0 });
    let body;
    if (node.body.type === "BlockStatement") {
      const stmts = node.body.body;
      let i = 0;
      const directives = [];
      while (i < stmts.length && stmts[i].directive !== undefined) directives.push(stmts[i++]);
      const inner = stmts
        .slice(i)
        .map((s) => this.gen(s))
        .join("\n");
      const ctx = this.fnStack[this.fnStack.length - 1];
      const temps = ctx.temps ? `var ${range(ctx.temps).map((k) => `__t${k}`).join(", ")};\n` : "";
      body = `{\n${directives.map((d) => this.src.slice(d.start, d.end)).join("\n")}\n${temps}${this.registrations(
        stmts
      )}${inner}\n}`;
    } else {
      const expr = this.gen(node.body);
      const ctx = this.fnStack[this.fnStack.length - 1];
      body = ctx.temps
        ? `{ var ${range(ctx.temps).map((k) => `__t${k}`).join(", ")}; return (${expr}); }`
        : `(${expr})`;
    }
    this.fnStack.pop();
    if (node.type === "ArrowFunctionExpression") {
      return `${H}.F(${fn.fid}, (...__a) => ${H}.fn(${fn.fid}, undefined, __a, (${params}) => ${body}), ${this.getter(fn)})`;
    }
    const name = node.id ? node.id.name : "";
    const wrapped = `function ${name}(${params}) { return ${H}.fn(${fn.fid}, this, arguments, function (${params}) ${body}); }`;
    if (node.type === "FunctionDeclaration") return wrapped;
    return `${H}.F(${fn.fid}, ${wrapped}, ${this.getter(fn)})`;
  }
}

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}

module.exports = { instrument, InstrumentError, analyze, MUTATOR_METHODS };
