// Static analysis for Pixelblaze pattern source. Mirrors the checks in the
// canonical validator at pb/pattern_maker/validate.py, plus structural checks
// the emulator is uniquely positioned to surface:
//   - no render function at all (pattern will show nothing)
//   - lifecycle function declared without `export` (emulator accepts it; real
//     hardware ignores non-exported lifecycle hooks)
//   - array() / array-literal in render* (GC/heap churn, real hardware leaks)
//   - time() in render* (should be cached in beforeRender)
//   - nested function in render* (PB has no closures on hardware)
//   - expensive math in render* (perlin/perlinFbm/atan2/log/log2/sqrt/sin/cos/tan)
//
// Implementation note: this module walks a Lezer JS syntax tree rather than
// running regexes over the source — findings carry precise {line, col, endLine,
// endCol} so the editor can paint them inline. See src/vm/ast.js.

import {
  parsePattern,
  rangeFromNode,
  walk,
  descendants,
  topLevelFunctions,
  functionNameNode,
  functionBody,
  calleeName,
  nodeText,
} from './ast.js'
import { analyze } from './symbols.js'
import { BUILTIN_CATALOG } from './builtins.catalog.js'

const RENDER_FUNCS = new Set(['render', 'render2D', 'render3D'])
const LIFECYCLE_FUNCS = new Set(['beforeRender', 'render', 'render2D', 'render3D'])
const EXPENSIVE_OPS = new Set(['perlin', 'perlinFbm', 'atan2', 'log', 'log2', 'sqrt', 'sin', 'cos', 'tan'])

// `export function sliderX()` / `toggleX()` / etc. are user-defined UI control
// callbacks. We don't want to flag them as unused just because the pattern
// itself never calls them — the runtime invokes them when the widget changes.
const CONTROL_PREFIXES = ['hsvPicker', 'rgbPicker', 'slider', 'toggle', 'trigger', 'inputNumber', 'showNumber', 'gauge']
function looksLikeControl(name) {
  for (const p of CONTROL_PREFIXES) {
    if (name.startsWith(p) && name.length > p.length) {
      const next = name[p.length]
      if (next === next.toUpperCase() && next !== next.toLowerCase()) return true
    }
  }
  return false
}

