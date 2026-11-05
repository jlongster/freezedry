"use strict";

const acorn = require("acorn");
const { formatMemberAccess, quoteString } = require("./intrinsics");

function computeExpectedArity(params) {
  let count = 0;
  for (const p of params) {
    if (p.type === "AssignmentPattern" || p.type === "RestElement") break;
    count++;
  }
  return count;
}

function hasUseStrictDirective(bodyNode) {
  if (!bodyNode || bodyNode.type !== "BlockStatement" || !Array.isArray(bodyNode.body)) {
    return false;
  }
  for (const stmt of bodyNode.body) {
    if (stmt.type !== "ExpressionStatement") break;
    if (stmt.directive === "use strict") return true;
    if (
      stmt.expression &&
      stmt.expression.type === "Literal" &&
      stmt.expression.value === "use strict"
    ) {
      return true;
    }
  }
  return false;
}

function isPureStaticExpr(node) {
  if (!node) return true;
  switch (node.type) {
    case "Literal":
      return true;
    case "Identifier":
      return node.name === "undefined" || node.name === "NaN" || node.name === "Infinity";
    case "UnaryExpression":
      return (
        (node.operator === "-" ||
          node.operator === "+" ||
          node.operator === "!" ||
          node.operator === "~" ||
          node.operator === "void") &&
        isPureStaticExpr(node.argument)
      );
    case "BinaryExpression":
      return isPureStaticExpr(node.left) && isPureStaticExpr(node.right);
    default:
      return false;
  }
}

function isSafeComputedKeyExpr(node, inScopeVars) {
  if (!node) return false;
  switch (node.type) {
    case "Literal":
      return true;
    case "Identifier":
      return (
        node.name === "undefined" ||
        node.name === "Symbol" ||
        (inScopeVars != null && inScopeVars.has(node.name))
      );
    case "MemberExpression":
      if (
        !node.computed &&
        node.object.type === "Identifier" &&
        node.object.name === "Symbol" &&
        node.property.type === "Identifier"
      ) {
        return true;
      }
      return false;
    case "BinaryExpression":
    case "UnaryExpression":
      return isPureStaticExpr(node);
    default:
      return false;
  }
}

function collectPatternBindings(pat, out) {
  if (!pat) return;
  switch (pat.type) {
    case "Identifier":
      out.add(pat.name);
      break;
    case "AssignmentPattern":
      collectPatternBindings(pat.left, out);
      break;
    case "RestElement":
      collectPatternBindings(pat.argument, out);
      break;
    case "ArrayPattern":
      for (const el of pat.elements) {
        if (el) collectPatternBindings(el, out);
      }
      break;
    case "ObjectPattern":
      for (const p of pat.properties) {
        if (p.type === "RestElement") collectPatternBindings(p.argument, out);
        else collectPatternBindings(p.value, out);
      }
      break;
  }
}

function collectAssignedTargets(pat, localBindings, assignedOuter) {
  if (!pat) return;
  switch (pat.type) {
    case "Identifier":
      if (!localBindings.has(pat.name)) {
        assignedOuter.add(pat.name);
      }
      break;
    case "AssignmentPattern":
      collectAssignedTargets(pat.left, localBindings, assignedOuter);
      break;
    case "RestElement":
      collectAssignedTargets(pat.argument, localBindings, assignedOuter);
      break;
    case "ArrayPattern":
      for (const el of pat.elements) {
        if (el) collectAssignedTargets(el, localBindings, assignedOuter);
      }
      break;
    case "ObjectPattern":
      for (const p of pat.properties) {
        if (p.type === "RestElement") {
          collectAssignedTargets(p.argument, localBindings, assignedOuter);
        } else {
          collectAssignedTargets(p.value, localBindings, assignedOuter);
        }
      }
      break;
  }
}

