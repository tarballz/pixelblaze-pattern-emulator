// Scope + symbol analysis for Pixelblaze pattern source.
//
// Walks the Lezer JS tree from src/vm/ast.js and builds a simple scope tree:
//   - file scope (the root Script)
//   - function scope per FunctionDeclaration / FunctionExpression / ArrowFunction
//
// Block scope for let/const is intentionally not modeled — PB patterns rarely
// use it, and var semantics (the common case) hoist to the nearest function.
// This matches the sandbox's non-strict eval.
//
// For each scope we record:
//   - declarations: Map<name, { kind, from, to }>
//   - references:   Array<{ name, from, to, kind: 'read' | 'write' | 'rw', scope }>
//
// References are resolved against the scope chain + the builtin catalog.
// Unresolved reads become the basis for the "undefined identifier" rule; reads
// against a declaration with zero usages flag "unused local"; writes to a
// builtin that isn't a sensor-global flag "assignment to constant"; and
// declarations whose names collide with a builtin flag "shadow built-in".

import { BUILTIN_CATALOG, BUILTIN_NAMES, isWritable } from './builtins.catalog.js'

function newScope(kind, parent, fnNode, fnKind) {
  const s = { kind, parent, fnNode, fnKind, declarations: new Map(), references: [], children: [] }
  if (parent) parent.children.push(s)
  return s
}

function declare(scope, name, kind, from, to) {
  // First declaration wins (JS also allows re-declaration of var; we don't
  // flag it here — the parser accepts it and we don't care for lint purposes).
  if (!scope.declarations.has(name)) {
    scope.declarations.set(name, { name, kind, from, to, readCount: 0, writeCount: 0 })
  }
}

function reference(scope, name, from, to, refKind) {
  scope.references.push({ name, from, to, kind: refKind, scope })
}

// Pre-scan: collect ranges of VariableName nodes that are targets of an
// assignment (LHS of `=`/`+=`/etc.). We use this during the main walk to
// decide read vs write. Keyed by `from` (uniquely identifies the node).
function collectAssignmentTargets(rootNode) {
  const pureWrites = new Set()   // LHS of plain `=`
  const compoundWrites = new Set() // LHS of `+=`/`-=`/etc. (counts as both read and write)
  const c = rootNode.cursor()
  function visit() {
    if (c.type.isError) return
    if (c.type.name === 'AssignmentExpression') {
      // First child = LHS, second child = operator, third = RHS.
      const sub = c.node.cursor()
      if (sub.firstChild()) {
        const lhsName = sub.type.name === 'VariableName' ? sub.from : -1
        const lhsFrom = sub.from, lhsTo = sub.to
        if (sub.nextSibling()) {
          const op = sub.type.name
          if (lhsName >= 0) {
            if (op === 'Equals') pureWrites.add(lhsFrom)
            else if (op === 'UpdateOp') compoundWrites.add(lhsFrom)
          }
        }
      }
    }
    // Postfix `x++` / `x--` read-and-write their operand. Prefix `++x` / `--x`
    // lives under UnaryExpression (Lezer doesn't distinguish it from `-x`, so
    // we confirm by looking for ++/-- text on an ArithOp sibling).
    if (c.type.name === 'PostfixExpression') {
      const sub = c.node.cursor()
      if (sub.firstChild()) {
        do {
          if (sub.type.name === 'VariableName') compoundWrites.add(sub.from)
        } while (sub.nextSibling())
      }
    }
    if (c.firstChild()) {
      do visit(); while (c.nextSibling())
      c.parent()
    }
  }
  visit()
  return { pureWrites, compoundWrites }
}

function writeKindFor(from, writes) {
  if (writes.pureWrites.has(from)) return 'write'
  if (writes.compoundWrites.has(from)) return 'rw'
  return 'read'
}

// Collect ParamList VariableDefinitions into a list of {name, from, to}.
function collectParams(fnNode, source) {
  const out = []
  const c = fnNode.cursor()
  if (!c.firstChild()) return out
  do {
    if (c.type.name === 'ParamList') {
      const sub = c.node.cursor()
      if (sub.firstChild()) {
        do {
          if (sub.type.name === 'VariableDefinition') {
            out.push({ name: source.slice(sub.from, sub.to), from: sub.from, to: sub.to })
          }
        } while (sub.nextSibling())
      }
      break
    }
  } while (c.nextSibling())
  return out
}

