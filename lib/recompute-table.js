"use strict";

const vm = require("node:vm");
const acorn = require("acorn");

const PURE_TABLE_GLOBALS = new Set([
  "Array",
  "ArrayBuffer",
  "BigInt",
  "BigInt64Array",
  "BigUint64Array",
  "Boolean",
  "DataView",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "Infinity",
  "Int16Array",
  "Int32Array",
  "Int8Array",
  "Math",
  "NaN",
  "Number",
  "Object",
  "String",
  "Uint16Array",
  "Uint32Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "undefined",
]);

function isIdentOrDigitChar(ch) {
  if (ch === undefined) return false;
  return (
    (ch >= 48 && ch <= 57) ||
    (ch >= 65 && ch <= 90) ||
    (ch >= 97 && ch <= 122) ||
    ch === 36 ||
    ch === 95 ||
    ch > 127
  );
}

function needsSpaceBetween(prevChar, nextChar) {
  if (prevChar === undefined || nextChar === undefined) return false;
  if (isIdentOrDigitChar(prevChar) && isIdentOrDigitChar(nextChar)) return true;
  if (prevChar === 43 && nextChar === 43) return true; // + +
  if (prevChar === 45 && nextChar === 45) return true; // - -
  if (prevChar === 47 && (nextChar === 47 || nextChar === 42 || nextChar === 61)) return true; // / / or / * or / =
  if (prevChar === 60 && nextChar === 33) return true; // < !
  return false;
}

/**
 * Strip comments and horizontal indentation strictly between Acorn tokens while preserving
 * 100% of string/regex/template literal contents and 100% of newlines for ASI safety.
 */
function compactJsTokens(source) {
  if (typeof source !== "string" || source.length === 0) return source;
  try {
    const out = [];
    let prevEnd = 0;
    let hasFirst = false;
    const iter = acorn.tokenizer(source, { ecmaVersion: "latest" });
    while (true) {
      const tok = iter.getToken();
      if (tok.type.label === "eof") break;
      const gap = source.slice(prevEnd, tok.start);
      if (hasFirst && gap.length > 0) {
        if (/[\n\r\u2028\u2029]/.test(gap)) {
          out.push("\n");
        } else if (needsSpaceBetween(source.charCodeAt(prevEnd - 1), source.charCodeAt(tok.start))) {
          out.push(" ");
        }
      }
      out.push(source.slice(tok.start, tok.end));
      prevEnd = tok.end;
      hasFirst = true;
    }
    return out.join("");
  } catch {
    return source;
  }
}

function collectPatternBoundNames(pat, out) {
  if (!pat || typeof pat !== "object") return;
  switch (pat.type) {
    case "Identifier":
      out.add(pat.name);
      break;
    case "AssignmentPattern":
      collectPatternBoundNames(pat.left, out);
      break;
    case "RestElement":
      collectPatternBoundNames(pat.argument, out);
      break;
    case "ArrayPattern":
      for (const el of pat.elements) if (el) collectPatternBoundNames(el, out);
      break;
    case "ObjectPattern":
      for (const p of pat.properties) {
        if (p.type === "RestElement") collectPatternBoundNames(p.argument, out);
        else collectPatternBoundNames(p.value, out);
      }
      break;
  }
}

function collectHoistedVars(body, out) {
  function scan(n) {
    if (!n || typeof n !== "object") return;
    if (
      n !== body &&
      (n.type === "FunctionDeclaration" ||
        n.type === "FunctionExpression" ||
        n.type === "ArrowFunctionExpression")
    ) {
      if (n.type === "FunctionDeclaration" && n.id) out.add(n.id.name);
      return;
    }
    if (n.type === "VariableDeclaration" && n.kind === "var") {
      for (const d of n.declarations) collectPatternBoundNames(d.id, out);
    }
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      const c = n[k];
      if (Array.isArray(c)) c.forEach(scan);
      else if (c && typeof c.type === "string") scan(c);
    }
  }
  scan(body);
}