export function lintPattern(source) {
  const findings = []
  const tree = parsePattern(source)
  const fns = topLevelFunctions(tree)
  const byName = new Map()
  for (const f of fns) byName.set(nodeText(source, f.nameNode), f)
  const sym = analyze(tree, source)

  // --- Structural checks ---

  // At least one render* must exist or nothing will draw. selectRenderFnInfo
  // throws 'pattern has no render function' downstream; surfacing it here gives
  // actionable guidance before the runtime trip. File-scoped finding — no span.
  const hasRender = [...RENDER_FUNCS].some(n => byName.has(n))
  if (!hasRender) {
    findings.push({
      severity: 'error',
      message: 'No render function defined — add render(index), render2D(index, x, y), or render3D(index, x, y, z).',
      line: 1, col: 1, endLine: 1, endCol: 1,
    })
  }

  // Lifecycle hooks should be exported. The emulator's sandbox collects both
  // `function foo()` and `export function foo()`, so bare forms "work" here,
  // but on real hardware only `export function <name>` is wired up.
  for (const name of LIFECYCLE_FUNCS) {
    const f = byName.get(name)
    if (f && !f.exported) {
      findings.push({
        severity: 'warn',
        message: `${name}() declared without 'export' — hardware will ignore it; prefix with 'export function ${name}(...)'.`,
        ...rangeFromNode(source, f.nameNode.from, f.nameNode.to),
      })
    }
  }

  // --- Body checks on render* bodies ---
  for (const name of RENDER_FUNCS) {
    const f = byName.get(name)
    if (!f) continue
    const body = functionBody(f.node)
    if (!body) continue

    // Collect what we care about in one walk.
    const arrayLiterals = []
    const arrayCalls = []
    const timeCalls = []
    const expensiveCalls = []
    const nestedFns = []
    walk(body.node, (n) => {
      if (n.name === 'FunctionDeclaration' || n.name === 'FunctionExpression' || n.name === 'ArrowFunction') {
        // Record and stop descent — nested functions are a leaf for these rules.
        if (n.name === 'FunctionDeclaration') {
          const nn = functionNameNode(n.node)
          nestedFns.push({ name: nn ? nodeText(source, nn) : '(anonymous)', from: n.from, to: n.to })
        }
        return false
      }
      if (n.name === 'VariableDeclaration') {
        // Flag `var x = [...]` as an array literal allocation.
        const c = n.node.cursor()
        if (c.firstChild()) {
          do {
            if (c.type.name === 'ArrayExpression') {
              arrayLiterals.push({ from: c.from, to: c.to })
            }
          } while (c.nextSibling())
        }
      }
      if (n.name === 'CallExpression') {
        const callee = calleeName(source, n.node)
        if (!callee) return
        if (callee === 'array') arrayCalls.push({ from: n.from, to: n.to })
        else if (callee === 'time') timeCalls.push({ from: n.from, to: n.to })
        else if (EXPENSIVE_OPS.has(callee)) expensiveCalls.push({ callee, from: n.from, to: n.to })
      }
    })

    for (const a of arrayCalls) {
      findings.push({
        severity: 'error',
        message: `array() allocation in ${name}() — will leak memory on hardware`,
        ...rangeFromNode(source, a.from, a.to),
      })
    }
    for (const a of arrayLiterals) {
      findings.push({
        severity: 'error',
        message: `Array literal in ${name}() — will leak memory on hardware`,
        ...rangeFromNode(source, a.from, a.to),
      })
    }
    for (const t of timeCalls) {
      findings.push({
        severity: 'error',
        message: `time() called in ${name}() — move to beforeRender()`,
        ...rangeFromNode(source, t.from, t.to),
      })
    }
    for (const fn of nestedFns) {
      findings.push({
        severity: 'error',
        message: `Nested function definition in ${name}() — no closures on hardware`,
        ...rangeFromNode(source, fn.from, fn.to),
      })
    }
    // Deduplicate expensive-op warnings per callee — one hit per function is plenty.
    const seenExp = new Set()
    for (const e of expensiveCalls) {
      if (seenExp.has(e.callee)) continue
      seenExp.add(e.callee)
      findings.push({
        severity: 'warn',
        message: `${e.callee}() in ${name}() — consider caching in beforeRender()`,
        ...rangeFromNode(source, e.from, e.to),
      })
    }
  }

  // --- Semantic checks (powered by the scope/symbol pass) ---

  // Undefined identifier reads. We dedupe by (name, from) so the same token
  // isn't reported twice; different occurrences of the same typo get one
  // finding each.
  for (const u of sym.unresolved) {
    findings.push({
      severity: 'error',
      message: `Undefined identifier '${u.name}'${suggestionFor(u.name)}`,
      ...rangeFromNode(source, u.from, u.to),
    })
  }

  // Writes to read-only builtins (PI = 3, HIGH = 5, etc.).
  for (const w of sym.constWrites) {
    findings.push({
      severity: 'error',
      message: `Cannot assign to built-in ${w.builtinKind} '${w.name}'`,
      ...rangeFromNode(source, w.from, w.to),
    })
  }

  // Shadowing a built-in (var sin = 0). Hardware will see the user's binding;
  // anywhere that relied on the built-in name suddenly breaks.
  for (const s of sym.shadows) {
    findings.push({
      severity: 'warn',
      message: `Declaration shadows built-in '${s.name}'`,
      ...rangeFromNode(source, s.from, s.to),
    })
  }

  // Unused locals. For function-scope declarations only — unused file-scope
  // names are often intentional module-level state used elsewhere, and
  // implicit globals never get a position anyway.
  for (const u of sym.unused) {
    if (u.scope.kind === 'file') continue
    if (u.from < 0) continue
    findings.push({
      severity: 'warn',
      message: `Unused ${u.kind === 'param' ? 'parameter' : 'local'} '${u.name}'`,
      ...rangeFromNode(source, u.from, u.to),
    })
  }

  // Unused top-level functions (non-exported, non-lifecycle, non-control).
  for (const [name, decl] of sym.root.declarations) {
    if (decl.kind !== 'function') continue
    if (decl.readCount > 0) continue
    if (LIFECYCLE_FUNCS.has(name)) continue
    const info = byName.get(name)
    if (info?.exported) continue         // exported funcs are presumed entry points
    if (looksLikeControl(name)) continue // runtime-invoked callbacks
    findings.push({
      severity: 'warn',
      message: `Unused function '${name}'`,
      ...rangeFromNode(source, decl.from, decl.to),
    })
  }

  // Arity mismatch on built-in calls. Walk the whole tree for CallExpressions
  // whose callee is a known built-in function.
  for (const call of descendants(tree.topNode, ['CallExpression'])) {
    const callee = calleeName(source, call.node)
    if (!callee) continue
    const meta = BUILTIN_CATALOG[callee]
    if (!meta || meta.kind !== 'function') continue
    const args = countArgs(call.node)
    const [min, max] = meta.arity
    if (args < min) {
      findings.push({
        severity: 'warn',
        message: `Call to built-in '${callee}' has ${args} argument${args === 1 ? '' : 's'} but needs at least ${min}`,
        ...rangeFromNode(source, call.from, call.to),
      })
    } else if (args > max) {
      findings.push({
        severity: 'error',
        message: `Call to built-in '${callee}' has ${args} arguments but accepts at most ${max}`,
        ...rangeFromNode(source, call.from, call.to),
      })
    }
  }

  return findings
}

// Find the ArgList child of a CallExpression and count its top-level arguments
// (children that aren't the parens or commas).
function countArgs(callNode) {
  const c = callNode.cursor()
  if (!c.firstChild()) return 0
  let args = 0
  let argList = null
  do {
    if (c.type.name === 'ArgList') { argList = c.node; break }
  } while (c.nextSibling())
  if (!argList) return 0
  const sub = argList.cursor()
  if (!sub.firstChild()) return 0
  do {
    const n = sub.type.name
    if (n === '(' || n === ')' || n === ',') continue
    args++
  } while (sub.nextSibling())
  return args
}

// Cheap Levenshtein-based "did you mean?" for a handful of builtin names.
// Only fires when the distance is ≤ 2 and the match is uniquely closest.
function suggestionFor(name) {
  let best = null
  let bestD = Infinity
  let tie = false
  for (const candidate of Object.keys(BUILTIN_CATALOG)) {
    const d = levenshtein(name, candidate)
    if (d < bestD) { bestD = d; best = candidate; tie = false }
    else if (d === bestD) { tie = true }
  }
  if (best && bestD <= 2 && !tie) return ` (did you mean '${best}'?)`
  return ''
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = new Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) dp[j] = prev
      else dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[n]
}