function doesBodyAssignName(fnAst, targetName) {
  // Check if `targetName` is shadowed by a formal parameter or `var` inside `fnAst`
  const paramSet = new Set();
  if (Array.isArray(fnAst.params)) {
    for (const p of fnAst.params) collectPatternBindings(p, paramSet);
  }
  if (paramSet.has(targetName)) return false;

  let assigned = false;
  function scan(node, shadowSet) {
    if (!node || typeof node !== "object" || assigned) return;
    if (node.type === "AssignmentExpression") {
      const lhs = new Set();
      collectAssignedTargets(node.left, shadowSet, lhs);
      if (lhs.has(targetName)) {
        assigned = true;
        return;
      }
    } else if (node.type === "UpdateExpression") {
      const lhs = new Set();
      collectAssignedTargets(node.argument, shadowSet, lhs);
      if (lhs.has(targetName)) {
        assigned = true;
        return;
      }
    } else if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") {
      const next = new Set(shadowSet);
      for (const n of collectFunctionLocals(node)) next.add(n);
      if (next.has(targetName)) return;
      for (const p of node.params) scan(p, next);
      scan(node.body, next);
      return;
    } else if (node.type === "ArrowFunctionExpression") {
      const next = new Set(shadowSet);
      for (const n of collectFunctionLocals(node)) next.add(n);
      if (next.has(targetName)) return;
      for (const p of node.params) scan(p, next);
      scan(node.body, next);
      return;
    } else if (node.type === "BlockStatement") {
      const next = new Set(shadowSet);
      for (const stmt of node.body) {
        if (stmt.type === "VariableDeclaration" && stmt.kind !== "var") {
          for (const d of stmt.declarations) collectPatternBindings(d.id, next);
        } else if ((stmt.type === "ClassDeclaration" || stmt.type === "FunctionDeclaration") && stmt.id) {
          next.add(stmt.id.name);
        }
      }
      if (next.has(targetName)) return;
      for (const stmt of node.body) scan(stmt, next);
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      const v = node[k];
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && typeof item.type === "string") scan(item, shadowSet);
        }
      } else if (v && typeof v === "object" && typeof v.type === "string") {
        scan(v, shadowSet);
      }
    }
  }

  // Collect `var` declarations in fnAst.body (excluding fnAst.id itself!)
  const bodyVars = new Set();
  const fakeNoId = { params: fnAst.params, body: fnAst.body };
  for (const n of collectFunctionLocals(fakeNoId)) bodyVars.add(n);
  if (bodyVars.has(targetName)) return false;
  scan(fnAst.body, bodyVars);
  return assigned;
}

