// Parse pattern source into a Lezer JavaScript syntax tree.
//
// Lezer ships with @codemirror/lang-javascript (already loaded in the editor)
// and recovers on partial input — a half-typed pattern still yields a walkable
// tree with ⚠ error nodes in the broken spans, which keeps lint alive across
// keystrokes.
//
// This module is the single source of truth for static analysis of pattern
// source. lint.js (and future symbol-table passes) consume `parsePattern()`
// rather than running their own regexes over the text.

import { parser } from '@lezer/javascript'

export function parsePattern(source) {
  return parser.parse(source)
}

// 1-based {line, col} for a source offset — matches the editor's diagnostic
// convention (see src/app/editor.js:74).
export function offsetToLineCol(source, offset) {
  let line = 1, col = 1
  const end = Math.min(offset, source.length)
  for (let i = 0; i < end; i++) {
    if (source.charCodeAt(i) === 10) { line++; col = 1 }
    else col++
  }
  return { line, col }
}

// {line, col, endLine, endCol} for a Lezer node range.
export function rangeFromNode(source, from, to) {
  const a = offsetToLineCol(source, from)
  const b = offsetToLineCol(source, to)
  return { line: a.line, col: a.col, endLine: b.line, endCol: b.col }
}

// Visit every descendant of `root`; callback returns false to skip subtree.
// Skips Lezer error-recovery nodes so half-typed code doesn't produce spurious
// findings on partial input.
export function walk(root, cb) {
  const c = root.cursor()
  function visit() {
    if (c.type.isError) return
    const cont = cb({ name: c.type.name, from: c.from, to: c.to, node: c.node })
    if (cont === false) return
    if (c.firstChild()) {
      do visit(); while (c.nextSibling())
      c.parent()
    }
  }
  if (c.firstChild()) {
    do visit(); while (c.nextSibling())
  }
}

// Collect every descendant whose name is in `names`.
export function descendants(root, names) {
  const want = new Set(names)
  const out = []
  walk(root, (n) => { if (want.has(n.name)) out.push(n) })
  return out
}

// Top-level FunctionDeclarations, each tagged with `exported` based on whether
// it sits under an ExportDeclaration.
export function topLevelFunctions(tree) {
  const out = []
  const c = tree.cursor()
  if (!c.firstChild()) return out
  do {
    if (c.type.isError) continue
    let exported = false
    let fnNode = null
    if (c.type.name === 'ExportDeclaration') {
      const sub = c.node.cursor()
      if (sub.firstChild()) {
        do {
          if (sub.type.name === 'FunctionDeclaration') { fnNode = sub.node; break }
        } while (sub.nextSibling())
      }
      exported = true
    } else if (c.type.name === 'FunctionDeclaration') {
      fnNode = c.node
    }
    if (!fnNode) continue
    const nameNode = functionNameNode(fnNode)
    if (!nameNode) continue
    out.push({ nameNode, exported, node: fnNode, from: fnNode.from, to: fnNode.to })
  } while (c.nextSibling())
  return out
}

// The VariableDefinition child of a FunctionDeclaration (the declared name).
export function functionNameNode(fnNode) {
  const c = fnNode.cursor()
  if (!c.firstChild()) return null
  do {
    if (c.type.name === 'VariableDefinition') return { from: c.from, to: c.to, node: c.node }
  } while (c.nextSibling())
  return null
}

export function nodeText(source, node) {
  return source.slice(node.from, node.to)
}

// The Block node of a function declaration, or null.
export function functionBody(fnNode) {
  const c = fnNode.cursor()
  if (!c.firstChild()) return null
  do {
    if (c.type.name === 'Block') return { from: c.from, to: c.to, node: c.node }
  } while (c.nextSibling())
  return null
}

// The callee name text for a CallExpression, or null if the callee isn't a
// bare identifier (e.g. member expression, computed call).
export function calleeName(source, callNode) {
  const c = callNode.cursor()
  if (!c.firstChild()) return null
  // First child is the callee; ArgList is the second.
  if (c.type.name === 'VariableName') return source.slice(c.from, c.to)
  return null
}