function functionNameOf(fnNode, source) {
  const c = fnNode.cursor()
  if (!c.firstChild()) return null
  do {
    if (c.type.name === 'VariableDefinition') {
      return { name: source.slice(c.from, c.to), from: c.from, to: c.to }
    }
  } while (c.nextSibling())
  return null
}

export function analyze(tree, source) {
  const root = newScope('file', null, null)
  const writes = collectAssignmentTargets(tree.topNode)

  // Two passes are convenient: first collect declarations (so forward
  // references within the same scope resolve), then collect references.
  // We fold both into a single recursive walk that enters function scopes
  // on the way down.
  walkScope(tree.topNode, root, source, writes)

  // Pass 2: names assigned without declaration anywhere in the tree are
  // implicit globals on PB hardware. Promote them into file-scope
  // declarations so references resolve and they aren't flagged as undefined.
  const implicitGlobals = []
  const seen = new Set()
  collectImplicitGlobals(root, root, seen, implicitGlobals)
  for (const name of implicitGlobals) {
    if (!root.declarations.has(name)) {
      root.declarations.set(name, { name, kind: 'implicit', from: -1, to: -1, readCount: 0, writeCount: 0 })
    }
  }

  // Resolve references and tally read/write counts on declarations.
  const unresolved = []     // { name, from, to, kind } — reads / rw that don't resolve
  const constWrites = []    // writes to read-only builtins
  resolveAll(root, unresolved, constWrites)

  // Shadows: any declaration whose name collides with a builtin.
  const shadows = collectShadows(root)

  // Unused: declarations (in any scope) with 0 references resolving to them.
  const unused = collectUnused(root)

  return { root, unresolved, unused, shadows, constWrites, implicitGlobals }
}

function collectImplicitGlobals(scope, rootScope, seen, out) {
  for (const ref of scope.references) {
    // Only pure writes (`h = 0`) create implicit globals. Compound assignments
    // (`h += 1`, `h++`) imply the user believed `h` already existed — if it
    // doesn't resolve, that's almost always a typo and should surface as an
    // undefined reference, not be silently promoted.
    if (ref.kind !== 'write') continue
    if (BUILTIN_NAMES.has(ref.name)) continue
    if (lookup(scope, ref.name)) continue
    if (seen.has(ref.name)) continue
    seen.add(ref.name)
    out.push(ref.name)
  }
  for (const c of scope.children) collectImplicitGlobals(c, rootScope, seen, out)
}

function walkScope(node, scope, source, writes) {
  const c = node.cursor()
  if (!c.firstChild()) return
  do visit(c, scope, source, writes); while (c.nextSibling())
}

function visit(c, scope, source, writes) {
  if (c.type.isError) return
  const name = c.type.name

  if (name === 'FunctionDeclaration') {
    // The declared function name lives in the outer scope.
    const fnName = functionNameOf(c.node, source)
    if (fnName) declare(scope, fnName.name, 'function', fnName.from, fnName.to)
    // New function scope; params + body live inside.
    const fnScope = newScope('function', scope, c.node, 'FunctionDeclaration')
    for (const p of collectParams(c.node, source)) declare(fnScope, p.name, 'param', p.from, p.to)
    const body = findChild(c.node, 'Block')
    if (body) walkScope(body, fnScope, source, writes)
    return
  }
  if (name === 'FunctionExpression' || name === 'ArrowFunction') {
    const fnScope = newScope('function', scope, c.node, name)
    for (const p of collectParams(c.node, source)) declare(fnScope, p.name, 'param', p.from, p.to)
    // Body can be a Block OR a bare expression (arrow with no braces). Walk
    // every child that isn't the ParamList / keyword / Arrow / VariableDefinition.
    const sub = c.node.cursor()
    if (sub.firstChild()) {
      do {
        const sn = sub.type.name
        if (sn === 'ParamList' || sn === 'function' || sn === 'Arrow' || sn === 'VariableDefinition') continue
        visit(sub, fnScope, source, writes)
      } while (sub.nextSibling())
    }
    return
  }
  if (name === 'VariableDeclaration') {
    // Walk the declaration list: each VariableDefinition is a declaration,
    // and any other children (initializers) are references at current scope.
    const kind = declKind(c.node, source)
    const sub = c.node.cursor()
    if (sub.firstChild()) {
      do {
        const sn = sub.type.name
        if (sn === 'VariableDefinition') {
          declare(scope, source.slice(sub.from, sub.to), kind, sub.from, sub.to)
        } else if (sn === 'var' || sn === 'let' || sn === 'const' || sn === 'Equals' || sn === ',' || sn === ';') {
          // ignore keyword/punctuation
        } else {
          visit(sub, scope, source, writes)
        }
      } while (sub.nextSibling())
    }
    return
  }
  if (name === 'VariableName') {
    const refKind = writeKindFor(c.from, writes)
    reference(scope, source.slice(c.from, c.to), c.from, c.to, refKind)
    return
  }
  // MemberExpression: `a.b` → walk the object (could be a VariableName) but
  // NEVER treat `.b` (PropertyName) as an identifier reference. Lezer emits
  // PropertyName for the property side — we just skip those.
  if (name === 'PropertyName') return

  // Default: descend.
  if (c.firstChild()) {
    do visit(c, scope, source, writes); while (c.nextSibling())
    c.parent()
  }
}

