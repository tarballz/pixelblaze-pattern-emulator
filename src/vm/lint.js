// Static analysis for Pixelblaze pattern source. Mirrors the checks in the
// canonical validator at pb/pattern_maker/validate.py, plus a few structural
// checks the emulator is uniquely positioned to surface:
//   - no render function at all (pattern will show nothing)
//   - lifecycle function declared without `export` (emulator accepts it; real
//     hardware ignores non-exported lifecycle hooks)
//   - array() / array-literal in render* (GC/heap churn, real hardware leaks)
//   - time() in render* (should be cached in beforeRender)
//   - nested function in render* (PB has no closures on hardware)
//   - expensive math in render* (perlin/perlinFbm/atan2/log/log2/sqrt/sin/cos/tan)
//
// Most findings are warnings only — the emulator runs all of them fine. The
// goal is to flag patterns that look correct in the preview but misbehave on
// hardware, plus structural gaps that cause silent emulator failure.

const RENDER_FUNCS = ['render', 'render2D', 'render3D']
const LIFECYCLE_FUNCS = ['beforeRender', ...RENDER_FUNCS]
const EXPENSIVE_OPS = ['perlin', 'perlinFbm', 'atan2', 'log', 'log2', 'sqrt', 'sin', 'cos', 'tan']

export function lintPattern(source) {
  const findings = []

  // --- Structural checks ---

  // At least one render* must exist or nothing will draw. selectRenderFnInfo
  // throws 'pattern has no render function' downstream; surfacing it here as a
  // lint finding gives the user actionable guidance *before* the runtime trip.
  const presentRender = RENDER_FUNCS.filter(n => findFunctionDecl(source, n))
  if (presentRender.length === 0) {
    findings.push({
      severity: 'error',
      message: 'No render function defined — add render(index), render2D(index, x, y), or render3D(index, x, y, z).'
    })
  }

  // Lifecycle hooks should be exported. The emulator's sandbox collects both
  // `function foo()` and `export function foo()`, so bare forms "work" here,
  // but on real hardware only `export function <name>` is wired up.
  for (const name of LIFECYCLE_FUNCS) {
    const decl = findFunctionDecl(source, name)
    if (decl && !decl.exported) {
      findings.push({
        severity: 'warn',
        message: `${name}() declared without 'export' — hardware will ignore it; prefix with 'export function ${name}(...)'.`
      })
    }
  }

  // --- Body checks (existing) ---
  for (const name of RENDER_FUNCS) {
    const body = extractFunctionBody(source, name)
    if (body == null) continue

    if (/\barray\s*\(/.test(body)) {
      findings.push({ severity: 'error', message: `array() allocation in ${name}() — will leak memory on hardware` })
    }
    if (/(?:var|let|const)\s+\w+\s*=\s*\[/.test(body)) {
      findings.push({ severity: 'error', message: `Array literal in ${name}() — will leak memory on hardware` })
    }
    if (/\btime\s*\(/.test(body)) {
      findings.push({ severity: 'error', message: `time() called in ${name}() — move to beforeRender()` })
    }
    if (/\bfunction\s+\w+\s*\(/.test(body)) {
      findings.push({ severity: 'error', message: `Nested function definition in ${name}() — no closures on hardware` })
    }
    for (const op of EXPENSIVE_OPS) {
      const re = new RegExp(`\\b${op}\\s*\\(`)
      if (re.test(body)) {
        findings.push({ severity: 'warn', message: `${op}() in ${name}() — consider caching in beforeRender()` })
      }
    }
  }
  return findings
}

// Locate `function <name>(` or `export function <name>(` at a statement
// boundary (start of file, after newline, or after `;`). Returns
// `{ exported }` for the first hit, else null.
function findFunctionDecl(source, name) {
  const re = new RegExp(`(^|[\\n;])\\s*(export\\s+)?function\\s+${name}\\s*\\(`)
  const m = source.match(re)
  if (!m) return null
  return { exported: !!m[2] }
}

// Extract the body of `export function <name>(…) { … }` via balanced braces.
// Returns null if not found.
function extractFunctionBody(source, name) {
  const re = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`)
  const m = source.match(re)
  if (!m) return null
  const start = m.index + m[0].length - 1  // opening brace
  let depth = 0
  for (let i = start; i < source.length; i++) {
    const c = source[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return source.slice(start + 1, i)
    }
  }
  return null
}
