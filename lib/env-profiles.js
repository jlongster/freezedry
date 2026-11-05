"use strict";

// Pure ECMAScript globals (ECMA-262 through ES2026).
// Note: `console` and `WebAssembly` are host/W3C globals injected by V8's vm.createContext,
// NOT ECMA-262 globals; they are handled per target profile rather than listed here.
const ES_GLOBALS = new Set([
  "AggregateError",
  "Array",
  "ArrayBuffer",
  "AsyncDisposableStack",
  "Atomics",
  "BigInt",
  "BigInt64Array",
  "BigUint64Array",
  "Boolean",
  "DataView",
  "Date",
  "DisposableStack",
  "Error",
  "EvalError",
  "FinalizationRegistry",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "Function",
  "Infinity",
  "Int16Array",
  "Int32Array",
  "Int8Array",
  "Intl",
  "Iterator",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "Promise",
  "Proxy",
  "RangeError",
  "ReferenceError",
  "Reflect",
  "RegExp",
  "Set",
  "SharedArrayBuffer",
  "String",
  "SuppressedError",
  "Symbol",
  "SyntaxError",
  "TypeError",
  "URIError",
  "Uint16Array",
  "Uint32Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "WeakMap",
  "WeakRef",
  "WeakSet",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "escape",
  "eval",
  "globalThis",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "undefined",
  "unescape",
]);

function obj(extra) {
  return Object.assign({ type: "object" }, extra || null);
}

function fn(extra) {
  return Object.assign({ type: "function" }, extra || null);
}

const CONSOLE_SPEC = obj({
  kind: "console",
  props: {
    log: fn({ volatile: "console" }),
    warn: fn({ volatile: "console" }),
    error: fn({ volatile: "console" }),
    info: fn({ volatile: "console" }),
    debug: fn({ volatile: "console" }),
    trace: fn({ volatile: "console" }),
    dir: fn({ volatile: "console" }),
    table: fn({ volatile: "console" }),
    assert: fn({ volatile: "console" }),
    clear: fn({ volatile: "console" }),
    count: fn({ volatile: "console" }),
    countReset: fn({ volatile: "console" }),
    group: fn({ volatile: "console" }),
    groupCollapsed: fn({ volatile: "console" }),
    groupEnd: fn({ volatile: "console" }),
    time: fn({ volatile: "console" }),
    timeEnd: fn({ volatile: "console" }),
    timeLog: fn({ volatile: "console" }),
  },
});

const PERFORMANCE_SPEC = obj({
  props: {
    now: fn({ volatile: "performance.now" }),
    mark: fn({ volatile: "performance" }),
    measure: fn({ volatile: "performance" }),
    clearMarks: fn({ volatile: "performance" }),
    clearMeasures: fn({ volatile: "performance" }),
    getEntries: fn({ volatile: "performance" }),
    getEntriesByName: fn({ volatile: "performance" }),
    getEntriesByType: fn({ volatile: "performance" }),
  },
});

const CRYPTO_SPEC = obj({
  props: {
    getRandomValues: fn({ volatile: "crypto.getRandomValues" }),
    randomUUID: fn({ volatile: "crypto.randomUUID" }),
    subtle: obj(),
  },
});

const WEBASSEMBLY_SPEC = obj({
  props: {
    Module: fn(),
    Instance: fn(),
    Memory: fn(),
    Table: fn(),
    Global: fn(),
    Tag: fn(),
    Exception: fn(),
    CompileError: fn(),
    LinkError: fn(),
    RuntimeError: fn(),
    compile: fn(),
    instantiate: fn(),
    validate: fn(),
  },
});