function declKind(node, source) {
  const c = node.cursor()
  if (!c.firstChild()) return 'var'
  const t = c.type.name
  if (t === 'var') return 'var'
  if (t === 'let') return 'let'
  if (t === 'const') return 'const'
  return 'var'
}

function findChild(node, name) {
  const c = node.cursor()
  if (!c.firstChild()) return null
  do { if (c.type.name === name) return c.node } while (c.nextSibling())
  return null
}

// Walk scope tree, resolving each reference. A resolve "hit" bumps the target
// declaration's read/write counter so unused detection is trivial later.
function resolveAll(scope, unresolved, constWrites) {
  for (const ref of scope.references) {
    const found = lookup(scope, ref.name)
    if (found) {
      if (ref.kind === 'read') found.readCount++
      else if (ref.kind === 'write') found.writeCount++
      else if (ref.kind === 'rw') { found.readCount++; found.writeCount++ }
    } else {
      const builtin = BUILTIN_CATALOG[ref.name]
      if (builtin) {
        if ((ref.kind === 'write' || ref.kind === 'rw') && !isWritable(ref.name)) {
          constWrites.push({ name: ref.name, from: ref.from, to: ref.to, builtinKind: builtin.kind })
        }
        // builtin references don't need declarations; move on.
      } else {
        if (ref.kind !== 'write') {
          unresolved.push({ name: ref.name, from: ref.from, to: ref.to, kind: ref.kind })
        }
        // Pure writes to undeclared names create implicit globals — legal on PB.
      }
    }
  }
  for (const child of scope.children) resolveAll(child, unresolved, constWrites)
}

// Scope-chain lookup. Returns the declaration record or null.
function lookup(scope, name) {
  let s = scope
  while (s) {
    const d = s.declarations.get(name)
    if (d) return d
    s = s.parent
  }
  return null
}

function collectShadows(scope) {
  const out = []
  function recur(s) {
    for (const [name, d] of s.declarations) {
      if (BUILTIN_NAMES.has(name)) out.push({ name, from: d.from, to: d.to, kind: d.kind })
    }
    for (const child of s.children) recur(child)
  }
  recur(scope)
  return out
}

// Lifecycle params like `delta`, `i`, `x`, `y`, `z` are conventional — skip.
const CONVENTIONAL_PARAMS = new Set(['delta', 'i', 'x', 'y', 'z', 'index'])

function collectUnused(rootScope) {
  const out = []
  function recur(s) {
    for (const [name, d] of s.declarations) {
      if (d.readCount > 0) continue
      if (d.kind === 'param') {
        if (CONVENTIONAL_PARAMS.has(name)) continue
        // Anonymous/arrow callback params are typically positional — `(v, i, a)
        // => ...` in arrayMutate etc. is idiomatic even when `a` is unused.
        if (s.fnKind === 'ArrowFunction' || s.fnKind === 'FunctionExpression') continue
      }
      out.push({ name, from: d.from, to: d.to, kind: d.kind, scope: s })
    }
    for (const child of s.children) recur(child)
  }
  recur(rootScope)
  return out
}