function collectFunctionLocals(fnNode) {
  const locals = new Set();
  if (fnNode.id && fnNode.id.name) locals.add(fnNode.id.name);
  if (Array.isArray(fnNode.params)) {
    for (const p of fnNode.params) collectPatternBindings(p, locals);
  }
  function scanVarDecls(node) {
    if (!node || typeof node !== "object") return;
    if (
      node !== fnNode &&
      (node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression")
    ) {
      if (node.type === "FunctionDeclaration" && node.id) {
        locals.add(node.id.name);
      }
      return;
    }
    if (node.type === "VariableDeclaration" && node.kind === "var") {
      for (const d of node.declarations) collectPatternBindings(d.id, locals);
    }
    for (const k of Object.keys(node)) {
      if (k === "type" || k === "start" || k === "end") continue;
      const v = node[k];
      if (Array.isArray(v)) {
        for (const item of v) scanVarDecls(item);
      } else if (v && typeof v === "object" && typeof v.type === "string") {
        scanVarDecls(v);
      }
    }
  }
  scanVarDecls(fnNode.body);
  return locals;
}

function analyzeAstSafety(rootAst, topKind) {
  let bailout = null;
  let capturesThis = false;
  let capturesArguments = false;
  let capturesSuperOrNewTarget = false;
  let usesFreeSuper = false;
  const assignedOuter = new Set();

  function walk(node, scopeSet, inTopThisContext, inTopSuperContext) {
    if (!node || typeof node !== "object" || bailout) return;

    switch (node.type) {
      case "WithStatement":
        bailout = "with statement in function source";
        return;

      case "CallExpression":
        if (
          !node.optional &&
          node.callee &&
          node.callee.type === "Identifier" &&
          node.callee.name === "eval" &&
          !scopeSet.has("eval")
        ) {
          bailout = "direct eval in function source";
          return;
        }
        break;

      case "ThisExpression":
        if (inTopThisContext) capturesThis = true;
        return;

      case "Super":
        if (inTopThisContext) capturesSuperOrNewTarget = true;
        if (inTopSuperContext) usesFreeSuper = true;
        return;

      case "MetaProperty":
        if (
          inTopThisContext &&
          node.meta &&
          node.meta.name === "new" &&
          node.property &&
          node.property.name === "target"
        ) {
          capturesSuperOrNewTarget = true;
        }
        return;

      case "Identifier":
        if (inTopThisContext && node.name === "arguments" && !scopeSet.has("arguments")) {
          capturesArguments = true;
        }
        return;

      case "AssignmentExpression":
        collectAssignedTargets(node.left, scopeSet, assignedOuter);
        walk(node.left, scopeSet, inTopThisContext, inTopSuperContext);
        walk(node.right, scopeSet, inTopThisContext, inTopSuperContext);
        return;

      case "UpdateExpression":
        collectAssignedTargets(node.argument, scopeSet, assignedOuter);
        walk(node.argument, scopeSet, inTopThisContext, inTopSuperContext);
        return;

      case "ForInStatement":
      case "ForOfStatement":
        if (node.left && node.left.type !== "VariableDeclaration") {
          collectAssignedTargets(node.left, scopeSet, assignedOuter);
        }
        break;

      case "FunctionDeclaration":
      case "FunctionExpression": {
        const nextScope = new Set(scopeSet);
        for (const n of collectFunctionLocals(node)) nextScope.add(n);
        nextScope.add("arguments");
        for (const p of node.params) walk(p, nextScope, false, false);
        walk(node.body, nextScope, false, false);
        return;
      }

      case "ArrowFunctionExpression": {
        const isRoot = node === rootAst;
        const nextScope = new Set(scopeSet);
        for (const n of collectFunctionLocals(node)) nextScope.add(n);
        const nextThis = isRoot ? topKind === "arrow" : inTopThisContext;
        const nextSuper = isRoot ? false : inTopSuperContext;
        for (const p of node.params) walk(p, nextScope, nextThis, nextSuper);
        walk(node.body, nextScope, nextThis, nextSuper);
        return;
      }

      case "BlockStatement": {
        const nextScope = new Set(scopeSet);
        for (const stmt of node.body) {
          if (stmt.type === "VariableDeclaration" && stmt.kind !== "var") {
            for (const d of stmt.declarations) collectPatternBindings(d.id, nextScope);
          } else if (stmt.type === "ClassDeclaration" && stmt.id) {
            nextScope.add(stmt.id.name);
          } else if (stmt.type === "FunctionDeclaration" && stmt.id) {
            nextScope.add(stmt.id.name);
          }
        }
        for (const stmt of node.body) {
          walk(stmt, nextScope, inTopThisContext, inTopSuperContext);
        }
        return;
      }

      case "CatchClause": {
        const nextScope = new Set(scopeSet);
        if (node.param) collectPatternBindings(node.param, nextScope);
        if (node.param) walk(node.param, nextScope, inTopThisContext, inTopSuperContext);
        walk(node.body, nextScope, inTopThisContext, inTopSuperContext);
        return;
      }

      case "ObjectExpression": {
        for (const prop of node.properties) {
          if (prop.type === "SpreadElement") {
            walk(prop.argument, scopeSet, inTopThisContext, inTopSuperContext);
          } else {
            if (prop.computed) {
              walk(prop.key, scopeSet, inTopThisContext, inTopSuperContext);
            }
            if (prop.method || prop.kind === "get" || prop.kind === "set") {
              // Inner object literal provides its own [[HomeObject]] for super and its own `this`
              const nextScope = new Set(scopeSet);
              for (const n of collectFunctionLocals(prop.value)) nextScope.add(n);
              nextScope.add("arguments");
              for (const p of prop.value.params) walk(p, nextScope, false, false);
              walk(prop.value.body, nextScope, false, false);
            } else {
              walk(prop.value, scopeSet, inTopThisContext, inTopSuperContext);
            }
          }
        }
        return;
      }

      case "ClassDeclaration":
      case "ClassExpression": {
        const nextScope = new Set(scopeSet);
        if (node.id && node.id.name) nextScope.add(node.id.name);
        if (node.superClass) {
          walk(node.superClass, scopeSet, inTopThisContext, inTopSuperContext);
        }
        for (const el of node.body.body) {
          if (el.computed && el.key) {
            walk(el.key, nextScope, inTopThisContext, inTopSuperContext);
          }
          if (el.type === "MethodDefinition") {
            const mScope = new Set(nextScope);
            for (const n of collectFunctionLocals(el.value)) mScope.add(n);
            mScope.add("arguments");
            for (const p of el.value.params) walk(p, mScope, false, false);
            walk(el.value.body, mScope, false, false);
          } else if (el.type === "PropertyDefinition") {
            if (el.value) walk(el.value, nextScope, false, false);
          } else if (el.type === "StaticBlock") {
            for (const stmt of el.body) walk(stmt, nextScope, false, false);
          }
        }
        return;
      }
    }

    for (const k of Object.keys(node)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      if (
        (node.type === "MemberExpression" || node.type === "Property") &&
        k === "property" &&
        !node.computed
      ) {
        continue;
      }
      if (node.type === "Property" && k === "key" && !node.computed) {
        continue;
      }
      if (
        (node.type === "LabeledStatement" ||
          node.type === "BreakStatement" ||
          node.type === "ContinueStatement") &&
        k === "label"
      ) {
        continue;
      }
      const v = node[k];
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && typeof item.type === "string") {
            walk(item, scopeSet, inTopThisContext, inTopSuperContext);
          }
        }
      } else if (v && typeof v === "object" && typeof v.type === "string") {
        walk(v, scopeSet, inTopThisContext, inTopSuperContext);
      }
    }
  }

  if (rootAst.type === "ArrowFunctionExpression") {
    walk(rootAst, new Set(), true, false);
  } else if (
    rootAst.type === "FunctionExpression" &&
    (topKind === "method" || topKind === "getter" || topKind === "setter")
  ) {
    const initScope = collectFunctionLocals(rootAst);
    initScope.add("arguments");
    for (const p of rootAst.params) walk(p, initScope, false, true);
    walk(rootAst.body, initScope, false, true);
  } else if (rootAst.type === "FunctionExpression") {
    const initScope = collectFunctionLocals(rootAst);
    initScope.add("arguments");
    for (const p of rootAst.params) walk(p, initScope, false, false);
    walk(rootAst.body, initScope, false, false);
  } else if (rootAst.type === "ClassExpression") {
    walk(rootAst, new Set(), false, false);
  }

  return {
    bailout,
    capturesThis,
    capturesArguments,
    capturesSuperOrNewTarget,
    usesFreeSuper,
    assignedOuter,
  };
}