const COMMON_WINTERCG_GLOBALS = {
  console: CONSOLE_SPEC,
  performance: PERFORMANCE_SPEC,
  crypto: CRYPTO_SPEC,
  WebAssembly: WEBASSEMBLY_SPEC,
  fetch: fn(),
  Headers: fn(),
  Request: fn(),
  Response: fn(),
  FormData: fn(),
  Blob: fn(),
  File: fn(),
  URL: fn(),
  URLSearchParams: fn(),
  AbortController: fn(),
  AbortSignal: fn(),
  Event: fn(),
  CustomEvent: fn(),
  EventTarget: fn(),
  TextEncoder: fn(),
  TextDecoder: fn(),
  ReadableStream: fn(),
  WritableStream: fn(),
  TransformStream: fn(),
  ByteLengthQueuingStrategy: fn(),
  CountQueuingStrategy: fn(),
  CompressionStream: fn(),
  DecompressionStream: fn(),
  BroadcastChannel: fn(),
  MessageChannel: fn(),
  MessagePort: fn(),
  WebSocket: fn(),
  DOMException: fn(),
  structuredClone: fn(),
  atob: fn(),
  btoa: fn(),
  setTimeout: fn({ volatile: "timer" }),
  clearTimeout: fn({ volatile: "timer" }),
  setInterval: fn({ volatile: "timer" }),
  clearInterval: fn({ volatile: "timer" }),
  queueMicrotask: fn({ microtask: true }),
};

const NODE_PROCESS_SPEC = obj({
  toStringTag: "process",
  props: {
    env: obj({ openEnv: true }),
  },
});

