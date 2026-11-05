"use strict";

const acorn = require("acorn");
const {
  BUILTIN_PROTO_UNSAFE_KEYS,
  formatMemberAccess,
  formatObjectLiteralKey,
  isArrayIndexKey,
  isIdentifierName,
  quoteString,
  resolveIntrinsicExpr,
} = require("./intrinsics");

const STANDARD_ERROR_CTORS = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "SuppressedError",
]);

const TYPED_ARRAY_BYTES_PER_ELEMENT = new Map([
  ["Int8Array", 1],
  ["Uint8Array", 1],
  ["Uint8ClampedArray", 1],
  ["Int16Array", 2],
  ["Uint16Array", 2],
  ["Float16Array", 2],
  ["Int32Array", 4],
  ["Uint32Array", 4],
  ["Float32Array", 4],
  ["Float64Array", 8],
  ["BigInt64Array", 8],
  ["BigUint64Array", 8],
]);

function canUseRegexLiteral(source, flags) {
  if (typeof source !== "string" || typeof flags !== "string") return false;
  const pat = source.length === 0 ? "(?:)" : source;
  if (/[\n\r\u2028\u2029]/.test(pat)) return false;
  const candidate = `/${pat}/${flags}`;
  try {
    const ast = acorn.parse(candidate, { ecmaVersion: "latest" });
    if (
      ast.body.length === 1 &&
      ast.body[0].type === "ExpressionStatement" &&
      ast.body[0].expression.type === "Literal" &&
      ast.body[0].expression.regex &&
      ast.body[0].expression.regex.pattern === pat &&
      ast.body[0].expression.regex.flags === flags
    ) {
      return candidate;
    }
  } catch (_e) {
    return null;
  }
  return null;
}

function formatRegExpBase(node) {
  const src = typeof node.source === "string" ? node.source : "";
  const flags = typeof node.flags === "string" ? node.flags : "";
  const lit = canUseRegexLiteral(src, flags);
  if (lit) return lit;
  return flags
    ? `new RegExp(${quoteString(src)}, ${quoteString(flags)})`
    : `new RegExp(${quoteString(src)})`;
}

function decodeBase64Bytes(b64) {
  if (typeof b64 !== "string" || b64.length === 0) return Buffer.alloc(0);
  return Buffer.from(b64, "base64");
}

function isAllZeroBytes(buf) {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

function formatArrayBufferExpr(bufBytes, byteLength, isShared, ensureB64Helper) {
  const Ctor = isShared ? "SharedArrayBuffer" : "ArrayBuffer";
  const len = typeof byteLength === "number" ? byteLength : bufBytes ? bufBytes.length : 0;
  if (!bufBytes || bufBytes.length === 0 || isAllZeroBytes(bufBytes)) {
    return `new ${Ctor}(${len})`;
  }
  if (!isShared && len <= 32) {
    const nums = Array.from(bufBytes).join(",");
    return `new Uint8Array([${nums}]).buffer`;
  }
  const b64Helper = ensureB64Helper();
  const b64Str = bufBytes.toString("base64");
  if (isShared) {
    return `(function(){var s=new SharedArrayBuffer(${len});new Uint8Array(s).set(new Uint8Array(${b64Helper}(${quoteString(b64Str)})));return s})()`;
  }
  return `${b64Helper}(${quoteString(b64Str)})`;
}

function formatUnsharedTypedArrayExpr(node, ensureB64Helper) {
  const ctor = node.ctor || "Uint8Array";
  const bpe = TYPED_ARRAY_BYTES_PER_ELEMENT.get(ctor) || 1;
  const length = typeof node.length === "number" ? node.length : 0;
  const byteOffset = typeof node.byteOffset === "number" ? node.byteOffset : 0;
  const rawBytes = typeof node.bytes === "string" ? decodeBase64Bytes(node.bytes) : null;

  if (byteOffset === 0 && (!rawBytes || isAllZeroBytes(rawBytes))) {
    const expectedByteLen = length * bpe;
    if (!rawBytes || rawBytes.length === expectedByteLen) {
      return `new ${ctor}(${length})`;
    }
  }

  if (rawBytes) {
    if (byteOffset === 0 && rawBytes.length === length * bpe && ctor === "Uint8Array" && length <= 32) {
      return `new Uint8Array([${Array.from(rawBytes).join(",")}])`;
    }
    const bufExpr = formatArrayBufferExpr(rawBytes, rawBytes.length, false, ensureB64Helper);
    if (byteOffset === 0 && rawBytes.length === length * bpe) {
      return `new ${ctor}(${bufExpr})`;
    }
    return `new ${ctor}(${bufExpr}, ${byteOffset}, ${length})`;
  }

  return `new ${ctor}(${length})`;
}

/**
 * Determine whether a data property can be emitted as a normal `{ k: v }` / `o.k = v`
 * data property (`writable: true, enumerable: true, configurable: true`), accounting
 * for final `Object.freeze(o)` or `Object.seal(o)` which updates `writable`/`configurable`.
 */
function canEmitAsPlainDataProp(prop, ownerNode) {
  if (prop.isAccessor) return false;
  if (prop.enumerable !== true) return false;
  if (ownerNode.frozen) {
    return prop.writable === false && prop.configurable === false;
  }
  if (ownerNode.sealed) {
    return prop.writable === true && prop.configurable === false;
  }
  return prop.writable === true && prop.configurable === true;
}

function formatPropertyDescriptor(prop, exprForRef) {
  const parts = [];
  if (prop.isAccessor) {
    parts.push(`get: ${prop.get ? exprForRef(prop.get) : "void 0"}`);
    parts.push(`set: ${prop.set ? exprForRef(prop.set) : "void 0"}`);
  } else {
    parts.push(`value: ${prop.value ? exprForRef(prop.value) : "void 0"}`);
    parts.push(`writable: ${prop.writable ? "true" : "false"}`);
  }
  parts.push(`enumerable: ${prop.enumerable ? "true" : "false"}`);
  parts.push(`configurable: ${prop.configurable ? "true" : "false"}`);
  return `{ ${parts.join(", ")} }`;
}

/**
 * Check if `obj.key = val` is guaranteed NOT to invoke a prototype setter or fail on
 * a non-writable / getter-only inherited property.
 */
function isSafeProtoChainForAssignment(ownerNode, keyNorm, ctx) {
  if (keyNorm.kind === "string") {
    const k = keyNorm.key;
    if (k === "__proto__") return false;
    if (BUILTIN_PROTO_UNSAFE_KEYS.has(k)) return false;
    if (ctx.patchedIntrinsicKeys.has(k)) return false;
  } else {
    if (ctx.hasPatchedIntrinsicSymbols) return false;
  }

  let curProto = ownerNode.protoRef;
  const seen = new Set();
  while (curProto) {
    if (curProto.kind === "prim" && curProto.prim === "null") return true;
    if (curProto.kind === "intrinsic") {
      // Standard built-in prototypes have no setters/readonly props outside BUILTIN_PROTO_UNSAFE_KEYS
      return true;
    }
    if (curProto.kind === "node") {
      if (seen.has(curProto.id)) return false;
      seen.add(curProto.id);
      const pNode = ctx.normNodes.get(curProto.id);
      if (!pNode) return false;
      for (const p of pNode.props) {
        if (sameKey(p.keyNorm, keyNorm)) {
          if (p.isAccessor || !p.writable) return false;
          return true;
        }
      }
      curProto = pNode.protoRef;
      continue;
    }
    return false;
  }
  return true;
}

function sameKey(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "string") return a.key === b.key;
  if (a.ref.kind !== b.ref.kind) return false;
  if (a.ref.kind === "node") return a.ref.id === b.ref.id;
  if (a.ref.kind === "intrinsic") return a.ref.path === b.ref.path;
  if (a.ref.kind === "prim") {
    return a.ref.registered != null && a.ref.registered === b.ref.registered;
  }
  return false;
}

