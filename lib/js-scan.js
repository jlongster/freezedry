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

function collectAcornPatternNames(pat, out) {
  if (!pat || typeof pat !== "object") return;
  switch (pat.type) {
    case "Identifier":
      out.add(pat.name);
      break;
    case "AssignmentPattern":
      collectAcornPatternNames(pat.left, out);
      break;
    case "RestElement":
      collectAcornPatternNames(pat.argument, out);
      break;
    case "ArrayPattern":
      for (const el of pat.elements) {
        if (el) collectAcornPatternNames(el, out);
      }
      break;
    case "ObjectPattern":
      for (const p of pat.properties) {
        if (p.type === "RestElement") collectAcornPatternNames(p.argument, out);
        else collectAcornPatternNames(p.value, out);
      }
      break;
  }
}

function collectHoistedFunctionVars(bodyNode, out) {
  if (!bodyNode || typeof bodyNode !== "object") return;
  function scan(n) {
    if (!n || typeof n !== "object") return;
    if (
      n !== bodyNode &&
      (n.type === "FunctionDeclaration" ||
        n.type === "FunctionExpression" ||
        n.type === "ArrowFunctionExpression" ||
        n.type === "StaticBlock")
    ) {
      if (n.type === "FunctionDeclaration" && n.id) out.add(n.id.name);
      return;
    }
    if (n.type === "VariableDeclaration" && n.kind === "var") {
      for (const d of n.declarations) collectAcornPatternNames(d.id, out);
    }
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      const c = n[k];
      if (Array.isArray(c)) {
        for (const item of c) {
          if (item && typeof item.type === "string") scan(item);
        }
      } else if (c && typeof c.type === "string") {
        scan(c);
      }
    }
  }
  scan(bodyNode);
}