const PROFILES = {
  ecmascript: {
    name: "ecmascript",
    description: "Pure ECMAScript (ES built-ins + globalThis only; no host globals)",
    aliases: [],
    globalToStringTag: undefined,
    globals: {},
  },

  browser: {
    name: "browser",
    description: "Browser <script> target (window/self === globalThis, DOM & Web APIs present, no CJS/AMD/Node)",
    aliases: ["window", "self"],
    globalToStringTag: "Window",
    globals: Object.assign({}, COMMON_WINTERCG_GLOBALS, {
      document: obj(),
      navigator: obj(),
      location: obj(),
      history: obj(),
      screen: obj(),
      localStorage: obj(),
      sessionStorage: obj(),
      indexedDB: obj(),
      caches: obj(),
      cookieStore: obj(),
      visualViewport: obj(),
      customElements: obj(),
      CSS: obj(),
      trustedTypes: obj(),
      frames: obj(),
      top: obj(),
      parent: obj(),
      opener: obj(),
      requestAnimationFrame: fn({ volatile: "timer" }),
      cancelAnimationFrame: fn({ volatile: "timer" }),
      requestIdleCallback: fn({ volatile: "timer" }),
      cancelIdleCallback: fn({ volatile: "timer" }),
      alert: fn({ volatile: "io" }),
      confirm: fn({ volatile: "io" }),
      prompt: fn({ volatile: "io" }),
      open: fn({ volatile: "io" }),
      close: fn({ volatile: "io" }),
      postMessage: fn({ volatile: "io" }),
      addEventListener: fn({ volatile: "io" }),
      removeEventListener: fn({ volatile: "io" }),
      dispatchEvent: fn({ volatile: "io" }),
      getComputedStyle: fn(),
      matchMedia: fn(),
      XMLHttpRequest: fn(),
      EventSource: fn(),
      Worker: fn(),
      SharedWorker: fn(),
      FileReader: fn(),
      DOMParser: fn(),
      XMLSerializer: fn(),
      MutationObserver: fn(),
      IntersectionObserver: fn(),
      ResizeObserver: fn(),
      PerformanceObserver: fn(),
      Node: fn(),
      Element: fn(),
      HTMLElement: fn(),
      SVGElement: fn(),
      Document: fn(),
      DocumentFragment: fn(),
      ShadowRoot: fn(),
      NodeList: fn(),
      HTMLCollection: fn(),
      Range: fn(),
      Selection: fn(),
    }),
  },

  worker: {
    name: "worker",
    description: "Web/Edge Worker target (self === globalThis, Worker/WinterCG APIs, no window/document/CJS)",
    aliases: ["self"],
    globalToStringTag: undefined,
    globals: Object.assign({}, COMMON_WINTERCG_GLOBALS, {
      navigator: obj(),
      location: obj(),
      caches: obj(),
      indexedDB: obj(),
      importScripts: fn({ volatile: "io" }),
      postMessage: fn({ volatile: "io" }),
      close: fn({ volatile: "io" }),
      addEventListener: fn({ volatile: "io" }),
      removeEventListener: fn({ volatile: "io" }),
      dispatchEvent: fn({ volatile: "io" }),
      EventSource: fn(),
      Worker: fn(),
      PerformanceObserver: fn(),
    }),
  },

  node: {
    name: "node",
    description: "Node.js target (global === globalThis, process/Buffer/CJS globals present, no window/document)",
    aliases: ["global"],
    globalToStringTag: "global",
    globals: Object.assign({}, COMMON_WINTERCG_GLOBALS, {
      process: NODE_PROCESS_SPEC,
      Buffer: fn(),
      module: obj(),
      exports: obj(),
      require: fn(),
      __filename: { type: "string", primitiveUnknown: true },
      __dirname: { type: "string", primitiveUnknown: true },
      navigator: obj(),
      setImmediate: fn({ volatile: "timer" }),
      clearImmediate: fn({ volatile: "timer" }),
    }),
  },

  bun: {
    name: "bun",
    description: "Bun target (global/self === globalThis, Bun/process/Buffer/CJS & Web APIs, no window/document)",
    aliases: ["global", "self"],
    globalToStringTag: "global",
    globals: Object.assign({}, COMMON_WINTERCG_GLOBALS, {
      Bun: obj(),
      process: NODE_PROCESS_SPEC,
      Buffer: fn(),
      module: obj(),
      exports: obj(),
      require: fn(),
      __filename: { type: "string", primitiveUnknown: true },
      __dirname: { type: "string", primitiveUnknown: true },
      navigator: obj(),
      caches: obj(),
      setImmediate: fn({ volatile: "timer" }),
      clearImmediate: fn({ volatile: "timer" }),
      Worker: fn(),
    }),
  },

  hermes: {
    name: "hermes",
    description: "Hermes engine target (global === globalThis, HermesInternal + console, no WebAssembly/DOM/Node)",
    aliases: ["global"],
    globalToStringTag: undefined,
    globals: {
      HermesInternal: obj(),
      console: CONSOLE_SPEC,
      print: fn({ volatile: "io" }),
      setTimeout: fn({ volatile: "timer" }),
      clearTimeout: fn({ volatile: "timer" }),
      setInterval: fn({ volatile: "timer" }),
      clearInterval: fn({ volatile: "timer" }),
      setImmediate: fn({ volatile: "timer" }),
      clearImmediate: fn({ volatile: "timer" }),
      queueMicrotask: fn({ microtask: true }),
    },
  },

  universal: {
    name: "universal",
    description:
      "Universal / benchmark sandbox target (global/self/window === globalThis, console + timers, no DOM/Node)",
    aliases: ["global", "self", "window"],
    globalToStringTag: undefined,
    globals: {
      console: CONSOLE_SPEC,
      setTimeout: fn({ volatile: "timer" }),
      clearTimeout: fn({ volatile: "timer" }),
      setInterval: fn({ volatile: "timer" }),
      clearInterval: fn({ volatile: "timer" }),
      queueMicrotask: fn({ microtask: true }),
    },
  },
};

const PROFILE_ALIASES = {
  ecma: "ecmascript",
  bare: "ecmascript",
  bench: "universal",
};

function resolveProfile(profile) {
  if (profile == null) return PROFILES.ecmascript;
  if (typeof profile === "string") {
    const normalized = PROFILE_ALIASES[profile] || profile;
    const found = PROFILES[normalized];
    if (!found) {
      throw new Error(
        `Unknown target environment profile "${profile}". Valid profiles: ${Object.keys(PROFILES).join(", ")}`
      );
    }
    return found;
  }
  if (typeof profile === "object") {
    return {
      name: profile.name || "custom",
      description: profile.description || "Custom environment profile",
      aliases: Array.isArray(profile.aliases) ? profile.aliases.slice() : [],
      globalToStringTag: profile.globalToStringTag,
      globals: Object.assign({}, profile.globals || null),
    };
  }
  throw new TypeError(`Invalid profile argument: expected string or object, got ${typeof profile}`);
}

module.exports = {
  ES_GLOBALS,
  PROFILES,
  CONSOLE_SPEC,
  PERFORMANCE_SPEC,
  CRYPTO_SPEC,
  WEBASSEMBLY_SPEC,
  NODE_PROCESS_SPEC,
  resolveProfile,
};