function formatKeyForDefineProperty(keyNorm, exprForRef) {
  if (keyNorm.kind === "string") {
    if (isArrayIndexKey(keyNorm.key)) return keyNorm.key;
    return quoteString(keyNorm.key);
  }
  return exprForRef(keyNorm.ref);
}

function emitSetOrDefineProp(targetExpr, ownerNode, prop, alreadyOwnWritable, ctx, exprForRef) {
  const valExpr = !prop.isAccessor && prop.value ? exprForRef(prop.value) : "void 0";
  const canPlain = canEmitAsPlainDataProp(prop, ownerNode);

  if (canPlain) {
    if (prop.keyNorm.kind === "string") {
      const k = prop.keyNorm.key;
      if (
        k !== "__proto__" &&
        (alreadyOwnWritable || isSafeProtoChainForAssignment(ownerNode, prop.keyNorm, ctx))
      ) {
        return `${formatMemberAccess(targetExpr, k)} = ${valExpr};`;
      }
    } else if (alreadyOwnWritable || isSafeProtoChainForAssignment(ownerNode, prop.keyNorm, ctx)) {
      const symExpr = exprForRef(prop.keyNorm.ref);
      return `${targetExpr}[${symExpr}] = ${valExpr};`;
    }
  }

  const dp = ctx.definePropertyFn();
  const keyExpr = formatKeyForDefineProperty(prop.keyNorm, exprForRef);
  const descExpr = formatPropertyDescriptor(prop, exprForRef);
  return `${dp}(${targetExpr}, ${keyExpr}, ${descExpr});`;
}

function wrapExtensibilityInline(expr, node) {
  if (node.frozen) return `Object.freeze(${expr})`;
  if (node.sealed) return `Object.seal(${expr})`;
  if (node.extensible === false) return `Object.preventExtensions(${expr})`;
  return expr;
}

function formatBoxedExpr(primRef, exprForRef) {
  if (primRef.kind === "prim") {
    switch (primRef.prim) {
      case "number":
        return `new Number(${exprForRef(primRef)})`;
      case "string":
        return `new String(${exprForRef(primRef)})`;
      case "boolean":
        return `new Boolean(${exprForRef(primRef)})`;
      case "bigint":
      case "symbol":
        return `Object(${exprForRef(primRef)})`;
    }
  }
  return `Object(${exprForRef(primRef)})`;
}

module.exports = {
  STANDARD_ERROR_CTORS,
  TYPED_ARRAY_BYTES_PER_ELEMENT,
  canEmitAsPlainDataProp,
  decodeBase64Bytes,
  emitSetOrDefineProp,
  formatArrayBufferExpr,
  formatBoxedExpr,
  formatKeyForDefineProperty,
  formatPropertyDescriptor,
  formatRegExpBase,
  formatUnsharedTypedArrayExpr,
  isAllZeroBytes,
  isSafeProtoChainForAssignment,
  sameKey,
  wrapExtensibilityInline,
};