function parseCallableAst(fnSource) {
  const trimmed = fnSource.trim();
  for (const [src, extract] of [
    [`(\n${trimmed}\n)`, prog => (prog.body[0] && prog.body[0].expression) || null],
    [
      `({\n${trimmed}\n})`,
      prog => {
        const expr = prog.body[0] && prog.body[0].expression;
        if (expr && expr.type === "ObjectExpression" && expr.properties.length === 1) {
          return expr.properties[0];
        }
        return null;
      },
    ],
  ]) {
    try {
      const prog = acorn.parse(src, { ecmaVersion: "latest", sourceType: "script" });
      if (prog.body.length === 1 && prog.body[0].type === "ExpressionStatement") {
        const root = extract(prog);
        if (root) return root;
      }
    } catch {
      // try next wrapper
    }
  }
  if (trimmed.includes("#")) {
    const privIds = Array.from(new Set(trimmed.match(/#[A-Za-z_$][A-Za-z0-9_$]*/g) || []));
    if (privIds.length > 0) {
      try {
        const decls = privIds.map(p => `${p};`).join(" ");
        const prog = acorn.parse(`(class { ${decls}\n${trimmed}\n})`, {
          ecmaVersion: "latest",
          sourceType: "script",
        });
        const cls = prog.body[0] && prog.body[0].expression;
        if (cls && cls.type === "ClassExpression") {
          const m = cls.body.body.find(el => el.type === "MethodDefinition");
          if (m) return m;
        }
      } catch {
        // fall through
      }
    }
  }
  return null;
}

function analyzeCallableFreeVarsAst(rootNode) {
  let hasEvalOrWith = false;
  let capturesThis = false;
  const freeIdentifiers = new Set();

  function walkExprOrStmt(node, bound, inArrowThis = false) {
    if (!node || typeof node !== "object") return;
    switch (node.type) {
      case "ThisExpression":
        if (inArrowThis) capturesThis = true;
        return;

      case "WithStatement":
        hasEvalOrWith = true;
        walkExprOrStmt(node.object, bound, inArrowThis);
        walkExprOrStmt(node.body, bound, inArrowThis);
        return;

      case "Identifier":
        if (node.name === "eval" && !bound.has("eval")) {
          hasEvalOrWith = true;
        }
        if (!bound.has(node.name)) {
          freeIdentifiers.add(node.name);
        }
        return;

      case "MemberExpression":
        walkExprOrStmt(node.object, bound);
        if (node.computed) walkExprOrStmt(node.property, bound);
        return;

      case "Property":
        if (node.computed) walkExprOrStmt(node.key, bound);
        if (node.method || node.kind === "get" || node.kind === "set") {
          walkFunctionLike(node.value, bound, false);
        } else {
          walkExprOrStmt(node.value, bound);
        }
        return;

      case "PropertyDefinition":
      case "AccessorProperty":
        if (node.computed) walkExprOrStmt(node.key, bound);
        if (node.value) walkExprOrStmt(node.value, bound);
        return;

      case "MethodDefinition":
        if (node.computed) walkExprOrStmt(node.key, bound);
        walkFunctionLike(node.value, bound, false);
        return;

      case "FunctionDeclaration":
      case "FunctionExpression":
        walkFunctionLike(node, bound, node.type === "FunctionExpression");
        return;

      case "ArrowFunctionExpression":
        walkFunctionLike(node, bound, false);
        return;

      case "ClassDeclaration":
      case "ClassExpression": {
        if (node.superClass) walkExprOrStmt(node.superClass, bound);
        const clsBound = new Set(bound);
        if (node.id) clsBound.add(node.id.name);
        for (const el of node.body.body) walkExprOrStmt(el, clsBound);
        return;
      }

      case "BlockStatement":
      case "StaticBlock": {
        const stmts = node.body;
        const nextBound = new Set(bound);
        if (node.type === "StaticBlock") {
          collectHoistedFunctionVars(node, nextBound);
        }
        for (const s of stmts) {
          if (s.type === "VariableDeclaration" && s.kind !== "var") {
            for (const d of s.declarations) collectAcornPatternNames(d.id, nextBound);
          } else if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) {
            nextBound.add(s.id.name);
          }
        }
        for (const s of stmts) walkExprOrStmt(s, nextBound);
        return;
      }

      case "SwitchStatement": {
        walkExprOrStmt(node.discriminant, bound);
        const nextBound = new Set(bound);
        for (const c of node.cases) {
          for (const s of c.consequent) {
            if (s.type === "VariableDeclaration" && s.kind !== "var") {
              for (const d of s.declarations) collectAcornPatternNames(d.id, nextBound);
            } else if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) {
              nextBound.add(s.id.name);
            }
          }
        }
        for (const c of node.cases) {
          if (c.test) walkExprOrStmt(c.test, nextBound);
          for (const s of c.consequent) walkExprOrStmt(s, nextBound);
        }
        return;
      }

      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const init = node.type === "ForStatement" ? node.init : node.left;
        const nextBound = new Set(bound);
        if (init && init.type === "VariableDeclaration" && init.kind !== "var") {
          for (const d of init.declarations) collectAcornPatternNames(d.id, nextBound);
        }
        if (node.type === "ForStatement") {
          if (node.init) walkExprOrStmt(node.init, nextBound);
          if (node.test) walkExprOrStmt(node.test, nextBound);
          if (node.update) walkExprOrStmt(node.update, nextBound);
          walkExprOrStmt(node.body, nextBound);
        } else {
          walkExprOrStmt(node.left, nextBound);
          walkExprOrStmt(node.right, bound);
          walkExprOrStmt(node.body, nextBound);
        }
        return;
      }

      case "CatchClause": {
        const nextBound = new Set(bound);
        if (node.param) collectAcornPatternNames(node.param, nextBound);
        if (node.param) walkPatternDefaults(node.param, nextBound);
        walkExprOrStmt(node.body, nextBound);
        return;
      }

      case "VariableDeclarator":
        walkPatternDefaults(node.id, bound);
        if (node.init) walkExprOrStmt(node.init, bound);
        return;

      case "LabeledStatement":
        walkExprOrStmt(node.body, bound);
        return;

      case "BreakStatement":
      case "ContinueStatement":
      case "PrivateIdentifier":
        return;

      case "ObjectPattern":
        for (const p of node.properties) {
          if (p.type === "RestElement") {
            walkPatternDefaults(p.argument, bound);
          } else {
            if (p.computed) walkExprOrStmt(p.key, bound);
            walkPatternDefaults(p.value, bound);
          }
        }
        return;

      case "ArrayPattern":
        for (const el of node.elements) {
          if (el) walkPatternDefaults(el, bound);
        }
        return;

      case "AssignmentPattern":
        walkPatternDefaults(node.left, bound);
        walkExprOrStmt(node.right, bound);
        return;
    }

    for (const k of Object.keys(node)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      const c = node[k];
      if (Array.isArray(c)) {
        for (const item of c) {
          if (item && typeof item.type === "string") walkExprOrStmt(item, bound);
        }
      } else if (c && typeof c.type === "string") {
        walkExprOrStmt(c, bound);
      }
    }
  }

  function walkPatternDefaults(pat, bound) {
    if (!pat || typeof pat !== "object") return;
    if (pat.type === "AssignmentPattern") {
      walkPatternDefaults(pat.left, bound);
      walkExprOrStmt(pat.right, bound);
    } else if (pat.type === "RestElement") {
      walkPatternDefaults(pat.argument, bound);
    } else if (pat.type === "ArrayPattern") {
      for (const el of pat.elements) {
        if (el) walkPatternDefaults(el, bound);
      }
    } else if (pat.type === "ObjectPattern") {
      for (const p of pat.properties) {
        if (p.type === "RestElement") walkPatternDefaults(p.argument, bound);
        else {
          if (p.computed) walkExprOrStmt(p.key, bound);
          walkPatternDefaults(p.value, bound);
        }
      }
    }
  }

  function walkFunctionLike(fnNode, outerBound, includeOwnId) {
    const fnBound = new Set(outerBound);
    if (includeOwnId && fnNode.id) fnBound.add(fnNode.id.name);
    if (fnNode.type !== "ArrowFunctionExpression") {
      fnBound.add("arguments");
    }
    for (const p of fnNode.params) collectAcornPatternNames(p, fnBound);
    for (const p of fnNode.params) walkPatternDefaults(p, fnBound);
    if (fnNode.body && fnNode.body.type === "BlockStatement") {
      collectHoistedFunctionVars(fnNode.body, fnBound);
      walkExprOrStmt(fnNode.body, fnBound);
    } else if (fnNode.body) {
      walkExprOrStmt(fnNode.body, fnBound);
    }
  }

  if (rootNode.type === "Property" || rootNode.type === "MethodDefinition") {
    if (rootNode.computed) walkExprOrStmt(rootNode.key, new Set(), false);
    walkFunctionLike(rootNode.value, new Set(), false);
  } else if (
    rootNode.type === "FunctionExpression" ||
    rootNode.type === "FunctionDeclaration" ||
    rootNode.type === "ArrowFunctionExpression"
  ) {
    // Note: for FunctionDeclaration (`function foo()`), `foo` inside body may resolve to outer scope!
    // We intentionally do NOT add `rootNode.id.name` to `bound` when `rootNode` is top-level so self-references
    // to a FunctionDeclaration's outer binding (e.g. `ret._setup()`) ARE verified!
    // Wait: for true Named FunctionExpressions (`var x = function mySelf() { return mySelf; }`), V8 represents `mySelf`
    // in its own NFE frame or elides it when unused; keeping `rootNode.id.name` in `freeIdentifiers` is completely safe
    // because `verify.js` only checks names present in `chainA` or `chainB`!
    if (rootNode.type === "ArrowFunctionExpression") {
      const fnBound = new Set();
      for (const p of rootNode.params) collectAcornPatternNames(p, fnBound);
      for (const p of rootNode.params) walkPatternDefaults(p, fnBound);
      if (rootNode.body && rootNode.body.type === "BlockStatement") {
        collectHoistedFunctionVars(rootNode.body, fnBound);
        walkExprOrStmt(rootNode.body, fnBound, true);
      } else if (rootNode.body) {
        walkExprOrStmt(rootNode.body, fnBound, true);
      }
    } else {
      walkFunctionLike(rootNode, new Set(), false);
    }
  } else if (rootNode.type === "ClassExpression" || rootNode.type === "ClassDeclaration") {
    walkExprOrStmt(rootNode, new Set(), false);
  } else {
    return null;
  }

  return { freeIdentifiers, hasEvalOrWith, capturesThis };
}