function analyzeDeclPurity(stmt) {
  let unsafe = false;
  const free = new Set();
  const mutatedFree = new Set();

  function walk(node, bound) {
    if (!node || typeof node !== "object" || unsafe) return;
    switch (node.type) {
      case "WithStatement":
      case "AwaitExpression":
      case "YieldExpression":
      case "MetaProperty":
      case "Super":
      case "ThisExpression":
        unsafe = true;
        return;

      case "Identifier":
        if (!bound.has(node.name)) free.add(node.name);
        return;

      case "AssignmentExpression":
        if (node.left.type === "Identifier" && !bound.has(node.left.name)) {
          mutatedFree.add(node.left.name);
        }
        walk(node.left, bound);
        walk(node.right, bound);
        return;

      case "UpdateExpression":
        if (node.argument.type === "Identifier" && !bound.has(node.argument.name)) {
          mutatedFree.add(node.argument.name);
        }
        walk(node.argument, bound);
        return;

      case "MemberExpression":
        walk(node.object, bound);
        if (node.computed) walk(node.property, bound);
        return;

      case "Property":
        if (node.computed) walk(node.key, bound);
        walk(node.value, bound);
        return;

      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        const nextBound = new Set(bound);
        if (node.id) nextBound.add(node.id.name);
        if (node.type !== "ArrowFunctionExpression") nextBound.add("arguments");
        for (const p of node.params) collectPatternBoundNames(p, nextBound);
        for (const p of node.params) {
          if (p.type === "AssignmentPattern") walk(p.right, nextBound);
        }
        if (node.body && node.body.type === "BlockStatement") {
          collectHoistedVars(node.body, nextBound);
          walkBlock(node.body.body, nextBound);
        } else if (node.body) {
          walk(node.body, nextBound);
        }
        return;
      }

      case "BlockStatement":
        walkBlock(node.body, bound);
        return;

      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const nextBound = new Set(bound);
        const init = node.type === "ForStatement" ? node.init : node.left;
        if (init && init.type === "VariableDeclaration" && init.kind !== "var") {
          for (const d of init.declarations) collectPatternBoundNames(d.id, nextBound);
        }
        for (const k of ["init", "left", "right", "test", "update", "body"]) {
          if (node[k]) walk(node[k], k === "right" ? bound : nextBound);
        }
        return;
      }

      case "VariableDeclarator":
        if (node.init) walk(node.init, bound);
        return;

      case "LabeledStatement":
        walk(node.body, bound);
        return;

      case "BreakStatement":
      case "ContinueStatement":
        return;
    }

    for (const k of Object.keys(node)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      const c = node[k];
      if (Array.isArray(c)) {
        for (const item of c) if (item && typeof item.type === "string") walk(item, bound);
      } else if (c && typeof c.type === "string") {
        walk(c, bound);
      }
    }
  }

  function walkBlock(stmts, outerBound) {
    const nextBound = new Set(outerBound);
    for (const s of stmts) {
      if (s.type === "VariableDeclaration" && s.kind !== "var") {
        for (const d of s.declarations) collectPatternBoundNames(d.id, nextBound);
      } else if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) {
        nextBound.add(s.id.name);
      }
    }
    for (const s of stmts) walk(s, nextBound);
  }

  const topBound = new Set();
  if (stmt.type === "FunctionDeclaration" && stmt.id) {
    topBound.add(stmt.id.name);
  } else if (stmt.type === "VariableDeclaration") {
    for (const d of stmt.declarations) collectPatternBoundNames(d.id, topBound);
  }
  walk(stmt, topBound);
  return { unsafe, defined: topBound, free, mutatedFree };
}

/**
 * Discover pure, deterministic ArrayBuffer recomputation recipes in `originalCode`
 * for buffers in `targetBuffers` (`Map<bufNodeId, Buffer>`).
 * Returns `{ sharedPreludeLines, exprByBufId }` where every recipe is verified by
 * executing in an isolated pure-ES VM context and checking byte-for-byte `Buffer.equals`.
 */
