// Static analysis for Pixelblaze pattern source. Mirrors the checks in the
// canonical validator at pb/pattern_maker/validate.py:
//   - array() / array-literal in render* (GC/heap churn, real hardware leaks)
//   - time() in render* (should be cached in beforeRender)
//   - nested function in render* (PB has no closures on hardware)
//   - expensive math in render* (perlin/perlinFbm/atan2/log/log2/sqrt/sin/cos/tan)
//
// These are warnings only — the emulator runs all of them fine. The goal is to
// flag patterns that look correct in the preview but misbehave on hardware.

const RENDER_FUNCS = ['render', 'render2D', 'render3D']
const EXPENSIVE_OPS = ['perlin', 'perlinFbm', 'atan2', 'log', 'log2', 'sqrt', 'sin', 'cos', 'tan']

export function lintPattern(source) {
  const findings = []
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
