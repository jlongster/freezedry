"use strict";

const inspector = require("inspector");
const { parseHeapSnapshot } = require("./heap-snapshot");

let bridgeSeq = 0;

async function openInspectorBridge(targetGlobalObj) {
  const session = new inspector.Session();
  session.connect();

  const post = (method, params = {}) =>
    new Promise((resolve, reject) => {
      session.post(method, params, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    });

  const contextIds = [];
  const onCtxCreated = (ev) => {
    if (ev && ev.params && ev.params.context) {
      contextIds.push(ev.params.context.id);
    }
  };
  session.on("Runtime.executionContextCreated", onCtxCreated);
  await post("Runtime.enable");
  session.removeListener("Runtime.executionContextCreated", onCtxCreated);

  await post("Debugger.enable");
  await post("HeapProfiler.enable");

  let stashIn = undefined;
  let stashOut = undefined;
  const tmpKey = `__freezedry_bridge_${process.pid}_${++bridgeSeq}__`;
  const bridgeObj = {
    pull: function () {
      return stashIn;
    },
    push: function (v) {
      stashOut = v;
    },
  };

  // Install bridge in host global AND in targetGlobalObj (the vm realm) so both worlds work cleanly.
  Object.defineProperty(globalThis, tmpKey, {
    value: bridgeObj,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  const hadVmProp =
    targetGlobalObj && targetGlobalObj !== globalThis
      ? Object.getOwnPropertyDescriptor(targetGlobalObj, tmpKey)
      : null;
  if (targetGlobalObj && targetGlobalObj !== globalThis) {
    Object.defineProperty(targetGlobalObj, tmpKey, {
      value: bridgeObj,
      configurable: true,
      enumerable: false,
      writable: true,
    });
  }

  let hostPullFnId = null;
  let hostPushFnId = null;
  let vmPullFnId = null;
  let vmPushFnId = null;

  try {
    hostPullFnId = (await post("Runtime.evaluate", { expression: `${tmpKey}.pull` })).result.objectId;
    hostPushFnId = (await post("Runtime.evaluate", { expression: `${tmpKey}.push` })).result.objectId;

    if (targetGlobalObj && targetGlobalObj !== globalThis) {
      for (const cid of contextIds) {
        try {
          const check = await post("Runtime.evaluate", {
            expression: `typeof ${tmpKey} === "object" && this !== undefined`,
            contextId: cid,
            returnByValue: true,
          });
          if (check && check.result && check.result.value === true) {
            const p1 = await post("Runtime.evaluate", {
              expression: `${tmpKey}.pull`,
              contextId: cid,
            });
            const p2 = await post("Runtime.evaluate", {
              expression: `${tmpKey}.push`,
              contextId: cid,
            });
            if (p1.result.objectId && p1.result.objectId !== hostPullFnId) {
              vmPullFnId = p1.result.objectId;
              vmPushFnId = p2.result.objectId;
              break;
            }
          }
        } catch {
          // ignore non-matching context
        }
      }
    }
  } finally {
    delete globalThis[tmpKey];
    if (targetGlobalObj && targetGlobalObj !== globalThis) {
      if (hadVmProp) Object.defineProperty(targetGlobalObj, tmpKey, hadVmProp);
      else delete targetGlobalObj[tmpKey];
    }
  }

  const primaryPullFnId = vmPullFnId || hostPullFnId;
  const primaryPushFnId = vmPushFnId || hostPushFnId;
  const fallbackPushFnId = vmPushFnId ? hostPushFnId : null;

  const valToRemoteCache = new Map();
  const scriptSourceCache = new Map();
  let heapSnapshotIndex = null;

  async function toRemoteObject(jsVal) {
    const cached = valToRemoteCache.get(jsVal);
    if (cached) return cached;
    stashIn = jsVal;
    try {
      const res = await post("Runtime.callFunctionOn", {
        objectId: primaryPullFnId,
        functionDeclaration: "function() { return this(); }",
        returnByValue: false,
      });
      if ((typeof jsVal === "object" && jsVal !== null) || typeof jsVal === "function" || typeof jsVal === "symbol") {
        valToRemoteCache.set(jsVal, res.result);
      }
      return res.result;
    } finally {
      stashIn = undefined;
    }
  }

  // Returns `{ value }` box so JS `async`/`await` NEVER assimilates Promises or invokes `.then` on user thenables!
  async function fromRemoteObjectBoxed(rem) {
    if (!rem) return { value: undefined };
    switch (rem.type) {
      case "undefined":
        return { value: undefined };
      case "boolean":
      case "string":
        return { value: rem.value };
      case "number": {
        if (rem.unserializableValue === "NaN") return { value: NaN };
        if (rem.unserializableValue === "-0") return { value: -0 };
        if (rem.unserializableValue === "Infinity") return { value: Infinity };
        if (rem.unserializableValue === "-Infinity") return { value: -Infinity };
        return { value: rem.value };
      }
      case "bigint": {
        const raw = String(rem.unserializableValue || rem.description || "0").replace(/n$/, "");
        return { value: BigInt(raw) };
      }
      default: {
        if (rem.type === "object" && rem.subtype === "null") return { value: null };
        if (!rem.objectId) return { value: rem.value };
        stashOut = undefined;
        try {
          try {
            await post("Runtime.callFunctionOn", {
              objectId: primaryPushFnId,
              functionDeclaration: "function(v) { this(v); }",
              arguments: [{ objectId: rem.objectId }],
            });
          } catch (err) {
            if (fallbackPushFnId) {
              await post("Runtime.callFunctionOn", {
                objectId: fallbackPushFnId,
                functionDeclaration: "function(v) { this(v); }",
                arguments: [{ objectId: rem.objectId }],
              });
            } else {
              throw err;
            }
          }
          return { value: stashOut };
        } finally {
          stashOut = undefined;
        }
      }
    }
  }

  async function inspectObject(jsVal) {
    const rem = await toRemoteObject(jsVal);
    const props = await post("Runtime.getProperties", {
      objectId: rem.objectId,
      ownProperties: true,
    });
    return {
      remote: rem,
      ownProperties: props.result || [],
      internalProperties: props.internalProperties || [],
      privateProperties: props.privateProperties || [],
    };
  }

  async function readBoundArgs(boundArgsObjectId) {
    const props = await post("Runtime.getProperties", {
      objectId: boundArgsObjectId,
      ownProperties: true,
    });
    const indexed = [];
    for (const p of props.result || []) {
      if (/^\d+$/.test(p.name) && p.value) {
        const box = await fromRemoteObjectBoxed(p.value);
        indexed.push([Number(p.name), box.value]);
      }
    }
    indexed.sort((a, b) => a[0] - b[0]);
    return indexed.map(([, v]) => v);
  }

  async function readCollectionEntryCount(entriesObjectId) {
    const props = await post("Runtime.getProperties", {
      objectId: entriesObjectId,
      ownProperties: true,
    });
    let count = 0;
    for (const p of props.result || []) {
      if (p.name !== "length") count++;
    }
    return count;
  }

  async function listScopes(scopesObjectId) {
    const listProps = await post("Runtime.getProperties", {
      objectId: scopesObjectId,
      ownProperties: true,
    });
    const entries = [];
    for (const item of listProps.result || []) {
      if (!/^\d+$/.test(item.name) || !item.value || !item.value.objectId) continue;
      const desc = item.value.description || "";
      if (desc === "Global") continue;
      entries.push({
        index: Number(item.name),
        description: desc,
        scopeKind: classifyInspectorScopeDescription(desc),
        objectId: item.value.objectId,
        rawDescriptors: null,
      });
    }
    return entries;
  }

  async function ensureScopeDescriptors(scopeEntry) {
    if (!scopeEntry.rawDescriptors) {
      const scopeVarsProps = await post("Runtime.getProperties", {
        objectId: scopeEntry.objectId,
        ownProperties: true,
      });
      scopeEntry.rawDescriptors = scopeVarsProps.result || [];
    }
    return scopeEntry.rawDescriptors;
  }

  async function materializeScopeVars(scopeEntry) {
    const raw = await ensureScopeDescriptors(scopeEntry);
    const vars = [];
    for (const vp of raw) {
      if (!vp.value) {
        vars.push({ name: vp.name, initialized: false, value: undefined });
      } else {
        const box = await fromRemoteObjectBoxed(vp.value);
        vars.push({
          name: vp.name,
          initialized: true,
          value: box.value,
        });
      }
    }
    return vars;
  }

  async function getScriptSource(scriptId) {
    const key = String(scriptId);
    if (scriptSourceCache.has(key)) return scriptSourceCache.get(key);
    try {
      const res = await post("Debugger.getScriptSource", { scriptId: key });
      scriptSourceCache.set(key, res.scriptSource);
      return res.scriptSource;
    } catch {
      scriptSourceCache.set(key, null);
      return null;
    }
  }

  async function ensureHeapSnapshot() {
    if (heapSnapshotIndex) return heapSnapshotIndex;
    const chunks = [];
    const onChunk = (ev) => {
      chunks.push(ev.params.chunk);
    };
    session.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
    try {
      await post("HeapProfiler.takeHeapSnapshot", {
        reportProgress: false,
        captureNumericValue: true,
      });
    } finally {
      session.removeListener("HeapProfiler.addHeapSnapshotChunk", onChunk);
    }
    heapSnapshotIndex = parseHeapSnapshot(chunks.join(""));
    return heapSnapshotIndex;
  }

  async function getHeapObjectId(jsVal) {
    await ensureHeapSnapshot();
    const rem = await toRemoteObject(jsVal);
    const res = await post("HeapProfiler.getHeapObjectId", {
      objectId: rem.objectId,
    });
    return String(res.heapSnapshotObjectId);
  }

  async function getObjectByHeapObjectIdBoxed(heapId) {
    const res = await post("HeapProfiler.getObjectByHeapObjectId", {
      objectId: String(heapId),
    });
    return fromRemoteObjectBoxed(res.result);
  }

  function close() {
    try {
      session.disconnect();
    } catch {
      // ignore
    }
  }

  return {
    toRemoteObject,
    fromRemoteObjectBoxed,
    inspectObject,
    readBoundArgs,
    readCollectionEntryCount,
    listScopes,
    ensureScopeDescriptors,
    materializeScopeVars,
    getScriptSource,
    ensureHeapSnapshot,
    getHeapObjectId,
    getObjectByHeapObjectIdBoxed,
    close,
  };
}

function classifyInspectorScopeDescription(desc) {
  if (desc.startsWith("Closure")) return "function";
  if (desc.startsWith("Block")) return "block";
  if (desc.startsWith("Catch")) return "catch";
  if (desc.startsWith("Script")) return "script";
  if (desc.startsWith("With")) return "with";
  if (desc.startsWith("Eval")) return "eval";
  if (desc.startsWith("Module")) return "module";
  return "unknown";
}

module.exports = {
  openInspectorBridge,
};
