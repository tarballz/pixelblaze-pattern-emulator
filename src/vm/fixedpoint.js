// Opt-in Q16.16 fixed-point bitwise semantics.
//
// Hardware numbers are 16.16 fixed point, and bitwise operators act on the raw
// 32-bit word — so `x >> 16` moves the integer part into the fraction, and
// patterns (e.g. slime_mold.js) pack two 16-bit indices per cell that way.
// JS bitwise ops instead truncate float64 to int32, silently discarding the
// fraction. Every Q16.16 value IS exactly representable in float64, so the only
// correction needed for this pattern class is routing the 7 bitwise operators
// through raw-word helpers; ordinary arithmetic stays native float64.
//
// transformBitwiseOps() rewrites `A << B` → `__pbshl(A, B)` etc. using the
// Lezer tree (so strings/comments are naturally skipped). All splices are
// newline-free, preserving line numbers for PATTERN_LINE_OFFSET error mapping.
//
// Enable per-pattern with a `// @fixedpoint` pragma, or force via the UI
// option (see prepareSource in sandbox.js).

import { parsePattern, offsetToLineCol } from './ast.js'

const BINARY_OPS = {
  '<<': '__pbshl', '>>': '__pbshr', '>>>': '__pbshru',
  '&': '__pband', '|': '__pbor', '^': '__pbxor'
}
const ASSIGN_OPS = {
  '<<=': '__pbshl', '>>=': '__pbshr', '>>>=': '__pbshru',
  '&=': '__pband', '|=': '__pbor', '^=': '__pbxor'
}

export function hasFixedPointPragma(source) {
  return /\/\/\s*@fixedpoint\b/i.test(source)
}

// Find the operator token among a node's direct children by exact text match.
// Operand expressions can never textually equal a bare operator, so this is
// robust against Lezer token-name changes across versions.
function findOpToken(node, source, opTable) {
  const c = node.cursor()
  if (!c.firstChild()) return null
  do {
    if (c.type.isError) continue
    const t = source.slice(c.from, c.to)
    if (opTable[t] !== undefined) return { text: t, from: c.from, to: c.to }
  } while (c.nextSibling())
  return null
}

// First child of a node (the LHS of an assignment / operand of a unary).
function firstChild(node) {
  const c = node.cursor()
  if (!c.firstChild()) return null
  return { name: c.type.name, from: c.from, to: c.to }
}

export function transformBitwiseOps(source) {
  const tree = parsePattern(source)
  // Edit ops in ORIGINAL coordinates, applied right-to-left.
  // kind: 0 = replace [from,to)→text, 1 = close-paren insert, 2 = open insert.
  const ops = []

  const cursor = tree.cursor()
  do {
    if (cursor.type.isError) continue
    const name = cursor.type.name
    if (name === 'BinaryExpression') {
      const node = cursor.node
      const op = findOpToken(node, source, BINARY_OPS)
      if (op) {
        ops.push({ pos: node.from, kind: 2, text: `${BINARY_OPS[op.text]}(`, nodeFrom: node.from, nodeTo: node.to })
        ops.push({ pos: op.from, kind: 0, from: op.from, to: op.to, text: ',', nodeFrom: node.from, nodeTo: node.to })
        ops.push({ pos: node.to, kind: 1, text: ')', nodeFrom: node.from, nodeTo: node.to })
      }
    } else if (name === 'UnaryExpression') {
      const node = cursor.node
      const op = findOpToken(node, source, { '~': '__pbnot' })
      if (op) {
        ops.push({ pos: node.from, kind: 2, text: '__pbnot(', nodeFrom: node.from, nodeTo: node.to })
        ops.push({ pos: op.from, kind: 0, from: op.from, to: op.to, text: '', nodeFrom: node.from, nodeTo: node.to })
        ops.push({ pos: node.to, kind: 1, text: ')', nodeFrom: node.from, nodeTo: node.to })
      }
    } else if (name === 'AssignmentExpression') {
      const node = cursor.node
      const op = findOpToken(node, source, ASSIGN_OPS)
      if (op) {
        const lhs = firstChild(node)
        if (!lhs || lhs.name !== 'VariableName') {
          const { line } = offsetToLineCol(source, node.from)
          throw new Error(
            `fixed-point mode: compound bitwise assignment to a non-variable target ` +
            `is not supported (line ${line}) — rewrite as \`x = x ${op.text.slice(0, -1)} ...\``
          )
        }
        const lhsText = source.slice(lhs.from, lhs.to)
        // `x <<= n` → `x = __pbshl(x, n)`
        ops.push({ pos: op.from, kind: 0, from: op.from, to: op.to, text: `= ${ASSIGN_OPS[op.text]}(${lhsText},`, nodeFrom: node.from, nodeTo: node.to })
        ops.push({ pos: node.to, kind: 1, text: ')', nodeFrom: node.from, nodeTo: node.to })
      }
    }
  } while (cursor.next())

  if (!ops.length) return source

  // Application order (array order after sort): highest position first so
  // earlier offsets stay valid. Ties at one position: replaces before inserts
  // (an insert at p would shift a replace's [p,to) range); close-paren inserts
  // outer-node-first (later-applied text lands leftmost, so the inner `)` ends
  // up left of the outer one); open inserts inner-node-first (so the outer
  // call name ends up leftmost). Verified by nesting tests.
  ops.sort((a, b) => {
    if (a.pos !== b.pos) return b.pos - a.pos
    if (a.kind !== b.kind) return a.kind - b.kind
    if (a.kind === 1) return a.nodeFrom - b.nodeFrom
    if (a.kind === 2) return a.nodeTo - b.nodeTo
    return 0
  })

  let out = source
  for (const op of ops) {
    if (op.kind === 0) out = out.slice(0, op.from) + op.text + out.slice(op.to)
    else out = out.slice(0, op.pos) + op.text + out.slice(op.pos)
  }
  return out
}
