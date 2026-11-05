"use strict";

const zlib = require("zlib");

const JS_RESERVED_WORDS = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function isValidIdentifier(name) {
  return typeof name === "string" && IDENT_RE.test(name) && !JS_RESERVED_WORDS.has(name);
}

function escapeScriptSafeJsonString(str) {
  return JSON.stringify(String(str))
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function formatGlobalAccess(name) {
  if (isValidIdentifier(name)) return name;
  return `globalThis[${escapeScriptSafeJsonString(name)}]`;
}

function formatTypeofGlobal(name) {
  if (isValidIdentifier(name)) return `typeof ${name}`;
  return `typeof globalThis[${escapeScriptSafeJsonString(name)}]`;
}

function formatPropertyAccess(baseExpr, prop) {
  if (typeof prop === "symbol") {
    const regKey = Symbol.keyFor(prop);
    if (regKey !== undefined) {
      return `${baseExpr}[Symbol.for(${escapeScriptSafeJsonString(regKey)})]`;
    }
    const desc = prop.description || "";
    if (desc.startsWith("Symbol.") && isValidIdentifier(desc.slice(7))) {
      return `${baseExpr}[${desc}]`;
    }
    throw new Error(`Cannot emit guard expression for unregistered unique symbol ${String(prop)}`);
  }
  const key = String(prop);
  if (isValidIdentifier(key)) return `${baseExpr}.${key}`;
  return `${baseExpr}[${escapeScriptSafeJsonString(key)}]`;
}

function isRelationalExpression(expr) {
  return (
    expr.includes(" === ") ||
    expr.includes(" !== ") ||
    expr.includes(" == ") ||
    expr.includes(" != ") ||
    /^".*" in [A-Za-z0-9_$.[\]"]+$/.test(expr)
  );
}

function compileValueComparison(expr, observed) {
  if (observed && typeof observed === "object") {
    if (observed.special === "NaN") return `Number.isNaN(${expr})`;
    if (observed.special === "-0") return `Object.is(${expr}, -0)`;
    if (observed.special === "Infinity") return `${expr} === 1 / 0`;
    if (observed.special === "-Infinity") return `${expr} === -1 / 0`;
    if (observed.prim === "undefined") return `${expr} === void 0`;
    if (observed.prim === "null") return `${expr} === null`;
    if (observed.prim === "bigint") return `${expr} === ${String(observed.value)}n`;
  }

  if (observed === undefined) return `${expr} === void 0`;
  if (observed === null) return `${expr} === null`;

  if (typeof observed === "boolean") {
    if (observed === true && isRelationalExpression(expr)) return expr;
    if (observed === false && /^".*" in [A-Za-z0-9_$.[\]"]+$/.test(expr)) return `!(${expr})`;
    return `${expr} === ${observed ? "true" : "false"}`;
  }

  if (typeof observed === "number") {
    if (Number.isNaN(observed)) return `Number.isNaN(${expr})`;
    if (Object.is(observed, -0)) return `Object.is(${expr}, -0)`;
    if (observed === Infinity) return `${expr} === 1 / 0`;
    if (observed === -Infinity) return `${expr} === -1 / 0`;
    return `${expr} === ${observed < 0 ? `(${observed})` : String(observed)}`;
  }

  if (typeof observed === "bigint") {
    return `${expr} === ${observed.toString()}n`;
  }

  if (typeof observed === "string") {
    return `${expr} === ${escapeScriptSafeJsonString(observed)}`;
  }

  if (typeof observed === "symbol") {
    const key = Symbol.keyFor(observed);
    if (key !== undefined) {
      return `${expr} === Symbol.for(${escapeScriptSafeJsonString(key)})`;
    }
    throw new Error(`Cannot emit runtime guard for non-registered symbol value ${String(observed)}`);
  }

  throw new Error(`Unsupported observed value in assumption for "${expr}": ${typeof observed}`);
}

function compileAssumptionClause(assumption) {
  if (!assumption || typeof assumption !== "object") {
    throw new TypeError("Invalid assumption entry: expected object");
  }
  const kind = assumption.kind;
  const expr = assumption.expr;
  const observed = assumption.observed;

  if (typeof expr !== "string" || expr.length === 0) {
    throw new Error(`Assumption of kind "${kind}" is missing a non-empty expr`);
  }

  if (kind === "typeof") {
    return `${expr} === ${escapeScriptSafeJsonString(String(observed))}`;
  }

  if (kind === "tz") {
    if (expr.includes("===") || expr.includes("&&")) {
      return expr;
    }
    if (typeof observed === "number") {
      return `${expr} === ${observed < 0 ? `(${observed})` : String(observed)}`;
    }
    const zone = String(observed || "UTC");
    if (zone === "UTC" || zone === "Etc/UTC" || zone === "GMT") {
      return "new Date(0).getTimezoneOffset() === 0";
    }
    return (
      'typeof Intl === "object" && Intl !== null && typeof Intl.DateTimeFormat === "function" && ' +
      `Intl.DateTimeFormat().resolvedOptions().timeZone === ${escapeScriptSafeJsonString(zone)}`
    );
  }

  if (kind === "json") {
    const jsonText = typeof observed === "string" ? observed : JSON.stringify(observed);
    const lhs = expr.startsWith("JSON.stringify(") ? expr : `JSON.stringify(${expr})`;
    return `${lhs} === ${escapeScriptSafeJsonString(jsonText)}`;
  }

  if (kind === "value") {
    return compileValueComparison(expr, observed);
  }

  throw new Error(`Unknown assumption kind "${kind}" for expr "${expr}"`);
}

function compileGuardCondition(recordedAssumptions) {
  const list = Array.isArray(recordedAssumptions)
    ? recordedAssumptions
    : recordedAssumptions && Array.isArray(recordedAssumptions.assumptions)
    ? recordedAssumptions.assumptions
    : [];

  if (list.length === 0) return null;

  const seen = new Set();
  const clauses = [];
  for (let i = 0; i < list.length; i++) {
    const clause = compileAssumptionClause(list[i]);
    if (!seen.has(clause)) {
      seen.add(clause);
      clauses.push(clause);
    }
  }
  return clauses.length > 0 ? clauses.join(" && ") : null;
}

function buildFallbackStatement(condition, originalSource, opts) {
  const strategy = (opts && opts.fallback) || "eval";

  if (strategy === "eval") {
    if (typeof originalSource !== "string") {
      throw new Error('emitGuard with fallback="eval" requires originalSource as a string');
    }
    return `(0, eval)(${escapeScriptSafeJsonString(originalSource)});`;
  }

  if (strategy === "function") {
    if (typeof originalSource !== "string") {
      throw new Error('emitGuard with fallback="function" requires originalSource as a string');
    }
    return `(function () {\n${originalSource}\n}).call(this);`;
  }

  if (strategy === "throw") {
    const prefix =
      opts && typeof opts.errorMessage === "string" ? opts.errorMessage : "Prepack environment assumption failed";
    const summary = condition.length > 80 ? `${condition.slice(0, 77)}...` : condition;
    const msg = `${prefix} (${summary})`;
    return `throw new Error(${escapeScriptSafeJsonString(msg)});`;
  }

  if (strategy === "external") {
    const extPath = opts && opts.externalPath;
    if (typeof extPath !== "string" || extPath.length === 0) {
      throw new Error('emitGuard with fallback="external" requires opts.externalPath');
    }
    const format = (opts && opts.externalFormat) || "auto";
    const quoted = escapeScriptSafeJsonString(extPath);
    if (format === "esm-dynamic") {
      return `import(${quoted});`;
    }
    if (format === "cjs") {
      return `if (typeof module === "object" && module !== null) { module.exports = require(${quoted}); } else { require(${quoted}); }`;
    }
    return (
      `if (typeof require === "function") { ` +
      `if (typeof module === "object" && module !== null) { module.exports = require(${quoted}); } else { require(${quoted}); } ` +
      `} else { throw new Error(${escapeScriptSafeJsonString(
        `Prepack fallback requires bundler require(${extPath})`
      )}); }`
    );
  }

  throw new Error(`Unknown guard fallback strategy "${strategy}". Expected "eval", "function", "throw", or "external"`);
}

function emitGuard(recordedAssumptions, originalSource, opts) {
  const options = opts || {};
  const condition = compileGuardCondition(recordedAssumptions);

  if (condition === null && !options.alwaysGuard) {
    return {
      prelude: "",
      condition: null,
      fallbackCode: "",
      wrap(code) {
        return String(code);
      },
    };
  }

  const effectiveCondition = condition === null ? "true" : condition;
  const fallbackCode = buildFallbackStatement(effectiveCondition, originalSource, options);
  const minify = Boolean(options.minify);

  const prelude = minify
    ? `if(!(${effectiveCondition})){${fallbackCode}}`
    : `if (!(${effectiveCondition})) {\n  ${fallbackCode}\n}`;

  function wrap(code) {
    const body = String(code);
    if (minify) {
      return `if(!(${effectiveCondition})){${fallbackCode}}else{${body}}`;
    }
    return `if (!(${effectiveCondition})) {\n  ${fallbackCode}\n} else {\n${body}\n}`;
  }

  return {
    prelude,
    condition: effectiveCondition,
    fallbackCode,
    wrap,
  };
}

function byteSize(str) {
  const buf = Buffer.from(str, "utf8");
  return {
    raw: buf.length,
    gzip: zlib.gzipSync(buf, { level: 9 }).length,
  };
}

function measureGuardOverhead(recordedAssumptions, originalSource, rebuiltCode, opts) {
  const base = byteSize(rebuiltCode);
  const orig = typeof originalSource === "string" ? byteSize(originalSource) : null;
  const strategies = ["eval", "function", "throw", "external"];
  const results = {};

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    if ((strategy === "eval" || strategy === "function") && typeof originalSource !== "string") {
      continue;
    }
    const strategyOpts = Object.assign({}, opts || null, {
      fallback: strategy,
      externalPath: (opts && opts.externalPath) || "./original.js",
    });
    const emitted = emitGuard(recordedAssumptions, originalSource, strategyOpts);
    const wrapped = emitted.wrap(rebuiltCode);
    const size = byteSize(wrapped);
    results[strategy] = {
      rawBytes: size.raw,
      gzipBytes: size.gzip,
      rawDeltaBytes: size.raw - base.raw,
      gzipDeltaBytes: size.gzip - base.gzip,
      rawRatioVsRebuilt: base.raw > 0 ? Number((size.raw / base.raw).toFixed(4)) : null,
      gzipRatioVsRebuilt: base.gzip > 0 ? Number((size.gzip / base.gzip).toFixed(4)) : null,
    };
  }

  return {
    rebuilt: base,
    original: orig,
    conditionLength: (compileGuardCondition(recordedAssumptions) || "").length,
    strategies: results,
  };
}

module.exports = {
  JS_RESERVED_WORDS,
  isValidIdentifier,
  escapeScriptSafeJsonString,
  formatGlobalAccess,
  formatTypeofGlobal,
  formatPropertyAccess,
  compileAssumptionClause,
  compileGuardCondition,
  emitGuard,
  measureGuardOverhead,
};
