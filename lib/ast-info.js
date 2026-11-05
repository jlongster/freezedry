"use strict";

const acorn = require("acorn");

function buildLineStarts(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    const ch = src.charCodeAt(i);
    if (ch === 10) {
      // \n (also handles \r\n since \n is the second char)
      starts.push(i + 1);
    } else if (ch === 13) {
      if (i + 1 < src.length && src.charCodeAt(i + 1) === 10) {
        continue;
      }
      starts.push(i + 1);
    }
  }
  return starts;
}

function locToOffset(lineStarts, lineNumber, columnNumber) {
  if (lineNumber < 0 || lineNumber >= lineStarts.length) return -1;
  return lineStarts[lineNumber] + columnNumber;
}

function hasUseStrictDirective(stmts) {
  if (!Array.isArray(stmts)) return false;
  for (const stmt of stmts) {
    if (stmt.type === "ExpressionStatement" && typeof stmt.directive === "string") {
      if (stmt.directive === "use strict") return true;
    } else {
      break;
    }
  }
  return false;
}

function collectPatternNames(pattern, out) {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      out.push(pattern.name);
      break;
    case "RestElement":
      collectPatternNames(pattern.argument, out);
      break;
    case "AssignmentPattern":
      collectPatternNames(pattern.left, out);
      break;
    case "ArrayPattern":
      for (const el of pattern.elements) {
        if (el) collectPatternNames(el, out);
      }
      break;
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        if (prop.type === "RestElement") {
          collectPatternNames(prop.argument, out);
        } else {
          collectPatternNames(prop.value, out);
        }
      }
      break;
  }
}

function collectVarDeclarators(stmt, varMap) {
  for (const decl of stmt.declarations) {
    const names = [];
    collectPatternNames(decl.id, names);
    for (const n of names) {
      if (!varMap.has(n)) varMap.set(n, "var");
    }
  }
}

function parseScriptAst(src) {
  try {
    return acorn.parse(src, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true,
    });
  } catch {
    try {
      return acorn.parse(src, {
        ecmaVersion: "latest",
        sourceType: "module",
      });
    } catch {
      return null;
    }
  }
}

