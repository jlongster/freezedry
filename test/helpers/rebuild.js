"use strict";

const vm = require("vm");
const { createEnvironment } = require("../../lib/run");

function validateCaptureGraph(rawGraph, envOpt = "ecma") {
  const json = JSON.stringify(rawGraph);
  const parsed = JSON.parse(json);

  if (parsed.version !== 1) {
    throw new Error(`Expected version 1, got ${parsed.version}`);
  }
  if (!Array.isArray(parsed.roots)) throw new Error("roots must be an array");
  if (!Array.isArray(parsed.intrinsicPatches)) throw new Error("intrinsicPatches must be an array");
  if (!parsed.nodes || typeof parsed.nodes !== "object") throw new Error("nodes must be an object");
  if (!Array.isArray(parsed.assumptions)) throw new Error("assumptions must be an array");
  if (!Array.isArray(parsed.bailouts)) throw new Error("bailouts must be an array");

  const { ctx } = createEnvironment(envOpt);
  const checkedIntrinsics = new Set();

  function checkRef(ref, loc) {
    if (!ref || typeof ref !== "object") {
      throw new Error(`Invalid ref at ${loc}: ${JSON.stringify(ref)}`);
    }
    if ("$" in ref) {
      if (!parsed.nodes[ref.$]) {
        throw new Error(`Dangling node ref "${ref.$}" at ${loc}`);
      }
      return;
    }
    if ("symbol" in ref) {
      const symNode = parsed.nodes[ref.symbol];
      if (!symNode || symNode.type !== "symbol") {
        throw new Error(`Dangling symbol ref "${ref.symbol}" at ${loc}`);
      }
      return;
    }
    if ("intrinsic" in ref) {
      if (!checkedIntrinsics.has(ref.intrinsic)) {
        const val = vm.runInContext(ref.intrinsic, ctx);
        if (val === undefined) {
          throw new Error(`Intrinsic "${ref.intrinsic}" evaluated to undefined at ${loc}`);
        }
        checkedIntrinsics.add(ref.intrinsic);
      }
      return;
    }
    if ("global" in ref) {
      if (ref.global !== true) throw new Error(`Invalid global ref at ${loc}`);
      return;
    }
    if ("prim" in ref) {
      if (ref.prim === "number" && !("special" in ref) && typeof ref.value !== "number") {
        throw new Error(`Numeric ref missing value/special at ${loc}: ${JSON.stringify(ref)}`);
      }
      return;
    }
    throw new Error(`Unrecognized ref shape at ${loc}: ${JSON.stringify(ref)}`);
  }

  function checkKey(key, loc) {
    if (typeof key === "string") return;
    checkRef(key, `${loc}.key`);
  }

  function checkDescriptor(desc, loc) {
    if (desc === null) return;
    if (desc.value !== null) checkRef(desc.value, `${loc}.value`);
    if (desc.get !== null) checkRef(desc.get, `${loc}.get`);
    if (desc.set !== null) checkRef(desc.set, `${loc}.set`);
  }

  for (let i = 0; i < parsed.roots.length; i++) {
    const r = parsed.roots[i];
    checkKey(r.key, `roots[${i}]`);
    if (r.value !== null) checkRef(r.value, `roots[${i}].value`);
    checkDescriptor(r.descriptor, `roots[${i}].descriptor`);
  }

  for (let i = 0; i < parsed.intrinsicPatches.length; i++) {
    const p = parsed.intrinsicPatches[i];
    checkKey(p.key, `intrinsicPatches[${i}]`);
    checkDescriptor(p.descriptor, `intrinsicPatches[${i}].descriptor`);
  }

  for (const [id, node] of Object.entries(parsed.nodes)) {
    if (node.type === "symbol") continue;
    if (node.type === "scope") {
      if (node.parent !== null) {
        const p = parsed.nodes[node.parent];
        if (!p || p.type !== "scope") {
          throw new Error(`Invalid scope.parent "${node.parent}" on ${id}`);
        }
      }
      let cur = node.parent;
      let steps = 0;
      while (cur !== null) {
        if (++steps > 2000 || cur === id) {
          throw new Error(`Cycle in scope.parent chain starting at ${id}`);
        }
        cur = parsed.nodes[cur].parent;
      }
      for (const v of node.vars) {
        checkRef(v.value, `${id}.vars.${v.name}`);
      }
      continue;
    }

    checkRef(node.proto, `${id}.proto`);
    for (let i = 0; i < node.props.length; i++) {
      checkKey(node.props[i].key, `${id}.props[${i}]`);
      checkDescriptor(node.props[i], `${id}.props[${i}]`);
    }

    if (node.type === "function") {
      if (node.scope !== null) {
        const sn = parsed.nodes[node.scope];
        if (!sn || sn.type !== "scope") {
          throw new Error(`Invalid fn.scope "${node.scope}" on ${id}`);
        }
      }
      if (node.bound !== null) {
        checkRef(node.bound.target, `${id}.bound.target`);
        checkRef(node.bound.this, `${id}.bound.this`);
        for (let i = 0; i < node.bound.args.length; i++) {
          checkRef(node.bound.args[i], `${id}.bound.args[${i}]`);
        }
      }
      if (node.homeObject !== undefined) {
        checkRef(node.homeObject, `${id}.homeObject`);
      }
      if (node.this !== undefined) {
        checkRef(node.this, `${id}.this`);
      }
      if (node.ownerClass !== undefined) {
        const cls = parsed.nodes[node.ownerClass];
        if (!cls || cls.type !== "function" || cls.kind !== "class") {
          throw new Error(`Invalid fn.ownerClass "${node.ownerClass}" on ${id}`);
        }
      }
    } else if (node.type === "map") {
      for (let i = 0; i < node.entries.length; i++) {
        checkRef(node.entries[i][0], `${id}.entries[${i}][0]`);
        checkRef(node.entries[i][1], `${id}.entries[${i}][1]`);
      }
    } else if (node.type === "set") {
      for (let i = 0; i < node.entries.length; i++) {
        checkRef(node.entries[i], `${id}.entries[${i}]`);
      }
    } else if (node.type === "typedarray" || node.type === "dataview") {
      checkRef(node.buffer, `${id}.buffer`);
    } else if (node.type === "promise") {
      checkRef(node.value, `${id}.value`);
    } else if (node.type === "boxed") {
      checkRef(node.primitive, `${id}.primitive`);
    }
  }

  return parsed;
}

