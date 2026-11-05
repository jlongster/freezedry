"use strict";

const CONTEXT_MAP_EDGE_TO_KIND = new Map([
  ["function_context_map", "function"],
  ["block_context_map", "block"],
  ["catch_context_map", "catch"],
  ["script_context_map", "script"],
  ["with_context_map", "with"],
  ["eval_context_map", "eval"],
  ["module_context_map", "module"],
  ["await_context_map", "await"],
]);

function parseHeapSnapshot(rawJson) {
  const snap = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
  const meta = snap.snapshot.meta;
  const nodeFields = meta.node_fields;
  const nodeTypes = meta.node_types[0];
  const edgeFields = meta.edge_fields;
  const edgeTypes = meta.edge_types[0];
  const strings = snap.strings;
  const nodes = snap.nodes;
  const edges = snap.edges;

  const nodeStride = nodeFields.length;
  const edgeStride = edgeFields.length;
  const nodeCount = nodes.length / nodeStride;

  const nTypeIdx = nodeFields.indexOf("type");
  const nNameIdx = nodeFields.indexOf("name");
  const nIdIdx = nodeFields.indexOf("id");
  const nEdgeCountIdx = nodeFields.indexOf("edge_count");

  const eTypeIdx = edgeFields.indexOf("type");
  const eNameIdx = edgeFields.indexOf("name_or_index");
  const eToIdx = edgeFields.indexOf("to_node");

  const internalEdgeTypeCode = edgeTypes.indexOf("internal");
  const contextEdgeTypeCode = edgeTypes.indexOf("context");
  const hiddenEdgeTypeCode = edgeTypes.indexOf("hidden");
  const stringNodeTypeCode = nodeTypes.indexOf("string");
  const numberNodeTypeCode = nodeTypes.indexOf("number");
  const hiddenNodeTypeCode = nodeTypes.indexOf("hidden");

  const edgeStarts = new Uint32Array(nodeCount);
  const idToNodeIndex = new Map();

  let curEdgeOffset = 0;
  for (let i = 0; i < nodeCount; i++) {
    const off = i * nodeStride;
    idToNodeIndex.set(String(nodes[off + nIdIdx]), i);
    edgeStarts[i] = curEdgeOffset;
    curEdgeOffset += nodes[off + nEdgeCountIdx] * edgeStride;
  }

  const nativeContextMapCache = new Map();
  const contextInfoCache = new Map();

  function getNativeContextMaps(nativeNodeIdx) {
    let map = nativeContextMapCache.get(nativeNodeIdx);
    if (map) return map;
    map = new Map();
    const off = nativeNodeIdx * nodeStride;
    const eCount = nodes[off + nEdgeCountIdx];
    const eStart = edgeStarts[nativeNodeIdx];
    for (let i = 0; i < eCount; i++) {
      const eo = eStart + i * edgeStride;
      if (edges[eo + eTypeIdx] === internalEdgeTypeCode) {
        const edgeName = strings[edges[eo + eNameIdx]];
        const kind = CONTEXT_MAP_EDGE_TO_KIND.get(edgeName);
        if (kind) {
          map.set(edges[eo + eToIdx], kind);
        }
      }
    }
    nativeContextMapCache.set(nativeNodeIdx, map);
    return map;
  }

  function extractScopeInfoNames(scopeInfoOff) {
    const names = new Set();
    if (scopeInfoOff === undefined) return names;
    const nodeIdx = scopeInfoOff / nodeStride;
    const eCount = nodes[scopeInfoOff + nEdgeCountIdx];
    const eStart = edgeStarts[nodeIdx];
    for (let i = 0; i < eCount; i++) {
      const eo = eStart + i * edgeStride;
      const toOff = edges[eo + eToIdx];
      if (nodes[toOff + nTypeIdx] === stringNodeTypeCode) {
        names.add(strings[nodes[toOff + nNameIdx]]);
      }
    }
    return names;
  }

  function buildContextInfo(ctxOff) {
    const ctxId = String(nodes[ctxOff + nIdIdx]);
    const cached = contextInfoCache.get(ctxId);
    if (cached) return cached;

    const ctxName = strings[nodes[ctxOff + nNameIdx]];
    if (ctxName.startsWith("system / NativeContext")) {
      return null;
    }

    const nodeIdx = ctxOff / nodeStride;
    const eCount = nodes[ctxOff + nEdgeCountIdx];
    const eStart = edgeStarts[nodeIdx];

    let prevOff = undefined;
    let mapOff = undefined;
    let scopeInfoOff = undefined;
    const varEdges = new Map();
    const hiddenEdges = new Map();

    for (let i = 0; i < eCount; i++) {
      const eo = eStart + i * edgeStride;
      const etCode = edges[eo + eTypeIdx];
      if (etCode === contextEdgeTypeCode) {
        const varName = strings[edges[eo + eNameIdx]];
        const toOff = edges[eo + eToIdx];
        varEdges.set(varName, {
          toId: String(nodes[toOff + nIdIdx]),
          toType: nodeTypes[nodes[toOff + nTypeIdx]],
          toName: strings[nodes[toOff + nNameIdx]],
        });
      } else if (etCode === hiddenEdgeTypeCode) {
        const idxStr = String(edges[eo + eNameIdx]);
        const toOff = edges[eo + eToIdx];
        hiddenEdges.set(idxStr, String(nodes[toOff + nIdIdx]));
      } else if (etCode === internalEdgeTypeCode) {
        const en = strings[edges[eo + eNameIdx]];
        if (en === "previous") prevOff = edges[eo + eToIdx];
        else if (en === "map") mapOff = edges[eo + eToIdx];
        else if (en === "scope_info") scopeInfoOff = edges[eo + eToIdx];
      }
    }

    // Recursively resolve parent chain up to NativeContext so we know the NativeContext map table
    let parent = null;
    let nativeNodeIdx = null;
    if (prevOff !== undefined) {
      const prevName = strings[nodes[prevOff + nNameIdx]];
      if (prevName.startsWith("system / NativeContext")) {
        nativeNodeIdx = prevOff / nodeStride;
      } else {
        parent = buildContextInfo(prevOff);
        nativeNodeIdx = parent ? parent.nativeNodeIdx : null;
      }
    }

    let ctxKind = "unknown";
    if (nativeNodeIdx !== null && mapOff !== undefined) {
      const mapKinds = getNativeContextMaps(nativeNodeIdx);
      ctxKind = mapKinds.get(mapOff) || "unknown";
    }

    const scopeInfoNames = extractScopeInfoNames(scopeInfoOff);
    for (const k of varEdges.keys()) {
      scopeInfoNames.add(k);
    }

    const info = {
      contextId: ctxId,
      ctxKind,
      varEdges,
      hiddenEdges,
      scopeInfoNames,
      parent,
      nativeNodeIdx,
    };
    contextInfoCache.set(ctxId, info);
    return info;
  }

  function getContextChain(fnHeapObjectId) {
    const fnIdx = idToNodeIndex.get(String(fnHeapObjectId));
    if (fnIdx === undefined) return null;
    const fnOff = fnIdx * nodeStride;
    const eCount = nodes[fnOff + nEdgeCountIdx];
    const eStart = edgeStarts[fnIdx];

    let ctxOff = undefined;
    for (let i = 0; i < eCount; i++) {
      const eo = eStart + i * edgeStride;
      if (edges[eo + eTypeIdx] === internalEdgeTypeCode && strings[edges[eo + eNameIdx]] === "context") {
        ctxOff = edges[eo + eToIdx];
        break;
      }
    }
    if (ctxOff === undefined) return [];

    const chain = [];
    let cur = buildContextInfo(ctxOff);
    while (cur) {
      chain.push(cur);
      cur = cur.parent;
    }
    return chain;
  }

  function readPrimitiveFromEdge(edgeInfo) {
    if (!edgeInfo) return { ok: false };
    const { toId, toType, toName } = edgeInfo;
    if (toType === "hidden") {
      if (toName === "undefined") return { ok: true, value: undefined };
      if (toName === "null") return { ok: true, value: null };
      if (toName === "true") return { ok: true, value: true };
      if (toName === "false") return { ok: true, value: false };
      return { ok: false };
    }
    if (toType === "string") {
      return { ok: true, value: toName };
    }
    if (toType === "number") {
      const nIdx = idToNodeIndex.get(String(toId));
      if (nIdx === undefined) return { ok: false };
      const off = nIdx * nodeStride;
      const eCount = nodes[off + nEdgeCountIdx];
      const eStart = edgeStarts[nIdx];
      for (let i = 0; i < eCount; i++) {
        const eo = eStart + i * edgeStride;
        if (edges[eo + eTypeIdx] === internalEdgeTypeCode && strings[edges[eo + eNameIdx]] === "value") {
          const valOff = edges[eo + eToIdx];
          const valStr = strings[nodes[valOff + nNameIdx]];
          if (valStr === "NaN") return { ok: true, value: NaN };
          if (valStr === "Infinity") return { ok: true, value: Infinity };
          if (valStr === "-Infinity") return { ok: true, value: -Infinity };
          const num = Number(valStr);
          if (num === 0 && toName === "heap number") {
            return { ok: true, value: -0 };
          }
          if (!Number.isNaN(num)) {
            return { ok: true, value: num };
          }
        }
      }
      return { ok: false };
    }
    return { ok: false };
  }

  return {
    getContextChain,
    readPrimitiveFromEdge,
  };
}

module.exports = {
  parseHeapSnapshot,
};