function indexScript(scriptSource) {
  const lineStarts = buildLineStarts(scriptSource);
  const ast = parseScriptAst(scriptSource);
  if (!ast) {
    return {
      scriptSource,
      lineStarts,
      entries: [],
      hasAnyPrivateIdentifier: false,
      lookup() {
        return null;
      },
    };
  }

  const entries = [];
  let hasAnyPrivateIdentifier = false;

  const programStrict = ast.sourceType === "module" || hasUseStrictDirective(ast.body);
  const programScope = { kind: "program", bindings: new Map() };

  // Pre-collect hoisting & lexical bindings in a block/program statement list
  function collectLexicalInStatements(stmts, lexicalMap, hoistTargetMap) {
    if (!Array.isArray(stmts)) return;
    for (const s of stmts) {
      if (!s) continue;
      if (s.type === "VariableDeclaration") {
        if (s.kind === "let" || s.kind === "const" || s.kind === "using" || s.kind === "await using") {
          const bKind = s.kind === "const" ? "const" : "let";
          for (const d of s.declarations) {
            const names = [];
            collectPatternNames(d.id, names);
            for (const n of names) lexicalMap.set(n, bKind);
          }
        }
      } else if (s.type === "FunctionDeclaration" && s.id) {
        // In strict/block scopes FunctionDeclaration can be block-scoped or var-hoisted; record in both if distinct
        lexicalMap.set(s.id.name, "fn");
        if (hoistTargetMap && !hoistTargetMap.has(s.id.name)) {
          hoistTargetMap.set(s.id.name, "fn");
        }
      } else if (s.type === "ClassDeclaration" && s.id) {
        lexicalMap.set(s.id.name, "let");
      }
    }
  }

  // Collect all `var` declarations inside a function/program boundary (without crossing nested functions/static blocks)
  function collectHoistedVars(node, hoistMap) {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      if (node.type === "FunctionDeclaration" && node.id && !hoistMap.has(node.id.name)) {
        hoistMap.set(node.id.name, "fn");
      }
      return;
    }
    if (node.type === "VariableDeclaration" && node.kind === "var") {
      collectVarDeclarators(node, hoistMap);
    }
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item.type === "string") collectHoistedVars(item, hoistMap);
        }
      } else if (child && typeof child.type === "string") {
        collectHoistedVars(child, hoistMap);
      }
    }
  }

  for (const s of ast.body) {
    collectHoistedVars(s, programScope.bindings);
  }
  collectLexicalInStatements(ast.body, programScope.bindings, programScope.bindings);

  // Walk AST tracking: strictness, enclosing lexical scopes, and private identifier usage per callable
  function walk(node, ctx) {
    if (!node || typeof node !== "object") return false;

    if (node.type === "PrivateIdentifier") {
      hasAnyPrivateIdentifier = true;
      return true;
    }

    // ClassDeclaration / ClassExpression
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      const classScopes = ctx.scopes;
      let innerScopes = classScopes;
      if (node.id) {
        const clsNameScope = { kind: "class", bindings: new Map([[node.id.name, "const"]]) };
        innerScopes = [clsNameScope, ...classScopes];
      }

      let ctorMethod = null;
      let classHasPrivate = false;
      for (const el of node.body.body) {
        if (el.type === "MethodDefinition" || el.type === "PropertyDefinition" || el.type === "AccessorProperty") {
          if (el.key && el.key.type === "PrivateIdentifier") {
            hasAnyPrivateIdentifier = true;
            classHasPrivate = true;
          }
          if (el.type === "MethodDefinition" && el.kind === "constructor") {
            ctorMethod = el;
          }
        }
      }

      if (node.superClass) {
        walk(node.superClass, { strict: true, scopes: innerScopes });
      }

      let ctorUsesPrivate = false;
      for (const el of node.body.body) {
        if (el === ctorMethod) {
          // Walk constructor params and body as part of the class constructor itself
          const fnNode = el.value;
          const fnScope = { kind: "function", bindings: new Map() };
          for (const p of fnNode.params) {
            const names = [];
            collectPatternNames(p, names);
            for (const n of names) fnScope.bindings.set(n, "param");
          }
          collectHoistedVars(fnNode.body, fnScope.bindings);
          collectLexicalInStatements(fnNode.body.body, fnScope.bindings, fnScope.bindings);
          const nextScopes = [fnScope, ...innerScopes];
          for (const p of fnNode.params) {
            if (walk(p, { strict: true, scopes: nextScopes })) ctorUsesPrivate = true;
          }
          for (const stmt of fnNode.body.body) {
            if (walk(stmt, { strict: true, scopes: nextScopes })) ctorUsesPrivate = true;
          }
        } else if (el.type === "MethodDefinition") {
          if (el.computed && el.key) {
            walk(el.key, { strict: true, scopes: innerScopes });
          }
          walkCallable(el.value, {
            strict: true,
            scopes: innerScopes,
            wrapperNode: el,
            isStaticClassMember: Boolean(el.static),
            overrideKind: resolveMethodKind(el.kind, el.value),
          });
        } else if (el.type === "PropertyDefinition") {
          if (el.computed && el.key) {
            walk(el.key, { strict: true, scopes: innerScopes });
          }
          if (el.value) {
            if (walk(el.value, { strict: true, scopes: innerScopes })) {
              classHasPrivate = true;
            }
          }
        } else if (el.type === "StaticBlock") {
          const sbScope = { kind: "block", bindings: new Map() };
          collectHoistedVars(el, sbScope.bindings);
          collectLexicalInStatements(el.body, sbScope.bindings, sbScope.bindings);
          for (const stmt of el.body) {
            if (walk(stmt, { strict: true, scopes: [sbScope, ...innerScopes] })) {
              classHasPrivate = true;
            }
          }
        }
      }

      entries.push({
        kind: "class",
        strict: true,
        spanStart: node.start,
        spanEnd: node.end,
        headerEnd: ctorMethod ? ctorMethod.value.body.start : node.end,
        hasPrivateFields: classHasPrivate || ctorUsesPrivate,
        scopes: innerScopes,
      });

      return classHasPrivate || ctorUsesPrivate;
    }

    // ObjectExpression Property with concise method or getter/setter
    if (node.type === "Property" && (node.method || node.kind === "get" || node.kind === "set")) {
      let usedPriv = false;
      if (node.computed && node.key) {
        if (walk(node.key, ctx)) usedPriv = true;
      }
      const fnUsedPriv = walkCallable(node.value, {
        strict: ctx.strict,
        scopes: ctx.scopes,
        wrapperNode: node,
        overrideKind: resolveMethodKind(node.kind === "init" ? "method" : node.kind, node.value),
      });
      return usedPriv || fnUsedPriv;
    }

    // Standalone FunctionDeclaration / FunctionExpression / ArrowFunctionExpression
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      return walkCallable(node, {
        strict: ctx.strict,
        scopes: ctx.scopes,
        wrapperNode: null,
        overrideKind: resolveStandaloneFunctionKind(node),
      });
    }

    // Block-scoped constructs
    if (node.type === "BlockStatement" || node.type === "SwitchStatement") {
      const stmts = node.type === "BlockStatement" ? node.body : node.cases.flatMap((c) => c.consequent);
      const bScope = { kind: "block", bindings: new Map() };
      collectLexicalInStatements(stmts, bScope.bindings, null);
      const nextCtx = bScope.bindings.size > 0 ? { strict: ctx.strict, scopes: [bScope, ...ctx.scopes] } : ctx;
      return walkChildren(node, nextCtx);
    }

    if (node.type === "ForStatement" || node.type === "ForInStatement" || node.type === "ForOfStatement") {
      const initNode = node.type === "ForStatement" ? node.init : node.left;
      let nextCtx = ctx;
      if (initNode && initNode.type === "VariableDeclaration" && initNode.kind !== "var") {
        const fScope = { kind: "block", bindings: new Map() };
        const bKind = initNode.kind === "const" ? "const" : "let";
        for (const d of initNode.declarations) {
          const names = [];
          collectPatternNames(d.id, names);
          for (const n of names) fScope.bindings.set(n, bKind);
        }
        nextCtx = { strict: ctx.strict, scopes: [fScope, ...ctx.scopes] };
      }
      return walkChildren(node, nextCtx);
    }

    if (node.type === "CatchClause") {
      let nextCtx = ctx;
      if (node.param) {
        const cScope = { kind: "catch", bindings: new Map() };
        const names = [];
        collectPatternNames(node.param, names);
        for (const n of names) cScope.bindings.set(n, "let");
        nextCtx = { strict: ctx.strict, scopes: [cScope, ...ctx.scopes] };
      }
      return walkChildren(node, nextCtx);
    }

    return walkChildren(node, ctx);
  }

  function walkChildren(node, ctx) {
    let usedPriv = false;
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item.type === "string") {
            if (walk(item, ctx)) usedPriv = true;
          }
        }
      } else if (child && typeof child.type === "string") {
        if (walk(child, ctx)) usedPriv = true;
      }
    }
    return usedPriv;
  }

  function walkCallable(fnNode, opts) {
    const ownStrict =
      opts.strict || (fnNode.body && fnNode.body.type === "BlockStatement" && hasUseStrictDirective(fnNode.body.body));
    const fnScope = { kind: "function", bindings: new Map() };
    if (fnNode.type === "FunctionExpression" && fnNode.id) {
      fnScope.bindings.set(fnNode.id.name, "fn");
    }
    for (const p of fnNode.params) {
      const names = [];
      collectPatternNames(p, names);
      for (const n of names) fnScope.bindings.set(n, "param");
    }
    if (fnNode.body && fnNode.body.type === "BlockStatement") {
      collectHoistedVars(fnNode.body, fnScope.bindings);
      collectLexicalInStatements(fnNode.body.body, fnScope.bindings, fnScope.bindings);
    }

    const innerScopes = [fnScope, ...opts.scopes];
    let usesPriv = false;
    for (const p of fnNode.params) {
      if (walk(p, { strict: ownStrict, scopes: innerScopes })) usesPriv = true;
    }
    if (fnNode.body) {
      if (fnNode.body.type === "BlockStatement") {
        for (const stmt of fnNode.body.body) {
          if (walk(stmt, { strict: ownStrict, scopes: innerScopes })) usesPriv = true;
        }
      } else {
        if (walk(fnNode.body, { strict: ownStrict, scopes: innerScopes })) usesPriv = true;
      }
    }

    const spanNode = opts.wrapperNode || fnNode;
    entries.push({
      kind: opts.overrideKind,
      strict: ownStrict,
      spanStart: spanNode.start,
      spanEnd: spanNode.end,
      headerEnd: fnNode.body ? fnNode.body.start : spanNode.end,
      hasPrivateFields: usesPriv,
      isDeclaration: fnNode.type === "FunctionDeclaration",
      usesSuper: Boolean(opts.wrapperNode) && containsDirectSuper(fnNode),
      isStaticClassMember: Boolean(opts.isStaticClassMember),
      scopes: opts.scopes,
    });
    return usesPriv;
  }

  for (const stmt of ast.body) {
    walk(stmt, { strict: programStrict, scopes: [programScope] });
  }

  return {
    scriptSource,
    lineStarts,
    entries,
    hasAnyPrivateIdentifier,
    lookup(lineNumber, columnNumber) {
      const offset = locToOffset(lineStarts, lineNumber, columnNumber);
      if (offset < 0) return null;
      let best = null;
      let bestSpan = Infinity;
      for (const entry of entries) {
        if (offset >= entry.spanStart && offset <= entry.headerEnd) {
          const span = entry.spanEnd - entry.spanStart;
          if (span < bestSpan) {
            best = entry;
            bestSpan = span;
          }
        }
      }
      return best;
    },
  };
}