function extractWellKnownSymbolIntrinsic(keyNode) {
  if (
    keyNode &&
    keyNode.type === "MemberExpression" &&
    !keyNode.computed &&
    keyNode.object.type === "Identifier" &&
    keyNode.object.name === "Symbol" &&
    keyNode.property.type === "Identifier"
  ) {
    return `Symbol.${keyNode.property.name}`;
  }
  return null;
}

function analyzeClassExpr(clsNode, source, offset) {
  let ctorArity = 0;
  let hasStaticPrivate = false;
  let hasInstancePrivate = false;
  const members = [];
  const edits = [];

  const superInfo = clsNode.superClass
    ? {
        start: clsNode.superClass.start - offset,
        end: clsNode.superClass.end - offset,
        raw: source.slice(clsNode.superClass.start - offset, clsNode.superClass.end - offset),
        identifierName:
          clsNode.superClass.type === "Identifier" ? clsNode.superClass.name : null,
        isNullLiteral:
          clsNode.superClass.type === "Literal" && clsNode.superClass.value === null,
        isPureRef:
          clsNode.superClass.type === "Identifier" ||
          (clsNode.superClass.type === "Literal" && clsNode.superClass.value === null),
      }
    : null;

  for (const el of clsNode.body.body) {
    const elStart = el.start - offset;
    const elEnd = el.end - offset;
    if (el.key && el.key.type === "PrivateIdentifier") {
      if (el.static) hasStaticPrivate = true;
      else hasInstancePrivate = true;
      continue;
    }
    if (el.type === "StaticBlock") {
      if (el.body && el.body.length > 0) {
        edits.push({ start: elStart, end: elEnd, replacement: "static {}" });
      }
      continue;
    }
    if (el.type === "PropertyDefinition") {
      if (el.static && el.value && !isPureStaticExpr(el.value)) {
        // Keep the static field slot for property ordering without re-running impure init
        const valStart = el.value.start - offset;
        let eqPos = valStart - 1;
        while (eqPos >= elStart && source[eqPos] !== "=") eqPos--;
        if (eqPos >= elStart) {
          const hasSemi = source[elEnd - 1] === ";";
          edits.push({ start: eqPos, end: elEnd, replacement: hasSemi ? ";" : "" });
        }
      }
      continue;
    }
    if (el.type === "MethodDefinition") {
      if (el.kind === "constructor") {
        ctorArity = computeExpectedArity(el.value.params);
        continue;
      }
      const raw = source.slice(elStart, elEnd);
      const strippedSource = el.static ? raw.replace(/^static\s+/, "") : raw;
      let keyName = null;
      let symbolIntrinsic = null;
      let identSymbolVar = null;
      if (!el.computed) {
        keyName = el.key.type === "Identifier" ? el.key.name : String(el.key.value);
      } else {
        symbolIntrinsic = extractWellKnownSymbolIntrinsic(el.key);
        if (!symbolIntrinsic && el.key.type === "Identifier") {
          identSymbolVar = el.key.name;
        }
        if (el.key.type === "Literal" && (typeof el.key.value === "string" || typeof el.key.value === "number")) {
          keyName = String(el.key.value);
        }
      }
      members.push({
        static: !!el.static,
        kind: el.kind, // "method" | "get" | "set"
        computed: !!el.computed,
        keyName,
        symbolIntrinsic,
        identSymbolVar,
        strippedSource,
        naturalLength: computeExpectedArity(el.value.params),
        hasPrototypeProp: !!el.value.generator,
      });
    }
  }

  function buildClassSource(superReplacement) {
    const allEdits = edits.slice();
    if (superReplacement != null && superInfo) {
      allEdits.push({
        start: superInfo.start,
        end: superInfo.end,
        replacement: superReplacement,
      });
    }
    if (allEdits.length === 0) return source;
    allEdits.sort((a, b) => a.start - b.start);
    let out = "";
    let cursor = 0;
    for (const e of allEdits) {
      out += source.slice(cursor, e.start) + e.replacement;
      cursor = e.end;
    }
    out += source.slice(cursor);
    return out;
  }

  return {
    ctorArity,
    hasStaticPrivate,
    hasInstancePrivate,
    superInfo,
    members,
    buildClassSource,
  };
}