function buildFunctionExprCode(fnNode, id) {
  const src = fnNode.source;
  const strictPrefix = fnNode.strict ? '"use strict"; ' : "";

  if (fnNode.kind === "class") {
    return `function() { return (${src}\n); }`;
  }
  if (fnNode.kind === "arrow") {
    return `(function() { ${strictPrefix}return (${src}\n); }).call(this)`;
  }
  if (
    (fnNode.kind === "normal" ||
      fnNode.kind === "async" ||
      fnNode.kind === "generator" ||
      fnNode.kind === "asyncGenerator") &&
    /^(?:async\s+)?function\b/.test(src.trim())
  ) {
    // A FunctionDeclaration has NO inner immutable self-binding: its name resolves to the enclosing lexical/var scope!
    const exprSrc = fnNode.declaration
      ? src.replace(/^(\s*(?:async\s+)?function(?:\s*\*)?)\s+[A-Za-z_$][A-Za-z0-9_$]*(\s*\()/, "$1$2")
      : src;
    return `(function() { ${strictPrefix}return (${exprSrc}\n); })()`;
  }
  // Concise method / getter / setter / concise async or generator method
  const field = fnNode.kind === "getter" ? "get" : fnNode.kind === "setter" ? "set" : "value";
  return `(function() { ${strictPrefix}const __h = { ${src}\n }; __homeHolders[${JSON.stringify(id)}] = __h; const __k = Reflect.ownKeys(__h)[0]; return Object.getOwnPropertyDescriptor(__h, __k).${field}; })()`;
}

function rebuildInFreshContext(rawGraph, opts = {}) {
  const envOpt = opts.env ?? opts.targetEnv ?? "ecma";
  const graph = validateCaptureGraph(rawGraph, envOpt);
  if (graph.bailouts.length > 0) {
    throw new Error(`Cannot rebuild bailed graph: ${graph.bailouts[0].reason}`);
  }

  const { ctx, globalObj } = createEnvironment(envOpt);
  const intrinsicCache = new Map();
  const table = new Map();
  const promiseSettlers = [];

  function getIntrinsic(expr) {
    if (intrinsicCache.has(expr)) return intrinsicCache.get(expr);
    const val = vm.runInContext(expr, ctx);
    intrinsicCache.set(expr, val);
    return val;
  }

  function decodePrimitive(ref) {
    switch (ref.prim) {
      case "undefined":
        return undefined;
      case "null":
        return null;
      case "boolean":
      case "string":
        return ref.value;
      case "bigint":
        return BigInt(ref.value);
      case "number": {
        if (ref.special === "NaN") return NaN;
        if (ref.special === "-0") return -0;
        if (ref.special === "Infinity") return Infinity;
        if (ref.special === "-Infinity") return -Infinity;
        return ref.value;
      }
      default:
        throw new Error(`Unsupported primitive ref: ${JSON.stringify(ref)}`);
    }
  }

  function resolveRef(ref) {
    if ("prim" in ref) return decodePrimitive(ref);
    if ("global" in ref) return globalObj;
    if ("intrinsic" in ref) return getIntrinsic(ref.intrinsic);
    if ("symbol" in ref) return table.get(ref.symbol);
    if ("$" in ref) return table.get(ref.$);
    throw new Error(`Unknown ref: ${JSON.stringify(ref)}`);
  }

  function resolveKey(key) {
    if (typeof key === "string") return key;
    return resolveRef(key);
  }

  // Phase 1: Symbols and ArrayBuffers
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.type === "symbol") {
      const sym =
        node.registered !== null
          ? globalObj.Symbol.for(node.registered)
          : node.description !== null
            ? globalObj.Symbol(node.description)
            : globalObj.Symbol();
      table.set(id, sym);
    } else if (node.type === "arraybuffer") {
      const ab = new globalObj.ArrayBuffer(node.byteLength);
      new globalObj.Uint8Array(ab).set(Buffer.from(node.bytes, "base64"));
      table.set(id, ab);
    }
  }

  // Phase 2: Non-function object shells
  for (const [id, node] of Object.entries(graph.nodes)) {
    switch (node.type) {
      case "symbol":
      case "arraybuffer":
      case "scope":
      case "function":
        break;
      case "object":
        table.set(id, new globalObj.Object());
        break;
      case "array":
        table.set(id, new globalObj.Array(node.length));
        break;
      case "map":
        table.set(id, new globalObj.Map());
        break;
      case "set":
        table.set(id, new globalObj.Set());
        break;
      case "weakmap":
        table.set(id, new globalObj.WeakMap());
        break;
      case "weakset":
        table.set(id, new globalObj.WeakSet());
        break;
      case "date":
        table.set(id, new globalObj.Date(node.time === "NaN" ? NaN : node.time));
        break;
      case "regexp": {
        const re = new globalObj.RegExp(node.source, node.flags);
        re.lastIndex = node.lastIndex;
        table.set(id, re);
        break;
      }
      case "typedarray": {
        const buf = resolveRef(node.buffer);
        table.set(id, new globalObj[node.ctor](buf, node.byteOffset, node.length));
        break;
      }
      case "dataview": {
        const buf = resolveRef(node.buffer);
        table.set(id, new globalObj.DataView(buf, node.byteOffset, node.byteLength));
        break;
      }
      case "promise": {
        let resolveFn;
        let rejectFn;
        const p = new globalObj.Promise((res, rej) => {
          resolveFn = res;
          rejectFn = rej;
        });
        if (node.state === "rejected") {
          p.catch(() => {});
        }
        table.set(id, p);
        promiseSettlers.push({ node, resolveFn, rejectFn });
        break;
      }
      case "error": {
        const Ctor = globalObj[node.ctor] || globalObj.Error;
        table.set(id, new Ctor(node.message));
        break;
      }
      case "boxed": {
        table.set(id, globalObj.Object(resolveRef(node.primitive)));
        break;
      }
      default:
        throw new Error(`Unsupported node type: ${node.type}`);
    }
  }

  // Phase 3: Scope forest & source functions
  const childScopes = new Map();
  const scopeFunctions = new Map();
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.type === "scope") {
      const pKey = node.parent;
      if (!childScopes.has(pKey)) childScopes.set(pKey, []);
      childScopes.get(pKey).push(id);
    } else if (node.type === "function" && node.bound === null && !node.ownerClass) {
      const sKey = node.scope;
      if (!scopeFunctions.has(sKey)) scopeFunctions.set(sKey, []);
      scopeFunctions.get(sKey).push(id);
    }
  }

  const codeLines = [
    "(function(__fns, __classThunks, __scopeSetters, __homeHolders, __thisVals) {",
  ];

  function emitScopeLevel(scopeId) {
    const fnsHere = scopeFunctions.get(scopeId) || [];
    for (const fnId of fnsHere) {
      const fnNode = graph.nodes[fnId];
      const expr = buildFunctionExprCode(fnNode, fnId);
      if (fnNode.kind === "class") {
        codeLines.push(`__classThunks[${JSON.stringify(fnId)}] = ${expr};`);
      } else if (fnNode.this !== undefined) {
        codeLines.push(`__fns[${JSON.stringify(fnId)}] = (function() { "use strict"; return ${expr}; }).call(__thisVals[${JSON.stringify(fnId)}]);`);
      } else {
        codeLines.push(`__fns[${JSON.stringify(fnId)}] = ${expr};`);
      }
    }

    const kids = childScopes.get(scopeId) || [];
    for (const kidId of kids) {
      const sNode = graph.nodes[kidId];
      const hasThisVar = sNode.vars.some((v) => v.name === "this");
      const varNames = sNode.vars.filter((v) => v.name !== "this").map((v) => v.name);
      if (hasThisVar) {
        codeLines.push(`(function() { "use strict";`);
      } else {
        codeLines.push("{");
      }
      if (varNames.length > 0) {
        codeLines.push(`let ${varNames.join(", ")};`);
        const assigns = varNames.map((n, idx) => `${n} = arguments[0][${idx}];`).join(" ");
        codeLines.push(`__scopeSetters[${JSON.stringify(kidId)}] = function() { ${assigns} };`);
      } else {
        codeLines.push(`__scopeSetters[${JSON.stringify(kidId)}] = function() {};`);
      }
      emitScopeLevel(kidId);
      if (hasThisVar) {
        codeLines.push(`}).call(__thisVals[${JSON.stringify(kidId)}]);`);
      } else {
        codeLines.push("}");
      }
    }
  }

  emitScopeLevel(null);
  codeLines.push("})");

  const factoryFn = vm.runInContext(codeLines.join("\n"), ctx);
  const createdFns = {};
  const classThunks = {};
  const scopeSetters = {};
  const homeHolders = {};
  const thisVals = {};
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.type === "scope") {
      const tv = node.vars.find((v) => v.name === "this");
      if (tv) thisVals[id] = resolveRef(tv.value);
    } else if (node.type === "function" && node.this !== undefined) {
      thisVals[id] = resolveRef(node.this);
    }
  }
  factoryFn(createdFns, classThunks, scopeSetters, homeHolders, thisVals);

  for (const [fnId, fnVal] of Object.entries(createdFns)) {
    table.set(fnId, fnVal);
  }

  const populateAllScopes = () => {
    for (const [id, node] of Object.entries(graph.nodes)) {
      if (node.type === "scope" && scopeSetters[id]) {
        const vals = node.vars.filter((v) => v.name !== "this").map((v) => resolveRef(v.value));
        scopeSetters[id](vals);
      }
    }
  };

  populateAllScopes();

  // Evaluate class thunks (retrying in case subclass appears before superclass in object iteration)
  const adoptClassPrototypeShell = (fnId, clsVal) => {
    const fnNode = graph.nodes[fnId];
    const protoProp = fnNode.props.find((p) => p.key === "prototype" && p.value && "$" in p.value);
    if (protoProp && clsVal && clsVal.prototype) {
      table.set(protoProp.value.$, clsVal.prototype);
      const protoNode = graph.nodes[protoProp.value.$];
      if (protoNode && Array.isArray(protoNode.props)) {
        for (const pp of protoNode.props) {
          const k = resolveKey(pp.key);
          const rtDesc = Object.getOwnPropertyDescriptor(clsVal.prototype, k);
          if (!rtDesc) continue;
          if (pp.value && "$" in pp.value && graph.nodes[pp.value.$] && graph.nodes[pp.value.$].ownerClass === fnId && rtDesc.value) {
            table.set(pp.value.$, rtDesc.value);
          }
          if (pp.get && "$" in pp.get && graph.nodes[pp.get.$] && graph.nodes[pp.get.$].ownerClass === fnId && rtDesc.get) {
            table.set(pp.get.$, rtDesc.get);
          }
          if (pp.set && "$" in pp.set && graph.nodes[pp.set.$] && graph.nodes[pp.set.$].ownerClass === fnId && rtDesc.set) {
            table.set(pp.set.$, rtDesc.set);
          }
        }
      }
    }
    for (const sp of fnNode.props || []) {
      if (sp.key === "prototype") continue;
      const k = resolveKey(sp.key);
      const rtDesc = Object.getOwnPropertyDescriptor(clsVal, k);
      if (!rtDesc) continue;
      if (sp.value && "$" in sp.value && graph.nodes[sp.value.$] && graph.nodes[sp.value.$].ownerClass === fnId && rtDesc.value) {
        table.set(sp.value.$, rtDesc.value);
      }
      if (sp.get && "$" in sp.get && graph.nodes[sp.get.$] && graph.nodes[sp.get.$].ownerClass === fnId && rtDesc.get) {
        table.set(sp.get.$, rtDesc.get);
      }
      if (sp.set && "$" in sp.set && graph.nodes[sp.set.$] && graph.nodes[sp.set.$].ownerClass === fnId && rtDesc.set) {
        table.set(sp.set.$, rtDesc.set);
      }
    }
  };

  const pendingClasses = Object.keys(classThunks);
  let madeProgress = true;
  while (pendingClasses.length > 0 && madeProgress) {
    madeProgress = false;
    for (let i = pendingClasses.length - 1; i >= 0; i--) {
      const fnId = pendingClasses[i];
      try {
        const clsVal = classThunks[fnId]();
        table.set(fnId, clsVal);
        adoptClassPrototypeShell(fnId, clsVal);
        pendingClasses.splice(i, 1);
        madeProgress = true;
        populateAllScopes();
      } catch {
        // superclass may still be pending
      }
    }
  }
  if (pendingClasses.length > 0) {
    // Run final one without catching to surface real error
    const fnId = pendingClasses[0];
    const clsVal = classThunks[fnId]();
    table.set(fnId, clsVal);
    adoptClassPrototypeShell(fnId, clsVal);
    populateAllScopes();
  }

  // Phase 4: Bound functions (supports bound chains)
  const pendingBound = Object.entries(graph.nodes)
    .filter(([, n]) => n.type === "function" && n.bound !== null)
    .map(([id]) => id);
  let boundProgress = true;
  while (pendingBound.length > 0 && boundProgress) {
    boundProgress = false;
    for (let i = pendingBound.length - 1; i >= 0; i--) {
      const fnId = pendingBound[i];
      const b = graph.nodes[fnId].bound;
      const target = resolveRef(b.target);
      if (typeof target === "function") {
        const bThis = resolveRef(b.this);
        const bArgs = b.args.map((a) => resolveRef(a));
        const boundFn = globalObj.Function.prototype.bind.call(target, bThis, ...bArgs);
        table.set(fnId, boundFn);
        pendingBound.splice(i, 1);
        boundProgress = true;
      }
    }
  }
  if (pendingBound.length > 0) {
    throw new Error(`Unresolved bound function target for ${pendingBound[0]}`);
  }

  // Populate scopes once more now that all classes and bound functions exist
  populateAllScopes();

  // Phase 5: Prototypes, properties, Map/Set entries, Promises, homeObjects, patches, roots, freeze/seal
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.type === "symbol" || node.type === "scope") continue;
    const target = table.get(id);

    // Set [[Prototype]] first before defining non-extensible states
    const desiredProto = resolveRef(node.proto);
    if (Object.getPrototypeOf(target) !== desiredProto) {
      Object.setPrototypeOf(target, desiredProto);
    }

    if (node.type === "map") {
      for (const [kRef, vRef] of node.entries) {
        globalObj.Map.prototype.set.call(target, resolveRef(kRef), resolveRef(vRef));
      }
    } else if (node.type === "set") {
      for (const vRef of node.entries) {
        globalObj.Set.prototype.add.call(target, resolveRef(vRef));
      }
    }

    for (const prop of node.props) {
      const key = resolveKey(prop.key);
      // Skip non-configurable identical descriptors (e.g. class.prototype if replacing via defineProperty)
      const existing = Object.getOwnPropertyDescriptor(target, key);
      const desc = buildJsDescriptor(prop, resolveRef);
      if (existing && !existing.configurable) {
        if ("value" in desc && existing.writable) {
          Object.defineProperty(target, key, {
            value: desc.value,
            writable: desc.writable,
          });
        }
        continue;
      }
      Object.defineProperty(target, key, desc);
    }
  }

  // Wire [[HomeObject]] prototype linkage for super-using concise methods
  for (const [id, holder] of Object.entries(homeHolders)) {
    const fnNode = graph.nodes[id];
    if (fnNode && fnNode.homeObject) {
      const homeObj = resolveRef(fnNode.homeObject);
      if (homeObj) {
        Object.setPrototypeOf(holder, Object.getPrototypeOf(homeObj));
      }
    }
  }

  // Settle Promises and flush context microtasks
  for (const ps of promiseSettlers) {
    const val = resolveRef(ps.node.value);
    if (ps.node.state === "fulfilled") ps.resolveFn(val);
    else ps.rejectFn(val);
  }
  if (promiseSettlers.length > 0) {
    vm.runInContext("void 0", ctx);
  }

  // Apply intrinsicPatches
  for (const patch of graph.intrinsicPatches) {
    const target = getIntrinsic(patch.path);
    const key = resolveKey(patch.key);
    if (patch.deleted) {
      delete target[key];
    } else if (patch.descriptor) {
      Object.defineProperty(target, key, buildJsDescriptor(patch.descriptor, resolveRef));
    }
  }

  // Apply global roots
  for (const root of graph.roots) {
    const key = resolveKey(root.key);
    if (root.deleted) {
      delete globalObj[key];
    } else if (root.descriptor) {
      Object.defineProperty(globalObj, key, buildJsDescriptor(root.descriptor, resolveRef));
    }
  }

  // Apply frozen / sealed / non-extensible flags last
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.type === "symbol" || node.type === "scope") continue;
    const target = table.get(id);
    if (node.frozen) {
      Object.freeze(target);
    } else if (node.sealed) {
      Object.seal(target);
    } else if (!node.extensible) {
      Object.preventExtensions(target);
    }
  }

  return { ctx, globalObj, table };
}

function buildJsDescriptor(prop, resolveRef) {
  if (prop.get !== null || prop.set !== null || prop.value === null) {
    return {
      get: prop.get ? resolveRef(prop.get) : undefined,
      set: prop.set ? resolveRef(prop.set) : undefined,
      enumerable: Boolean(prop.enumerable),
      configurable: Boolean(prop.configurable),
    };
  }
  return {
    value: resolveRef(prop.value),
    writable: Boolean(prop.writable),
    enumerable: Boolean(prop.enumerable),
    configurable: Boolean(prop.configurable),
  };
}

function evalJson(ctx, expr) {
  return JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, ctx));
}

module.exports = {
  validateCaptureGraph,
  rebuildInFreshContext,
  evalJson,
};