// Analyze a JS function's source text to determine:
// - hasEvalOrWith: true if direct `eval` or `with` appears (requires keeping all scope vars)
// - freeIdentifiers: Set of identifiers that could resolve to outer closure scopes
function analyzeFunctionSource(fnSource) {
  const parsedRoot = parseCallableAst(fnSource);
  if (parsedRoot) {
    const astRes = analyzeCallableFreeVarsAst(parsedRoot);
    if (astRes) return astRes;
  }

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

const acorn = require("acorn");

function hasAcornUseStrict(stmts) {
  if (!Array.isArray(stmts)) return false;
  for (const s of stmts) {
    if (s.type === "ExpressionStatement" && typeof s.directive === "string") {
      if (s.directive === "use strict") return true;
    } else {
      break;
    }
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

  let ast = null;
  try {
    ast = acorn.parse(scriptSource, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true,
    });
  } catch {
    ast = null;
  }

  if (ast) {
    if (hasAcornUseStrict(ast.body)) {
      return { allStrict: true, lineOffsets, intervals: [[0, scriptSource.length]] };
    }
    const intervals = [];
    function walk(node, inStrict) {
      if (!node || typeof node !== "object") return;
      if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
        if (!inStrict) intervals.push([node.start, node.end]);
        return;
      }
      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
      ) {
        if (!inStrict && node.body && node.body.type === "BlockStatement" && hasAcornUseStrict(node.body.body)) {
          intervals.push([node.start, node.end]);
          return;
        }
      }
      for (const k of Object.keys(node)) {
        if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
        const c = node[k];
        if (Array.isArray(c)) {
          for (const item of c) {
            if (item && typeof item.type === "string") walk(item, inStrict);
          }
        } else if (c && typeof c.type === "string") {
          walk(c, inStrict);
        }
      }
    }
    for (const stmt of ast.body) walk(stmt, false);
    return { allStrict: false, lineOffsets, intervals };
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