function findPureBufferRecomputeRecipes(originalCode, targetBuffers, allocTempVar) {
  const exprByBufId = new Map();
  const sharedPreludeLines = [];
  if (typeof originalCode !== "string" || !targetBuffers || targetBuffers.size === 0) {
    return { sharedPreludeLines, exprByBufId };
  }

  let ast;
  try {
    ast = acorn.parse(originalCode, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true,
    });
  } catch {
    return { sharedPreludeLines, exprByBufId };
  }

  const candidateStmtLists = [ast.body];
  function collectFnBodies(node) {
    if (!node || typeof node !== "object") return;
    if (
      (node.type === "FunctionExpression" ||
        node.type === "FunctionDeclaration" ||
        node.type === "ArrowFunctionExpression") &&
      node.body &&
      node.body.type === "BlockStatement"
    ) {
      candidateStmtLists.push(node.body.body);
    }
    for (const k of Object.keys(node)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      const c = node[k];
      if (Array.isArray(c)) c.forEach(collectFnBodies);
      else if (c && typeof c.type === "string") collectFnBodies(c);
    }
  }
  collectFnBodies(ast);

  const remaining = new Map(targetBuffers);

  for (const stmts of candidateStmtLists) {
    if (remaining.size === 0) break;
    if (!Array.isArray(stmts) || stmts.length === 0) continue;

    // Collect pure FunctionDeclaration / VariableDeclaration statements in `stmts`
    const pureDecls = []; // { idx, stmt, src, defined, free }
    const nameToDeclIdx = new Map();
    const mutatedAnywhereInBlock = new Set();

    // Also check if any subsequent statement in `stmts` reassigns a candidate binding
    for (const s of stmts) {
      const info = analyzeDeclPurity(s);
      for (const m of info.mutatedFree) mutatedAnywhereInBlock.add(m);
    }

    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      if (s.type !== "FunctionDeclaration" && s.type !== "VariableDeclaration") continue;
      const info = analyzeDeclPurity(s);
      if (info.unsafe || info.mutatedFree.size > 0 || info.defined.size === 0) continue;
      let shadowedOrMutated = false;
      for (const dn of info.defined) {
        if (nameToDeclIdx.has(dn) || mutatedAnywhereInBlock.has(dn)) {
          shadowedOrMutated = true;
          break;
        }
      }
      if (shadowedOrMutated) continue;

      let depsPure = true;
      for (const f of info.free) {
        if (!PURE_TABLE_GLOBALS.has(f) && !nameToDeclIdx.has(f)) {
          depsPure = false;
          break;
        }
      }
      if (!depsPure) continue;

      const dIdx = pureDecls.length;
      pureDecls.push({
        dIdx,
        stmt: s,
        rawSrc: originalCode.slice(s.start, s.end),
        defined: info.defined,
        free: info.free,
      });
      for (const dn of info.defined) nameToDeclIdx.set(dn, dIdx);
    }

    if (!pureDecls.some(d => d.stmt.type === "VariableDeclaration")) continue;

    // Execute pureDecls in a sealed pure-ECMAScript VM context with Date & Math.random disabled!
    const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY);
    vm.runInContext(
      "delete globalThis.console; delete globalThis.WebAssembly; delete globalThis.Date; Math.random = function(){ throw new Error('volatile'); };",
      ctx
    );

    const varNamesToProbe = [];
    for (const d of pureDecls) {
      if (d.stmt.type === "VariableDeclaration") {
        for (const dn of d.defined) varNamesToProbe.push({ name: dn, dIdx: d.dIdx });
      }
    }

    const probeCode =
      pureDecls.map(d => d.rawSrc).join("\n;\n") +
      "\n;([" +
      varNamesToProbe.map(v => `[${JSON.stringify(v.name)}, ${v.name}]`).join(", ") +
      "]);";

    let evaluatedPairs;
    try {
      evaluatedPairs = vm.runInContext(probeCode, ctx, { timeout: 60 });
    } catch {
      continue;
    }

    // Match produced ArrayBuffers byte-for-byte against `remaining` target buffers
    const matchedInBlock = []; // Array<{ bufId, retExpr, rootDeclIdx, byteLen }>
    for (let i = 0; i < evaluatedPairs.length && remaining.size > 0; i++) {
      const [vName, val] = evaluatedPairs[i];
      const rootDeclIdx = varNamesToProbe[i].dIdx;
      const candidates = [];
      if (val && ArrayBuffer.isView(val) && val.buffer) {
        candidates.push({ ab: val.buffer, expr: `${vName}.buffer` });
      } else if (val && Object.prototype.toString.call(val) === "[object ArrayBuffer]") {
        candidates.push({ ab: val, expr: vName });
      } else if (Array.isArray(val) && val.length > 0 && val[0] && ArrayBuffer.isView(val[0]) && val[0].buffer) {
        candidates.push({ ab: val[0].buffer, expr: `${vName}[0].buffer` });
      }

      for (const cand of candidates) {
        const candBuf = Buffer.from(cand.ab, 0, cand.ab.byteLength);
        for (const [bufId, targetBuf] of remaining.entries()) {
          if (candBuf.length === targetBuf.length && candBuf.equals(targetBuf)) {
            matchedInBlock.push({
              bufId,
              retExpr: cand.expr,
              rootDeclIdx,
              byteLen: targetBuf.length,
            });
            remaining.delete(bufId);
            break;
          }
        }
      }
    }

    if (matchedInBlock.length === 0) continue;

    // Collect minimal backward closure of `pureDecls` needed for all `matchedInBlock`
    const neededDeclIdxs = new Set();
    function markDecl(idx) {
      if (neededDeclIdxs.has(idx)) return;
      neededDeclIdxs.add(idx);
      for (const f of pureDecls[idx].free) {
        if (nameToDeclIdx.has(f)) markDecl(nameToDeclIdx.get(f));
      }
    }
    for (const m of matchedInBlock) markDecl(m.rootDeclIdx);

    const orderedIdx = Array.from(neededDeclIdxs).sort((a, b) => a - b);
    const compactSlice = compactJsTokens(orderedIdx.map(idx => pureDecls[idx].rawSrc).join("\n"));
    const totalB64Bytes = matchedInBlock.reduce((acc, m) => acc + Math.ceil((m.byteLen * 4) / 3), 0);

    if (matchedInBlock.length === 1) {
      const m = matchedInBlock[0];
      const iifeExpr = `(function(){${compactSlice};return ${m.retExpr};})()`;
      if (iifeExpr.length * 2 < totalB64Bytes) {
        exprByBufId.set(m.bufId, iifeExpr);
      }
    } else {
      const retArr = `[${matchedInBlock.map(m => m.retExpr).join(",")}]`;
      const tupleVar = allocTempVar();
      const iifeLine = `var ${tupleVar} = (function(){${compactSlice};return ${retArr};})();`;
      if (iifeLine.length * 2 < totalB64Bytes) {
        sharedPreludeLines.push(iifeLine);
        for (let i = 0; i < matchedInBlock.length; i++) {
          exprByBufId.set(matchedInBlock[i].bufId, `${tupleVar}[${i}]`);
        }
      }
    }
  }

  return { sharedPreludeLines, exprByBufId };
}

module.exports = {
  compactJsTokens,
  findPureBufferRecomputeRecipes,
};
