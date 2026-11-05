"use strict";

// Lightweight zero-dependency JS lexical scanner for the independent verifier.
// Used strictly for:
//   1. Finding candidate free identifiers (and eval/with usage) in fn.toString()
//   2. Determining inherited lexical strictness ("use strict" / class bodies) in scripts

const KEYWORDS = new Set([
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
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
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
  "let",
  "static",
  "await",
  "of",
  "async",
]);

const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "throw",
  "case",
  "delete",
  "void",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "do",
  "else",
  "yield",
  "await",
]);

function isIdentStart(ch) {
  return (
    (ch >= 65 && ch <= 90) || // A-Z
    (ch >= 97 && ch <= 122) || // a-z
    ch === 36 || // $
    ch === 95 || // _
    ch === 92 || // \uXXXX unicode escape
    ch > 127
  );
}

function isIdentPart(ch) {
  return isIdentStart(ch) || (ch >= 48 && ch <= 57);
}

function skipString(src, start, quote) {
  const len = src.length;
  let i = start + 1;
  while (i < len) {
    const ch = src.charCodeAt(i);
    if (ch === 92) {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return len;
}

function skipRegex(src, start) {
  const len = src.length;
  let i = start + 1;
  let inClass = false;
  while (i < len) {
    const ch = src.charCodeAt(i);
    if (ch === 92) {
      i += 2;
      continue;
    }
    if (ch === 91) inClass = true;
    else if (ch === 93) inClass = false;
    else if (ch === 47 && !inClass) {
      i++;
      while (i < len && isIdentPart(src.charCodeAt(i))) i++;
      return i;
    } else if (ch === 10 || ch === 13) {
      return start + 1;
    }
    i++;
  }
  return len;
}

// Tokenize a JS snippet into minimal tokens: { type: "ident"|"str"|"punct", value, start, end }
// Handles comments, strings, regex literals, and nested template literal ${...} expressions.
function tokenizeJs(src) {
  const tokens = [];
  const len = src.length;
  let i = 0;
  let canBeRegex = true;
  // Stack of brace depths waiting to resume a template literal after `}`
  const templateBraceStack = [];
  let braceDepth = 0;

  while (i < len) {
    const ch = src.charCodeAt(i);

    // Whitespace
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 12 || ch === 11 || ch === 0xfeff) {
      i++;
      continue;
    }

    // Comments or `/` or regex
    if (ch === 47) {
      const next = src.charCodeAt(i + 1);
      if (next === 47) {
        i += 2;
        while (i < len && src.charCodeAt(i) !== 10 && src.charCodeAt(i) !== 13) i++;
        continue;
      }
      if (next === 42) {
        i += 2;
        while (i < len && !(src.charCodeAt(i) === 42 && src.charCodeAt(i + 1) === 47)) i++;
        i += 2;
        continue;
      }
      if (canBeRegex) {
        const end = skipRegex(src, i);
        tokens.push({ type: "regex", value: "", start: i, end });
        i = end;
        canBeRegex = false;
        continue;
      }
      const end = next === 61 ? i + 2 : i + 1;
      tokens.push({ type: "punct", value: src.slice(i, end), start: i, end });
      i = end;
      canBeRegex = true;
      continue;
    }

    // Single or double quoted string
    if (ch === 39 || ch === 34) {
      const end = skipString(src, i, ch);
      tokens.push({ type: "str", value: src.slice(i + 1, end - 1), raw: src.slice(i, end), start: i, end });
      i = end;
      canBeRegex = false;
      continue;
    }

    // Template literal start
    if (ch === 96) {
      i++;
      while (i < len) {
        const tc = src.charCodeAt(i);
        if (tc === 92) {
          i += 2;
          continue;
        }
        if (tc === 96) {
          i++;
          canBeRegex = false;
          break;
        }
        if (tc === 36 && src.charCodeAt(i + 1) === 123) {
          templateBraceStack.push(braceDepth);
          braceDepth++;
          i += 2;
          canBeRegex = true;
          break;
        }
        i++;
      }
      continue;
    }

    // Closing brace: might resume a template literal!
    if (ch === 125) {
      if (templateBraceStack.length > 0 && braceDepth - 1 === templateBraceStack[templateBraceStack.length - 1]) {
        templateBraceStack.pop();
        braceDepth--;
        i++;
        while (i < len) {
          const tc = src.charCodeAt(i);
          if (tc === 92) {
            i += 2;
            continue;
          }
          if (tc === 96) {
            i++;
            canBeRegex = false;
            break;
          }
          if (tc === 36 && src.charCodeAt(i + 1) === 123) {
            templateBraceStack.push(braceDepth);
            braceDepth++;
            i += 2;
            canBeRegex = true;
            break;
          }
          i++;
        }
        continue;
      }
      braceDepth = Math.max(0, braceDepth - 1);
      tokens.push({ type: "punct", value: "}", start: i, end: i + 1 });
      i++;
      // After `}`, regex is allowed after block statements; safe approximation: true
      canBeRegex = true;
      continue;
    }

    if (ch === 123) {
      braceDepth++;
      tokens.push({ type: "punct", value: "{", start: i, end: i + 1 });
      i++;
      canBeRegex = true;
      continue;
    }

    // Numbers
    if (ch >= 48 && ch <= 57) {
      const start = i;
      i++;
      while (i < len && (isIdentPart(src.charCodeAt(i)) || src.charCodeAt(i) === 46)) i++;
      tokens.push({ type: "num", value: src.slice(start, i), start, end: i });
      canBeRegex = false;
      continue;
    }

    // Identifiers & keywords
    if (isIdentStart(ch)) {
      const start = i;
      i++;
      while (i < len) {
        const ic = src.charCodeAt(i);
        if (ic === 92 && src.charCodeAt(i + 1) === 117) {
          i += 2;
          continue;
        }
        if (!isIdentPart(ic)) break;
        i++;
      }
      const word = src.slice(start, i);
      tokens.push({ type: "ident", value: word, start, end: i });
      canBeRegex = REGEX_PRECEDING_KEYWORDS.has(word);
      continue;
    }

    // Multi-char punctuators of interest (`=>`, `...`, `?.`, `++`, `--`)
    if (ch === 61 && src.charCodeAt(i + 1) === 62) {
      tokens.push({ type: "punct", value: "=>", start: i, end: i + 2 });
      i += 2;
      canBeRegex = true;
      continue;
    }
    if (ch === 46 && src.charCodeAt(i + 1) === 46 && src.charCodeAt(i + 2) === 46) {
      tokens.push({ type: "punct", value: "...", start: i, end: i + 3 });
      i += 3;
      canBeRegex = true;
      continue;
    }
    if ((ch === 43 && src.charCodeAt(i + 1) === 43) || (ch === 45 && src.charCodeAt(i + 1) === 45)) {
      tokens.push({ type: "punct", value: src.slice(i, i + 2), start: i, end: i + 2 });
      i += 2;
      canBeRegex = false;
      continue;
    }

    const p = src[i];
    tokens.push({ type: "punct", value: p, start: i, end: i + 1 });
    i++;
    canBeRegex = p !== ")" && p !== "]";
  }

  return tokens;
}

// Decode \uXXXX or \u{X...} escapes in identifier names if present.
function normalizeIdent(raw) {
  if (!raw.includes("\\u")) return raw;
  return raw
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Analyze a JS function's source text to determine:
// - hasEvalOrWith: true if direct `eval` or `with` appears (requires keeping all scope vars)
// - freeIdentifiers: Set of identifiers that could resolve to outer closure scopes
function analyzeFunctionSource(fnSource) {
  const tokens = tokenizeJs(fnSource);
  const localParams = new Set();
  let bodyStartIdx = 0;

  // Extract simple top-level parameter list (only when free of `=`, `{`, `[` destructuring/defaults)
  let tIdx = 0;
  if (tokens[tIdx] && tokens[tIdx].type === "ident" && tokens[tIdx].value === "async") tIdx++;
  if (tokens[tIdx] && tokens[tIdx].type === "ident" && tokens[tIdx].value === "function") {
    tIdx++;
    if (tokens[tIdx] && tokens[tIdx].value === "*") tIdx++;
    if (tokens[tIdx] && tokens[tIdx].type === "ident") {
      // Named function expression's own name binds inside its body
      localParams.add(normalizeIdent(tokens[tIdx].value));
      tIdx++;
    }
  } else if (tokens[tIdx] && tokens[tIdx].type === "ident" && tokens[tIdx + 1] && tokens[tIdx + 1].value === "=>") {
    // Single-param arrow: `x => ...`
    localParams.add(normalizeIdent(tokens[tIdx].value));
    bodyStartIdx = tIdx + 2;
  }

  if (bodyStartIdx === 0) {
    // Find opening `(` of parameter list for normal/arrow/method/getter/setter (skip for `class`)
    if (!(tokens[0] && tokens[0].type === "ident" && tokens[0].value === "class")) {
      // Advance past method/getter/setter name if not computed `[expr]`
      while (tIdx < tokens.length && tokens[tIdx].value !== "(" && tokens[tIdx].value !== "[") {
        tIdx++;
      }
      if (tokens[tIdx] && tokens[tIdx].value === "(") {
        let depth = 1;
        let closeIdx = tIdx + 1;
        let simple = true;
        const candidates = [];
        while (closeIdx < tokens.length && depth > 0) {
          const tk = tokens[closeIdx];
          if (tk.value === "(") {
            depth++;
            simple = false;
          } else if (tk.value === ")") {
            depth--;
            if (depth === 0) break;
          } else if (tk.value === "=" || tk.value === "{" || tk.value === "[") {
            simple = false;
          } else if (tk.type === "ident") {
            candidates.push(normalizeIdent(tk.value));
          } else if (tk.value !== "," && tk.value !== "...") {
            simple = false;
          }
          closeIdx++;
        }
        if (simple && depth === 0) {
          for (const c of candidates) localParams.add(c);
          bodyStartIdx = closeIdx + 1;
          if (tokens[bodyStartIdx] && tokens[bodyStartIdx].value === "=>") bodyStartIdx++;
        }
      }
    }
  }

  let hasEvalOrWith = false;
  const freeIdentifiers = new Set();

  for (let k = bodyStartIdx; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.type !== "ident") continue;
    const prev = k > 0 ? tokens[k - 1] : null;
    // Skip member access `.prop` (not `...ident`)
    if (prev && prev.type === "punct" && (prev.value === "." || prev.value === "?.")) continue;
    const name = normalizeIdent(tk.value);
    if (name === "with") {
      hasEvalOrWith = true;
      continue;
    }
    if (name === "eval") {
      hasEvalOrWith = true;
    }
    if (KEYWORDS.has(name) && name !== "eval") continue;
    if (localParams.has(name)) continue;
    freeIdentifiers.add(name);
  }

  return { freeIdentifiers, hasEvalOrWith };
}

function hasDirectiveUseStrict(tokens, startIdx) {
  let k = startIdx;
  while (k < tokens.length) {
    const tk = tokens[k];
    if (tk.type !== "str") break;
    // Raw must literally be `"use strict"` or `'use strict'` (no escapes per ES spec)
    if (tk.raw === '"use strict"' || tk.raw === "'use strict'") {
      const next = tokens[k + 1];
      if (!next || next.value === ";" || next.value === "}" || next.start > tk.end) {
        return true;
      }
    }
    k++;
    if (tokens[k] && tokens[k].value === ";") k++;
  }
  return false;
}

// Compute character-offset intervals `[start, end]` in `scriptSource` that are in strict mode
// (top-level `"use strict"`, `"use strict"` function prologues, or `class` definitions).
function computeStrictProfile(scriptSource) {
  const lineOffsets = [0];
  for (let i = 0; i < scriptSource.length; i++) {
    if (scriptSource.charCodeAt(i) === 10) lineOffsets.push(i + 1);
  }

  const tokens = tokenizeJs(scriptSource);
  if (hasDirectiveUseStrict(tokens, 0)) {
    return { allStrict: true, lineOffsets, intervals: [[0, scriptSource.length]] };
  }

  const intervals = [];
  // Track braces to find matching `}` for `class` bodies and `"use strict"` function bodies
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type === "ident" && tk.value === "class") {
      // Everything from `class` keyword through the closing `}` of the class body is strict
      let j = i + 1;
      while (j < tokens.length && tokens[j].value !== "{") j++;
      if (j < tokens.length) {
        const end = findMatchingCloseBrace(tokens, j, scriptSource.length);
        intervals.push([tk.start, end]);
      }
    } else if (tk.value === "{") {
      // Check if `{` opens a function/arrow/method body with `"use strict"` prologue
      const prev = i > 0 ? tokens[i - 1] : null;
      if (prev && (prev.value === ")" || prev.value === "=>")) {
        if (hasDirectiveUseStrict(tokens, i + 1)) {
          const end = findMatchingCloseBrace(tokens, i, scriptSource.length);
          intervals.push([tk.start, end]);
        }
      }
    }
  }

  return { allStrict: false, lineOffsets, intervals };
}

function findMatchingCloseBrace(tokens, openBraceTokenIdx, fallbackEnd) {
  let depth = 1;
  for (let k = openBraceTokenIdx + 1; k < tokens.length; k++) {
    if (tokens[k].value === "{") depth++;
    else if (tokens[k].value === "}") {
      depth--;
      if (depth === 0) return tokens[k].end;
    }
  }
  return fallbackEnd;
}

function isPositionStrict(profile, lineNumber, columnNumber, fnSource) {
  if (profile && profile.allStrict) return true;
  if (fnSource) {
    const fnTokens = tokenizeJs(fnSource);
    const openBrace = fnTokens.findIndex(t => t.value === "{");
    if (openBrace >= 0 && hasDirectiveUseStrict(fnTokens, openBrace + 1)) return true;
  }
  if (!profile) return false;
  const lineStart = profile.lineOffsets[lineNumber] ?? 0;
  const offset = lineStart + (columnNumber || 0);
  for (const [s, e] of profile.intervals) {
    if (offset >= s && offset <= e) return true;
  }
  return false;
}

module.exports = {
  tokenizeJs,
  analyzeFunctionSource,
  computeStrictProfile,
  isPositionStrict,
};