function parseFunctionSource(fnNode) {
  const source = fnNode.source;
  if (typeof source !== "string" || source.trim().length === 0) {
    return { bailout: "missing function source" };
  }
  if (/\{\s*\[native code\]\s*\}\s*$/.test(source)) {
    return { bailout: "native/host function without intrinsic path" };
  }

  const declaredKind = fnNode.kind || null;
  const forceConcise =
    declaredKind === "method" || declaredKind === "getter" || declaredKind === "setter";

  if (!forceConcise) {
    let exprAst = null;
    try {
      const wrapped = `(\n${source}\n)`;
      const prog = acorn.parse(wrapped, { ecmaVersion: "latest" });
      if (prog.body.length === 1 && prog.body[0].type === "ExpressionStatement") {
        exprAst = prog.body[0].expression;
      }
    } catch (_e) {
      exprAst = null;
    }

    if (exprAst) {
      if (exprAst.type === "FunctionExpression") {
        const actualKind =
          exprAst.async && exprAst.generator
            ? "asyncGenerator"
            : exprAst.async
              ? "async"
              : exprAst.generator
                ? "generator"
                : "normal";
        const safety = analyzeAstSafety(exprAst, actualKind);
        if (safety.bailout) return { bailout: safety.bailout };
        const idName = exprAst.id ? exprAst.id.name : "";
        const mutatesOwnId = idName ? doesBodyAssignName(exprAst, idName) : false;
        const idStart = exprAst.id ? exprAst.id.start - 2 : 0;
        const idEnd = exprAst.id ? exprAst.id.end - 2 : 0;
        const assignedOuter = new Set(safety.assignedOuter);
        if (mutatesOwnId) assignedOuter.add(idName);
        return {
          form: "expression",
          actualKind,
          isAsync: !!exprAst.async,
          isGenerator: !!exprAst.generator,
          naturalName: idName,
          mutatesOwnId,
          naturalLength: computeExpectedArity(exprAst.params),
          hasOwnUseStrict: hasUseStrictDirective(exprAst.body),
          hasPrototypeProp: !exprAst.async,
          prototypeWritable: true,
          isConstructible: !exprAst.async && !exprAst.generator,
          assignedOuter,
          capturesThis: false,
          capturesArguments: false,
          buildExpr(stripOwnId) {
            if (stripOwnId && idName) {
              return source.slice(0, idStart) + source.slice(idEnd);
            }
            return source;
          },
        };
      }

      if (exprAst.type === "ArrowFunctionExpression") {
        const safety = analyzeAstSafety(exprAst, "arrow");
        if (safety.bailout) return { bailout: safety.bailout };
        if (safety.capturesArguments) {
          return { bailout: "arrow function captures arguments" };
        }
        if (safety.capturesSuperOrNewTarget) {
          return { bailout: "arrow function captures super or new.target" };
        }
        return {
          form: "arrow",
          actualKind: "arrow",
          isAsync: !!exprAst.async,
          isGenerator: false,
          naturalName: "",
          naturalLength: computeExpectedArity(exprAst.params),
          hasOwnUseStrict:
            exprAst.body.type === "BlockStatement" && hasUseStrictDirective(exprAst.body),
          hasPrototypeProp: false,
          prototypeWritable: false,
          isConstructible: false,
          assignedOuter: safety.assignedOuter,
          capturesThis: safety.capturesThis,
          capturesArguments: false,
          buildExpr() {
            return source;
          },
        };
      }

      if (exprAst.type === "ClassExpression") {
        const safety = analyzeAstSafety(exprAst, "class");
        if (safety.bailout) return { bailout: safety.bailout };
        const classInfo = analyzeClassExpr(exprAst, source, 2);
        return {
          form: "class",
          actualKind: "class",
          isAsync: false,
          isGenerator: false,
          naturalName: exprAst.id ? exprAst.id.name : "",
          naturalLength: classInfo.ctorArity,
          hasOwnUseStrict: true,
          hasPrototypeProp: true,
          prototypeWritable: false,
          isConstructible: true,
          assignedOuter: safety.assignedOuter,
          capturesThis: false,
          capturesArguments: false,
          classInfo,
          buildExpr(superReplacement) {
            return classInfo.buildClassSource(superReplacement);
          },
        };
      }
    }
  }

  // Try object-member concise form: ({ <source> })
  let propAst = null;
  try {
    const wrappedObj = `({\n${source}\n})`;
    const prog = acorn.parse(wrappedObj, { ecmaVersion: "latest" });
    if (
      prog.body.length === 1 &&
      prog.body[0].type === "ExpressionStatement" &&
      prog.body[0].expression.type === "ObjectExpression" &&
      prog.body[0].expression.properties.length === 1
    ) {
      const p = prog.body[0].expression.properties[0];
      if (p.type === "Property" && (p.method || p.kind === "get" || p.kind === "set")) {
        propAst = p;
      }
    }
  } catch (_e) {
    propAst = null;
  }

  if (propAst) {
    const actualKind =
      propAst.kind === "get" ? "getter" : propAst.kind === "set" ? "setter" : "method";
    const safety = analyzeAstSafety(propAst.value, actualKind);
    if (safety.bailout) return { bailout: safety.bailout };

    const isGenerator = !!propAst.value.generator;
    const isAsync = !!propAst.value.async;
    const naturalLength = computeExpectedArity(propAst.value.params);
    const hasOwnUseStrict = hasUseStrictDirective(propAst.value.body);

    if (!propAst.computed) {
      const keyStr =
        propAst.key.type === "Identifier" ? propAst.key.name : String(propAst.key.value);
      const naturalName =
        actualKind === "getter"
          ? `get ${keyStr}`
          : actualKind === "setter"
            ? `set ${keyStr}`
            : keyStr;
      return {
        form: "concise",
        actualKind,
        isAsync,
        isGenerator,
        naturalName,
        naturalLength,
        hasOwnUseStrict,
        hasPrototypeProp: isGenerator,
        prototypeWritable: isGenerator,
        isConstructible: false,
        assignedOuter: safety.assignedOuter,
        usesFreeSuper: safety.usesFreeSuper,
        capturesThis: false,
        capturesArguments: false,
        needsExtractHelper: false,
        buildExpr() {
          if (actualKind === "getter") {
            return `Object.getOwnPropertyDescriptor({\n${source}\n}, ${quoteString(keyStr)}).get`;
          }
          if (actualKind === "setter") {
            return `Object.getOwnPropertyDescriptor({\n${source}\n}, ${quoteString(keyStr)}).set`;
          }
          return formatMemberAccess(`({\n${source}\n})`, keyStr);
        },
      };
    }

    // Computed concise method / getter / setter: e.g. `[sym](x) {}` or `get [sym]()`
    const offset = 3; // "({\n"
    // Find '[' before propAst.key.start and ']' after propAst.key.end
    let lbr = propAst.key.start - offset - 1;
    while (lbr >= 0 && source[lbr] !== "[") lbr--;
    let rbr = propAst.key.end - offset;
    while (rbr < source.length && source[rbr] !== "]") rbr++;

    return {
      form: "conciseComputed",
      actualKind,
      isAsync,
      isGenerator,
      naturalName: null, // Computed at runtime or replaced; force check against fnNode.name/props
      naturalLength,
      hasOwnUseStrict,
      hasPrototypeProp: isGenerator,
      prototypeWritable: isGenerator,
      isConstructible: false,
      assignedOuter: safety.assignedOuter,
      capturesThis: false,
      capturesArguments: false,
      computedKeyNode: propAst.key,
      buildExpr(opts) {
        const { extractHelperName, dummyKey, inScopeVars } = opts;
        if (isSafeComputedKeyExpr(propAst.key, inScopeVars) && extractHelperName) {
          const kindCode = actualKind === "getter" ? 1 : actualKind === "setter" ? 2 : 0;
          return `${extractHelperName}({\n${source}\n}, ${kindCode})`;
        }
        const rewritten = source.slice(0, lbr) + dummyKey + source.slice(rbr + 1);
        if (actualKind === "getter") {
          return `Object.getOwnPropertyDescriptor({\n${rewritten}\n}, ${quoteString(dummyKey)}).get`;
        }
        if (actualKind === "setter") {
          return `Object.getOwnPropertyDescriptor({\n${rewritten}\n}, ${quoteString(dummyKey)}).set`;
        }
        return `({\n${rewritten}\n}).${dummyKey}`;
      },
    };
  }

  return { bailout: `unparseable function source: ${source.slice(0, 60)}` };
}

module.exports = {
  parseFunctionSource,
};