function resolveStandaloneFunctionKind(fnNode) {
  if (fnNode.type === "ArrowFunctionExpression") return "arrow";
  if (fnNode.async && fnNode.generator) return "asyncGenerator";
  if (fnNode.generator) return "generator";
  if (fnNode.async) return "async";
  return "normal";
}

function resolveMethodKind(methodKind, fnNode) {
  if (methodKind === "get") return "getter";
  if (methodKind === "set") return "setter";
  if (fnNode.async && fnNode.generator) return "asyncGenerator";
  if (fnNode.generator) return "generator";
  if (fnNode.async) return "async";
  return "method";
}

function analyzeStandaloneSource(fnSource) {
  const trimmed = fnSource.trim();
  if (/^class[\s{]/.test(trimmed)) {
    const ast = parseScriptAst(`(${trimmed})`);
    const hasPriv = containsPrivateId(ast);
    return { kind: "class", strict: true, hasPrivateFields: hasPriv, scopes: [] };
  }
  // Try parsing as expression `(<source>)` first, then as object method `({ <source> })`
  for (const [wrapped, isObjMethod] of [
    [`(${trimmed})`, false],
    [`({ ${trimmed}\n})`, true],
  ]) {
    const ast = parseScriptAst(wrapped);
    if (!ast || !ast.body[0] || ast.body[0].type !== "ExpressionStatement") continue;
    const expr = ast.body[0].expression;
    if (!isObjMethod) {
      if (
        expr.type === "FunctionExpression" ||
        expr.type === "ArrowFunctionExpression"
      ) {
        const strict =
          expr.body && expr.body.type === "BlockStatement" ? hasUseStrictDirective(expr.body.body) : false;
        return {
          kind: resolveStandaloneFunctionKind(expr),
          strict,
          hasPrivateFields: containsPrivateId(expr),
          scopes: [],
        };
      }
      } else if (expr.type === "ObjectExpression" && expr.properties.length === 1) {
      const prop = expr.properties[0];
      if (prop.type === "Property" && prop.value) {
        const fnNode = prop.value;
        const strict =
          fnNode.body && fnNode.body.type === "BlockStatement" ? hasUseStrictDirective(fnNode.body.body) : false;
        return {
          kind: resolveMethodKind(prop.kind === "init" ? "method" : prop.kind, fnNode),
          strict,
          hasPrivateFields: containsPrivateId(prop),
          usesSuper: containsDirectSuper(fnNode),
          isStaticClassMember: false,
          scopes: [],
        };
      }
    }
  }
  return null;
}

function containsDirectSuper(fnNode) {
  function check(n) {
    if (!n || typeof n !== "object") return false;
    if (n.type === "Super") return true;
    if (
      n !== fnNode &&
      (n.type === "FunctionDeclaration" ||
        n.type === "FunctionExpression" ||
        n.type === "ClassDeclaration" ||
        n.type === "ClassExpression" ||
        n.type === "MethodDefinition" ||
        (n.type === "Property" && (n.method || n.kind === "get" || n.kind === "set")))
    ) {
      return false;
    }
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      const c = n[k];
      if (Array.isArray(c)) {
        for (const item of c) {
          if (check(item)) return true;
        }
      } else if (c && typeof c === "object") {
        if (check(c)) return true;
      }
    }
    return false;
  }
  return check(fnNode);
}

function containsPrivateId(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "PrivateIdentifier") return true;
  for (const k of Object.keys(node)) {
    if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
    const c = node[k];
    if (Array.isArray(c)) {
      for (const item of c) {
        if (containsPrivateId(item)) return true;
      }
    } else if (c && typeof c === "object") {
      if (containsPrivateId(c)) return true;
    }
  }
  return false;
}

function resolveVarKindFromAstScopes(varName, astScopes) {
  if (!Array.isArray(astScopes)) return "let";
  for (const sc of astScopes) {
    if (sc.bindings && sc.bindings.has(varName)) {
      return sc.bindings.get(varName);
    }
  }
  return "let";
}

module.exports = {
  indexScript,
  analyzeStandaloneSource,
  resolveVarKindFromAstScopes,
};
