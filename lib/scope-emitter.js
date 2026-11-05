"use strict";

const { isBindingIdentifier, isStrictSafeBinding, resolveIntrinsicExpr } = require("./intrinsics");

/**
 * Emit a root scope tree as a self-contained scope-factory IIFE that captures
 * zero outer helper variables (all external references enter via `__h$p` and
 * all created functions/setters exit via `__h$o`, both passed as parameters
 * down child scopes so V8 never allocates them in any Closure Context).
 */
function buildScopeTreeEmitter(ctx) {
  const {
    prefix,
    nodes,
    parsedFns,
    claimedClassProtos, // classId -> protoId
    extractedClassMembers, // classId -> Array<{ fnId, fromProto, kind, keyExpr, propKey }>
    claimedFnProtos, // fnId -> protoId
     bail,
  } = ctx;

  // Build scope children & direct functions map for reachable scopes/functions
  const scopeChildren = new Map(); // scopeId -> scopeId[]
  const scopeFns = new Map(); // scopeId -> fnId[]

  for (const sId of ctx.reachableScopes) {
    scopeChildren.set(sId, []);
    scopeFns.set(sId, []);
  }
  for (const sId of ctx.reachableScopes) {
    const pId = nodes[sId].parent || null;
    if (pId && scopeChildren.has(pId)) {
      scopeChildren.get(pId).push(sId);
    }
  }
  for (const fnId of ctx.reachableFunctions) {
    const fnNode = nodes[fnId];
    if (fnNode.bound) continue;
    if (ctx.memberExtractedFnIds.has(fnId)) continue;
    const sId = fnNode.scope || null;
    if (sId && scopeFns.has(sId)) {
      scopeFns.get(sId).push(fnId);
    }
  }

  // Compute subtree properties: allStrict, strictSafeVars, assignedOuterNames, producedNodeIds
  const subtreeMeta = new Map();

  function computeSubtreeMeta(sId) {
    if (subtreeMeta.has(sId)) return subtreeMeta.get(sId);
    const sNode = nodes[sId];
    const vars = Array.isArray(sNode.vars) ? sNode.vars : [];
    let allStrict = true;
    let hasAnyFn = false;
    let strictSafe = true;
    const assignedNames = new Set();
    const producedIds = new Set();

    for (const v of vars) {
      if (v.name === "this") continue;
      if (!isStrictSafeBinding(v.name)) strictSafe = false;
    }

    for (const fnId of scopeFns.get(sId) || []) {
      hasAnyFn = true;
      const fnNode = nodes[fnId];
      if (!fnNode.strict) allStrict = false;
      const parsed = parsedFns.get(fnId);
      if (parsed && parsed.assignedOuter) {
        for (const nm of parsed.assignedOuter) assignedNames.add(nm);
      }
      addProducedByFn(fnId, producedIds);
    }

    for (const cId of scopeChildren.get(sId) || []) {
      const cMeta = computeSubtreeMeta(cId);
      if (cMeta.hasAnyFn) hasAnyFn = true;
      if (!cMeta.allStrict) allStrict = false;
      if (!cMeta.strictSafe) strictSafe = false;
      for (const nm of cMeta.assignedNames) assignedNames.add(nm);
      for (const id of cMeta.producedIds) producedIds.add(id);
    }

    const meta = {
      allStrict: hasAnyFn && allStrict,
      hasAnyFn,
      strictSafe,
      canUseStrictDirective: hasAnyFn && allStrict && strictSafe,
      assignedNames,
      producedIds,
    };
    subtreeMeta.set(sId, meta);
    return meta;
  }

  function addProducedByFn(fnId, outSet) {
    outSet.add(fnId);
    if (claimedClassProtos.has(fnId)) {
      outSet.add(claimedClassProtos.get(fnId));
    }
    if (claimedFnProtos.has(fnId)) {
      outSet.add(claimedFnProtos.get(fnId));
    }
    const members = extractedClassMembers.get(fnId);
    if (members) {
      for (const m of members) outSet.add(m.fnId);
    }
  }

  for (const sId of ctx.reachableScopes) {
    computeSubtreeMeta(sId);
  }

  function buildSingleFunctionExpr(fnId, inStrictMode, inScopeVarNames, paramResolver) {
    const fnNode = nodes[fnId];
    const parsed = parsedFns.get(fnId);
    let expr;

    if (parsed.actualKind === "class") {
      const superInfo = parsed.classInfo.superInfo;
      if (superInfo && !superInfo.isNullLiteral) {
        const superRef = ctx.normalizeProtoRef(fnNode.proto, "Function.prototype");
        const ident = superInfo.identifierName;
        const isUnshadowedGlobalIntrinsic =
          ident &&
          isBindingIdentifier(ident) &&
          !inScopeVarNames.has(ident) &&
          superRef.kind === "intrinsic" &&
          resolveIntrinsicExpr(superRef.path) === ident;
        if (isUnshadowedGlobalIntrinsic) {
          expr = `(\n${parsed.buildExpr(null)}\n)`;
        } else {
          const superExpr = paramResolver(superRef);
          // If superClass is a simple identifier not already shadowed with wrong value, bind it by name to preserve toString()
          if (ident && isBindingIdentifier(ident) && !parsed.assignedOuter.has(ident)) {
            const cleanSrc = parsed.buildExpr(null);
            expr = `(function(${ident}){return (${cleanSrc})})(${superExpr})`;
          } else {
            const bParam = `${prefix}b`;
            const rewritten = parsed.buildExpr(bParam);
            expr = `(function(${bParam}){return (${rewritten})})(${superExpr})`;
          }
        }
      } else {
        expr = `(\n${parsed.buildExpr(null)}\n)`;
      }
    } else if (parsed.form === "conciseComputed") {
      const needHelper = ctx.ensureExtractMemberHelper();
      expr = parsed.buildExpr({
        extractHelperName: needHelper,
        dummyKey: `${prefix}k`,
        inScopeVars: inScopeVarNames,
      });
    } else if (parsed.form === "concise") {
      expr = parsed.buildExpr();
    } else {
      // normal / arrow / generator / async / asyncGenerator
      // If a FunctionDeclaration mutates its own name (e.g. Babel's `function _typeof(o) { _typeof = ...; }`),
      // strip the NFE identifier so assignments inside the body update the scope/global variable instead of
      // hitting an immutable NFE self-binding, and let function own-props restore `.name`!
      const stripId =
        parsed.form === "expression" &&
        parsed.mutatesOwnId &&
        (inScopeVarNames.has(parsed.naturalName) ||
          (!fnNode.scope && ctx.globalRootStringKeys.has(parsed.naturalName)));
      if (stripId) {
        ctx.strippedIdFnIds.add(fnId);
      }
      const raw = parsed.buildExpr(stripId);
      expr = parsed.naturalName === "" || stripId ? `(0,\n${raw}\n)` : `(\n${raw}\n)`;
    }

    // Handle arrow capturing `this` directly on fnNode if not already bound at scope level
    if (parsed.actualKind === "arrow" && parsed.capturesThis && fnNode.this !== undefined) {
      const thisRef = ctx.normalizeRef(fnNode.this);
      const thisExpr = paramResolver(thisRef);
      const strictDir = fnNode.strict ? '"use strict";' : "";
      expr = `(function(){${strictDir}return ${expr}}).call(${thisExpr})`;
      return expr;
    }

    const wantStrict = !!fnNode.strict;
    if (wantStrict && !inStrictMode && !parsed.hasOwnUseStrict) {
      expr = `(function(){"use strict";return ${expr}})()`;
    }
    return expr;
  }

  /**
   * Emit a standalone (scope: null) function or class creation unit.
   */
  function emitTopLevelFunction(fnId, isAvailableFn, exprForRefFn) {
    const fnNode = nodes[fnId];
    const parsed = parsedFns.get(fnId);

    if (parsed.actualKind === "arrow" && parsed.capturesThis && fnNode.this === undefined) {
      bail("arrow function captures this without captured value", fnId);
      return [];
    }

    const expr = buildSingleFunctionExpr(fnId, false, new Set(), (ref) =>
      exprForRefFn(ref, false)
    );

    // Can this top-level function be inlined at its single use site? Handled by emit.js before calling here.
    const lines = [];
    const fnVar = ctx.varName(fnId);
    lines.push(`var ${fnVar} = ${expr};`);
    emitPostFnClaims(fnId, fnVar, lines);
    return lines;
  }

  function emitPostFnClaims(fnId, fnVar, lines, outSlotAssign) {
    if (claimedClassProtos.has(fnId)) {
      const protoId = claimedClassProtos.get(fnId);
      if (outSlotAssign) {
        outSlotAssign(protoId, `${fnVar}.prototype`);
      } else {
        lines.push(`var ${ctx.varName(protoId)} = ${fnVar}.prototype;`);
      }
    }
    if (claimedFnProtos.has(fnId)) {
      const protoId = claimedFnProtos.get(fnId);
      if (outSlotAssign) {
        outSlotAssign(protoId, `${fnVar}.prototype`);
      } else {
        lines.push(`var ${ctx.varName(protoId)} = ${fnVar}.prototype;`);
      }
    }
    const members = extractedClassMembers.get(fnId);
    if (members) {
      for (const m of members) {
        if (!ctx.needsVariableForClassMember(m.fnId)) continue;
        const targetExpr = m.static
          ? fnVar
          : claimedClassProtos.has(fnId) && !outSlotAssign
            ? ctx.varName(claimedClassProtos.get(fnId))
            : `${fnVar}.prototype`;
        let extractExpr;
        if (m.kind === "get") {
          extractExpr = `Object.getOwnPropertyDescriptor(${targetExpr}, ${m.keyDescExpr}).get`;
        } else if (m.kind === "set") {
          extractExpr = `Object.getOwnPropertyDescriptor(${targetExpr}, ${m.keyDescExpr}).set`;
        } else if (m.directDotKey) {
          extractExpr = `${targetExpr}.${m.directDotKey}`;
        } else {
          extractExpr = `Object.getOwnPropertyDescriptor(${targetExpr}, ${m.keyDescExpr}).value`;
        }
        if (outSlotAssign) {
          outSlotAssign(m.fnId, extractExpr);
        } else {
          lines.push(`var ${ctx.varName(m.fnId)} = ${extractExpr};`);
        }
      }
    }
  }

  /**
   * Emit a complete root scope tree starting at `rootScopeId`.
   * Returns `{ lines, deferredSetters }` where `deferredSetters` is an array of
   * `{ callExprPrefix, valueRef }` to invoke in Phase 3 once all heap nodes exist.
   */
  function emitRootScope(rootScopeId, isRefAvailableNow, exprForRefNow) {
    const pArgName = `${prefix}p`;
    const oArgName = `${prefix}o`;
    const inputExprs = [];
    const inputIndexByKey = new Map();
    const outSlots = []; // Array<{ type: "node", nodeId } | { type: "setter", valueRef }>
    const nodeOutSlotIdx = new Map(); // nodeId -> index in __h$o
    const metaRoot = computeSubtreeMeta(rootScopeId);
    const rootProducedIds = metaRoot.producedIds;

    function addInputParam(cacheKey, expr) {
      if (cacheKey !== null && inputIndexByKey.has(cacheKey)) {
        return `${pArgName}[${inputIndexByKey.get(cacheKey)}]`;
      }
      const idx = inputExprs.length;
      inputExprs.push(expr);
      if (cacheKey !== null) {
        inputIndexByKey.set(cacheKey, idx);
      }
      return `${pArgName}[${idx}]`;
    }

    function resolveRefInsideScope(ref) {
      if (ref.kind === "prim") {
        return ctx.exprForPrimitive(ref);
      }
      if (ref.kind === "node" && nodeOutSlotIdx.has(ref.id)) {
        return `${oArgName}[${nodeOutSlotIdx.get(ref.id)}]`;
      }
      const outerExpr = exprForRefNow(ref, true);
      const cacheKey =
        ref.kind === "node"
          ? `node:${ref.id}`
          : ref.kind === "intrinsic"
            ? `intr:${ref.path}`
            : ref.kind === "global"
              ? "global"
              : null;
      return addInputParam(cacheKey, outerExpr);
    }

    function allocNodeSlot(nodeId) {
      if (nodeOutSlotIdx.has(nodeId)) return nodeOutSlotIdx.get(nodeId);
      const idx = outSlots.length;
      outSlots.push({ type: "node", nodeId });
      nodeOutSlotIdx.set(nodeId, idx);
      return idx;
    }

    function allocSetterSlot(valueRef) {
      const idx = outSlots.length;
      outSlots.push({ type: "setter", valueRef });
      return idx;
    }

    function emitScopeBody(sId, inheritedStrict, inheritedVarNames, inheritedHasThis) {
      const sNode = nodes[sId];
      const meta = computeSubtreeMeta(sId);
      const emitUseStrict = !inheritedStrict && meta.canUseStrictDirective;
      const nowStrict = inheritedStrict || emitUseStrict;
      const rawVars = Array.isArray(sNode.vars) ? sNode.vars : [];

      let thisRef = null;
      if (sNode.this !== undefined) {
        thisRef = ctx.normalizeRef(sNode.this);
      }
      const normalVars = [];
      const seenVarNames = new Set();
      for (const v of rawVars) {
        if (v.name === "this") {
          thisRef = ctx.normalizeRef(v.value);
          continue;
        }
        if (v.name === "arguments") {
          bail("captured arguments object in scope", sId);
          return { bodyLines: [], thisExpr: null, forceStrictForThis: false };
        }
        if (!isBindingIdentifier(v.name)) {
          bail(`invalid scope variable name: ${String(v.name)}`, sId);
          return { bodyLines: [], thisExpr: null, forceStrictForThis: false };
        }
        if (seenVarNames.has(v.name)) continue;
        seenVarNames.add(v.name);
        normalVars.push({
          name: v.name,
          kind: v.kind || "let",
          valRef: ctx.normalizeRef(v.value),
        });
      }

      const scopeHasThis = inheritedHasThis || thisRef !== null;
      const inScopeVars = new Set(inheritedVarNames);
      for (const v of normalVars) inScopeVars.add(v.name);

      // Check arrow functions in this scope that capture `this`
      for (const fnId of scopeFns.get(sId) || []) {
        const parsed = parsedFns.get(fnId);
        if (
          parsed &&
          parsed.actualKind === "arrow" &&
          parsed.capturesThis &&
          nodes[fnId].this === undefined &&
          !scopeHasThis
        ) {
          bail("arrow function captures this without captured value", fnId);
          return { bodyLines: [], thisExpr: null, forceStrictForThis: false };
        }
      }

      const bodyLines = [];
      let forceStrictForThis = false;
      let thisExpr = null;
      if (thisRef !== null) {
        if (!isRefAvailableNow(thisRef) && !(thisRef.kind === "node" && nodeOutSlotIdx.has(thisRef.id))) {
          bail("cyclic lexical this in scope", sId);
          return { bodyLines: [], thisExpr: null, forceStrictForThis: false };
        }
        thisExpr =
          sId === rootScopeId
            ? exprForRefNow(thisRef, true)
            : resolveRefInsideScope(thisRef);
        // Ensure primitive/null/undefined `this` isn't boxed by sloppy function entry
        if (!nowStrict && meta.strictSafe) {
          forceStrictForThis = true;
        }
      }
      const effectiveStrict = nowStrict || forceStrictForThis;
      if (emitUseStrict || forceStrictForThis) {
        bodyLines.push('"use strict";');
      }

      // Detect FunctionDeclarations (`declaration: true`, or `mutatesOwnId` self-overwriting helpers)
      // whose own name matches a mutable variable in `normalVars`. Emitting them as genuine
      // FunctionDeclarations in this scope preserves exact `fn.toString()`, `.name`, mutable
      // self-binding (`_typeof = ...`), and closure-scope resolution (`ret._setup(...)`).
      const declFnByVarName = new Map(); // varName -> fnId
      const declFnIdsInScope = new Set();
      const mutableVarByName = new Map();
      for (const v of normalVars) {
        if (v.kind !== "const") mutableVarByName.set(v.name, v);
      }
      for (const fnId of scopeFns.get(sId) || []) {
        const fnNode = nodes[fnId];
        const p = parsedFns.get(fnId);
        if (
          p &&
          p.form === "expression" &&
          p.naturalName &&
          isBindingIdentifier(p.naturalName) &&
          (fnNode.declaration === true || p.mutatesOwnId) &&
          (!!fnNode.strict === effectiveStrict || p.hasOwnUseStrict) &&
          mutableVarByName.has(p.naturalName) &&
          !declFnByVarName.has(p.naturalName)
        ) {
          declFnByVarName.set(p.naturalName, fnId);
          declFnIdsInScope.add(fnId);
        }
      }

      // Partition variables into:
      // 1. Available right now (primitives, intrinsics, pre-allocated objects/earlier units)
      // 2. Produced inside this scope or its children (`rootProducedIds` and not yet emitted -> initialize right after children/fns!)
      // 3. Deferred until Phase 3 (cycles with units emitted after this root scope)
      const postSubtreeConstInits = [];
      const postSubtreeMutableAssigns = [];
      const phase3SetterVars = [];

      for (const v of normalVars) {
        const declFnId = declFnByVarName.get(v.name) || null;
        if (declFnId) {
          // Binding itself is created by `function <name>(...) { ... }`; only emit an assignment
          // if the scope variable's current value differs from `declFnId` (e.g. overwritten during init).
          if (v.valRef.kind === "node" && v.valRef.id === declFnId) {
            continue;
          }
          const availNow =
            isRefAvailableNow(v.valRef) ||
            (v.valRef.kind === "node" && nodeOutSlotIdx.has(v.valRef.id));
          if (availNow || (v.valRef.kind === "node" && meta.producedIds.has(v.valRef.id))) {
            postSubtreeMutableAssigns.push(v);
          } else {
            phase3SetterVars.push(v);
          }
          continue;
        }

        const declKw = v.kind === "const" ? "const" : v.kind === "let" ? "let" : "var";
        const availNow =
          isRefAvailableNow(v.valRef) ||
          (v.valRef.kind === "node" && nodeOutSlotIdx.has(v.valRef.id));

        if (availNow) {
          bodyLines.push(`${declKw} ${v.name} = ${resolveRefInsideScope(v.valRef)};`);
          continue;
        }

        const producedInThisSubtree =
          v.valRef.kind === "node" && meta.producedIds.has(v.valRef.id);

        if (producedInThisSubtree) {
          if (v.kind === "const") {
            // Declared as real `const` at bottom of scope block after functions/child scopes run!
            postSubtreeConstInits.push(v);
          } else {
            bodyLines.push(`${declKw} ${v.name};`);
            postSubtreeMutableAssigns.push(v);
          }
          continue;
        }

        // Value comes from a unit after this root scope (or sibling scope later in parent)
        const producedInAncestorSibling =
          v.valRef.kind === "node" && rootProducedIds.has(v.valRef.id);

        if (v.kind === "const" && meta.assignedNames.has(v.name)) {
          bail(`cyclic const variable '${v.name}' written by closure`, sId);
          return { bodyLines: [], thisExpr: null, forceStrictForThis: false };
        }

        const fallbackKw = v.kind === "const" || v.kind === "let" ? "let" : "var";
        bodyLines.push(`${fallbackKw} ${v.name};`);
        if (producedInAncestorSibling) {
          // Still inside rootScope; register a setter slot too for uniform simplicity
          phase3SetterVars.push(v);
        } else {
          phase3SetterVars.push(v);
        }
      }

      // Order direct functions/classes and child scopes within `sId` so `class Sub extends Super`
      // sees `Super` when `Super` is in `sId` or an earlier child scope of `sId`.
      const items = [];
      for (const fnId of scopeFns.get(sId) || []) {
        const produced = new Set();
        addProducedByFn(fnId, produced);
        const deps = new Set();
        const parsed = parsedFns.get(fnId);
        if (parsed && parsed.actualKind === "class" && parsed.classInfo.superInfo && !parsed.classInfo.superInfo.isNullLiteral) {
          const superRef = ctx.normalizeProtoRef(nodes[fnId].proto, "Function.prototype");
          if (superRef.kind === "node") deps.add(superRef.id);
        }
        items.push({ kind: "fn", id: fnId, produced, deps });
      }
      for (const cId of scopeChildren.get(sId) || []) {
        const cMeta = computeSubtreeMeta(cId);
        const deps = new Set();
        collectSubtreeClassSuperDeps(cId, deps);
        for (const v of nodes[cId].vars || []) {
          if (v && v.value !== undefined) {
            const vr = ctx.normalizeRef(v.value);
            if (vr.kind === "node") deps.add(vr.id);
          }
        }
        items.push({ kind: "scope", id: cId, produced: cMeta.producedIds, deps });
      }

      const orderedItems = topoSortScopeItems(items);

      // Identify repeated leaf child-scope templates (e.g. closure factories called N times during init)
      const leafCandidates = new Map(); // cId -> { sig, cVars, fnIds, cMeta, srcBytes }
      const sigCounts = new Map();
      if (!scopeHasThis) {
        const producedSoFar = new Set(nodeOutSlotIdx.keys());
        for (const item of orderedItems) {
          if (item.kind !== "scope") {
            for (const pId of item.produced) producedSoFar.add(pId);
            continue;
          }
          const cId = item.id;
          if ((scopeChildren.get(cId) || []).length > 0) {
            for (const pId of item.produced) producedSoFar.add(pId);
            continue;
          }
          const cNode = nodes[cId];
          if (cNode.this !== undefined) {
            for (const pId of item.produced) producedSoFar.add(pId);
            continue;
          }
          const fnIds = scopeFns.get(cId) || [];
          if (fnIds.length === 0) continue;
          const cRawVars = Array.isArray(cNode.vars) ? cNode.vars : [];
          let eligible = true;
          const cVars = [];
          const seenC = new Set();
          for (const v of cRawVars) {
            if (v.name === "this" || v.name === "arguments" || !isBindingIdentifier(v.name)) {
              eligible = false;
              break;
            }
            if (seenC.has(v.name)) continue;
            seenC.add(v.name);
            const vRef = ctx.normalizeRef(v.value);
            if (
              !isRefAvailableNow(vRef) &&
              !(vRef.kind === "node" && producedSoFar.has(vRef.id))
            ) {
              eligible = false;
              break;
            }
            cVars.push({ name: v.name, kind: v.kind || "let", valRef: vRef });
          }
          for (const pId of item.produced) producedSoFar.add(pId);
          if (!eligible) continue;

          let srcBytes = 0;
          for (const fId of fnIds) {
            const p = parsedFns.get(fId);
            if (
              !p ||
              p.actualKind === "class" ||
              p.form === "conciseComputed" ||
              p.capturesThis ||
              nodes[fId].this !== undefined ||
              (p.form === "expression" &&
                p.naturalName &&
                (nodes[fId].declaration === true || p.mutatesOwnId) &&
                seenC.has(p.naturalName))
            ) {
              eligible = false;
              break;
            }
            srcBytes += nodes[fId].source.length;
          }
          if (!eligible) continue;

          const cMeta = computeSubtreeMeta(cId);
          const childUseStrict = !effectiveStrict && cMeta.canUseStrictDirective;
          const cInScope = new Set(inScopeVars);
          for (const v of cVars) cInScope.add(v.name);

          const sig = JSON.stringify({
            u: childUseStrict,
            v: cVars.map((v) => [v.name, v.kind]),
            f: fnIds.map((fId) => {
              const p = parsedFns.get(fId);
              const willStrip =
                p.form === "expression" && p.mutatesOwnId && cInScope.has(p.naturalName);
              return [!!nodes[fId].strict, nodes[fId].kind || "", willStrip, nodes[fId].source];
            }),
          });
          leafCandidates.set(cId, { sig, cVars, fnIds, childUseStrict, cInScope, srcBytes });
          sigCounts.set(sig, (sigCounts.get(sig) || 0) + 1);
        }
      }

      const emittedTemplates = new Map(); // sig -> tplFnName
      let tplSeq = 0;

      for (const item of orderedItems) {
        if (item.kind === "fn") {
          const fnId = item.id;
          const slotIdx = allocNodeSlot(fnId);
          const fnSlotExpr = `${oArgName}[${slotIdx}]`;
          if (declFnIdsInScope.has(fnId)) {
            const p = parsedFns.get(fnId);
            bodyLines.push(p.buildExpr(false));
            bodyLines.push(`${fnSlotExpr} = ${p.naturalName};`);
          } else {
            const expr = buildSingleFunctionExpr(
              fnId,
              effectiveStrict,
              inScopeVars,
              resolveRefInsideScope
            );
            bodyLines.push(`${fnSlotExpr} = ${expr};`);
          }
          emitPostFnClaims(fnId, fnSlotExpr, bodyLines, (claimedNodeId, claimExpr) => {
            const cSlot = allocNodeSlot(claimedNodeId);
            bodyLines.push(`${oArgName}[${cSlot}] = ${claimExpr};`);
          });
        } else {
          const cId = item.id;
          const cand = leafCandidates.get(cId);
          const count = cand ? sigCounts.get(cand.sig) || 0 : 0;
          if (cand && count >= 2 && cand.srcBytes * (count - 1) >= 80) {
            let tplName = emittedTemplates.get(cand.sig);
            if (!tplName) {
              tplName = `${prefix}t${tplSeq++}`;
              emittedTemplates.set(cand.sig, tplName);
              const argNames = cand.cVars.map((_, idx) => `${prefix}a${idx}`);
              const tplLines = [];
              if (cand.childUseStrict) tplLines.push('"use strict";');
              for (let i = 0; i < cand.cVars.length; i++) {
                const cv = cand.cVars[i];
                const kw = cv.kind === "const" ? "const" : cv.kind === "let" ? "let" : "var";
                tplLines.push(`${kw} ${cv.name} = ${argNames[i]};`);
              }
              const tplStrict = effectiveStrict || cand.childUseStrict;
              const fnExprs = cand.fnIds.map((fId) =>
                buildSingleFunctionExpr(fId, tplStrict, cand.cInScope, resolveRefInsideScope)
              );
              if (fnExprs.length === 1) {
                tplLines.push(`return ${fnExprs[0]};`);
              } else {
                tplLines.push(`return [${fnExprs.join(", ")}];`);
              }
              bodyLines.push(`var ${tplName} = function(${argNames.join(", ")}) {`);
              for (const tl of tplLines) bodyLines.push(tl.length > 0 ? `  ${tl}` : tl);
              bodyLines.push(`};`);
            } else {
              // Ensure strippedIdFnIds is also marked for subsequent instances of this template!
              for (const fId of cand.fnIds) {
                const p = parsedFns.get(fId);
                if (p.form === "expression" && p.mutatesOwnId && cand.cInScope.has(p.naturalName)) {
                  ctx.strippedIdFnIds.add(fId);
                }
              }
            }

            const callArgs = cand.cVars.map((cv) => resolveRefInsideScope(cv.valRef)).join(", ");
            if (cand.fnIds.length === 1) {
              const fId = cand.fnIds[0];
              const slotIdx = allocNodeSlot(fId);
              const fnSlotExpr = `${oArgName}[${slotIdx}]`;
              bodyLines.push(`${fnSlotExpr} = ${tplName}(${callArgs});`);
              emitPostFnClaims(fId, fnSlotExpr, bodyLines, (claimedNodeId, claimExpr) => {
                const cSlot = allocNodeSlot(claimedNodeId);
                bodyLines.push(`${oArgName}[${cSlot}] = ${claimExpr};`);
              });
            } else {
              const tmpRes = `${prefix}tr`;
              bodyLines.push(`var ${tmpRes} = ${tplName}(${callArgs});`);
              for (let i = 0; i < cand.fnIds.length; i++) {
                const fId = cand.fnIds[i];
                const slotIdx = allocNodeSlot(fId);
                const fnSlotExpr = `${oArgName}[${slotIdx}]`;
                bodyLines.push(`${fnSlotExpr} = ${tmpRes}[${i}];`);
                emitPostFnClaims(fId, fnSlotExpr, bodyLines, (claimedNodeId, claimExpr) => {
                  const cSlot = allocNodeSlot(claimedNodeId);
                  bodyLines.push(`${oArgName}[${cSlot}] = ${claimExpr};`);
                });
              }
            }
          } else {
            const childRes = emitScopeBody(cId, effectiveStrict, inScopeVars, scopeHasThis);
            const passThis = childRes.thisExpr !== null ? childRes.thisExpr : scopeHasThis ? "this" : null;
            if (passThis !== null) {
              bodyLines.push(`(function(${oArgName}, ${pArgName}) {`);
              for (const cl of childRes.bodyLines) bodyLines.push(cl.length > 0 ? `  ${cl}` : cl);
              bodyLines.push(`}).call(${passThis}, ${oArgName}, ${pArgName});`);
            } else {
              bodyLines.push(`(function(${oArgName}, ${pArgName}) {`);
              for (const cl of childRes.bodyLines) bodyLines.push(cl.length > 0 ? `  ${cl}` : cl);
              bodyLines.push(`})(${oArgName}, ${pArgName});`);
            }
          }
        }
      }

      for (const v of postSubtreeConstInits) {
        bodyLines.push(`const ${v.name} = ${resolveRefInsideScope(v.valRef)};`);
      }
      for (const v of postSubtreeMutableAssigns) {
        bodyLines.push(`${v.name} = ${resolveRefInsideScope(v.valRef)};`);
      }
      for (const v of phase3SetterVars) {
        const setSlot = allocSetterSlot(v.valRef);
        bodyLines.push(`${oArgName}[${setSlot}] = function(${prefix}v) { ${v.name} = ${prefix}v; };`);
      }

      return { bodyLines, thisExpr, forceStrictForThis };
    }

    function collectSubtreeClassSuperDeps(sId, outDeps) {
      for (const fnId of scopeFns.get(sId) || []) {
        const parsed = parsedFns.get(fnId);
        if (
          parsed &&
          parsed.actualKind === "class" &&
          parsed.classInfo.superInfo &&
          !parsed.classInfo.superInfo.isNullLiteral
        ) {
          const superRef = ctx.normalizeProtoRef(nodes[fnId].proto, "Function.prototype");
          if (superRef.kind === "node") outDeps.add(superRef.id);
        }
      }
      for (const cId of scopeChildren.get(sId) || []) {
        collectSubtreeClassSuperDeps(cId, outDeps);
      }
    }

    const rootRes = emitScopeBody(rootScopeId, false, new Set(), false);
    if (ctx.hasBailouts()) return { lines: [], deferredSetters: [] };

    const hasChildScopes = (scopeChildren.get(rootScopeId) || []).length > 0;
    const needInputParam = inputExprs.length > 0;
    const paramSig = needInputParam || hasChildScopes ? pArgName : "";
    const callArg = needInputParam ? `[${inputExprs.join(", ")}]` : "";

    const hasTopStrict = rootRes.bodyLines[0] === '"use strict";';
    const factoryBody = hasTopStrict
      ? [
          '"use strict";',
          `var ${oArgName} = [];`,
          ...rootRes.bodyLines.slice(1),
          `return ${oArgName};`,
        ]
      : [
          `var ${oArgName} = [];`,
          ...rootRes.bodyLines,
          `return ${oArgName};`,
        ];

    const resVar = ctx.allocTempVar();
    const lines = [];
    lines.push(`var ${resVar} = (function(${paramSig}) {`);
    for (const fl of factoryBody) lines.push(fl.length > 0 ? `  ${fl}` : fl);
    if (rootRes.thisExpr !== null) {
      const callArgs = needInputParam ? `${rootRes.thisExpr}, ${callArg}` : rootRes.thisExpr;
      lines.push(`}).call(${callArgs});`);
    } else {
      lines.push(`})(${callArg});`);
    }

    const varDeclParts = [];
    const deferredSetters = [];
    for (let i = 0; i < outSlots.length; i++) {
      const slot = outSlots[i];
      if (slot.type === "node") {
        varDeclParts.push(`${ctx.varName(slot.nodeId)} = ${resVar}[${i}]`);
      } else if (slot.type === "setter") {
        deferredSetters.push({
          setterExpr: `${resVar}[${i}]`,
          valueRef: slot.valueRef,
        });
      }
    }
    if (varDeclParts.length > 0) {
      lines.push(`var ${varDeclParts.join(", ")};`);
    }

    return { lines, deferredSetters };
  }

  return {
    computeSubtreeMeta,
    emitTopLevelFunction,
    emitRootScope,
  };
}

function topoSortScopeItems(items) {
  if (items.length <= 1) return items;
  const producerOf = new Map();
  for (let i = 0; i < items.length; i++) {
    for (const id of items[i].produced) producerOf.set(id, i);
  }
  const visited = new Uint8Array(items.length);
  const out = [];
  function visit(i) {
    if (visited[i] === 2) return;
    if (visited[i] === 1) return;
    visited[i] = 1;
    for (const depId of items[i].deps) {
      const pIdx = producerOf.get(depId);
      if (pIdx !== undefined && pIdx !== i) visit(pIdx);
    }
    visited[i] = 2;
    out.push(items[i]);
  }
  for (let i = 0; i < items.length; i++) visit(i);
  return out;
}

function indentLines(lines) {
  return lines
    .map((l) =>
      l
        .split("\n")
        .map((sub) => (sub.length > 0 ? `  ${sub}` : sub))
        .join("\n")
    )
    .join("\n");
}

module.exports = {
  buildScopeTreeEmitter,
};
