// Load Pixelblaze pattern source into a sandboxed function scope.
//
// Strategy: Pixelblaze's language is a JS subset, so valid patterns are valid JS.
// We strip the `export` keyword (not valid in non-module function bodies),
// then evaluate the source as the body of a Function whose parameters ARE the
// Pixelblaze built-ins. Pattern-declared vars become local to the wrapper;
// pattern-declared functions close over them.
//
// Security note: loading a pattern evaluates user-supplied JS. That is the
// point of the emulator. Same-origin browser only, strict mode, empty `this`,
// no window/fetch/document handed into the scope. Trust model mirrors loading
// a user script in any web-based IDE.

// Lines prepended to the user's source before it hits the JS engine:
//   1. `function anonymous(...) {` header injected by `new Function` (V8 + SpiderMonkey both emit exactly one line).
//   2. The preamble line from prepareSource (always emitted, even when empty,
//      because we template `${preamble}\n${stripped}` — that leading \n makes
//      user line 1 become body line 2).
// Subtract this from any runtime-error stack line to map back to the user's source.
export const PATTERN_LINE_OFFSET = 2

export function loadPattern(source, env) {
  const body = prepareSource(source)
  const keys = Object.keys(env)
  const values = keys.map(k => env[k])
  let runner
  try {
    runner = new Function(...keys, body)
  } catch (err) {
    throw new Error(`Pattern failed to parse: ${err.message}\nFirst lines:\n${previewLines(source)}`)
  }
  return runner.apply(Object.create(null), values)
}

function previewLines(source, n = 5) {
  return String(source ?? '').split('\n').slice(0, n).map((l, i) => `  ${i + 1}: ${l}`).join('\n')
}

// Evaluate a Pixelblaze JS map function `function (pixelCount) { ... return map }`.
// Returns the produced array. Minimal env (just math constants) — mapper
// functions conventionally only reference Math.*.
export function evaluateMapperFunction(source, pixelCount, env = {}) {
  // Non-strict: Pixelblaze's canonical mapper example uses implicit globals
  // (`width = 8` without `var`). Match that permissiveness.
  const keys = Object.keys(env)
  const values = keys.map(k => env[k])
  const body = `return (${source.trim()})(__pixelCount__);`
  const runner = new Function(...keys, '__pixelCount__', body)
  return runner.apply(Object.create(null), [...values, pixelCount])
}

function prepareSource(source) {
  // 1. Collect top-level function names (declared and exported).
  const names = new Set()
  const fnDecl = /(^|\n|;)\s*(?:export\s+)?function\s+([A-Za-z_$][\w$]*)/g
  let m
  while ((m = fnDecl.exec(source)) !== null) names.add(m[2])

  // 2. Strip `export` keyword while preserving surrounding whitespace.
  // The earlier version (`\s*export\s+` → `$1`) swallowed newlines between
  // a preceding line-comment and `export function ...`, splicing the two
  // lines together so the comment ate the next declaration.
  let stripped = source.replace(/(^|\n|;)(\s*)export(\s+)/g, '$1$2$3')

  // 3. Initialize bare `var x;` / `var a, b, c;` declarations to 0.
  // PB firmware zero-initializes all fixed-point cells; JS leaves uninit vars
  // as `undefined`, which poisons arithmetic into NaN on first use.
  stripped = initBareVars(stripped)

  // 4. Pre-declare identifiers assigned without `var`/`let`/`const` so reads
  // before first write return 0.
  const implicitGlobals = findImplicitGlobals(stripped, names)
  const preamble = implicitGlobals.length
    ? `var ${implicitGlobals.map(n => `${n} = 0`).join(', ')};`
    : ''

  // 4. Build a return object of all collected function names, guarded with typeof.
  const entries = Array.from(names)
    .map(n => `${JSON.stringify(n)}: typeof ${n} !== 'undefined' ? ${n} : undefined`)
    .join(', ')

  // Non-strict body. Pixelblaze's language allows implicit globals
  // (e.g. `runTime = 0` without `var`, `for (i = 0; ...)`). Running strict
  // would reject idiomatic patterns like axial_flow.js. A Function body without
  // a "use strict" directive uses non-strict mode even when the enclosing
  // module is strict.
  return `${preamble}\n${stripped}\n;return { ${entries} };`
}

// Identifiers assigned via `name = ...` but never declared with
// var/let/const/function/function-parameter. These are treated as implicit
// globals on Pixelblaze hardware, pre-initialized to 0.
//
// Regex-based: acceptable here because the pattern surface is well-behaved
// JS. Skips property writes (`obj.x = ...` and `obj[x] = ...`), typed
// comparisons (`x === y`, `x == y`), and the LHS of for/while conditions.
function findImplicitGlobals(source, functionNames) {
  // Strip comments and string contents before scanning — otherwise we'd
  // pick up assignments from inside a `// foo = 1` comment or a string.
  source = stripCommentsAndStrings(source)
  const declared = new Set(functionNames)
  for (const [, name] of source.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) declared.add(name)
  // Catch multi-name var lists: `var a, b, c = 1` → capture b, c too.
  for (const m of source.matchAll(/\b(?:var|let|const)\s+([^;\n=]+?)(?==|;|\n|$)/g)) {
    for (const chunk of m[1].split(',')) {
      const n = chunk.trim().split(/\s/)[0]
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n)
    }
  }
  // Function parameters — `function foo(a, b, c)` and anonymous `function(a, b)`.
  for (const m of source.matchAll(/\bfunction\b[^(]*\(([^)]*)\)/g)) {
    for (const p of m[1].split(',')) {
      const n = p.trim().split(/\s*=\s*/)[0]
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n)
    }
  }
  // Arrow-function parameters — `(a, b) =>` and `a =>`.
  for (const m of source.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const p of m[1].split(',')) {
      const n = p.trim().split(/\s*=\s*/)[0]
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n)
    }
  }
  for (const m of source.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*=>/g)) {
    declared.add(m[1])
  }

  const assigned = new Set()
  // Match `name = ` where `name` is not preceded by `.` or `[` and the `=` is
  // not part of `==`/`===`/`!=`/`<=`/`>=`.
  const re = /(^|[^.\w$\]])([A-Za-z_$][\w$]*)\s*=(?![=>])/g
  let m
  while ((m = re.exec(source)) !== null) {
    assigned.add(m[2])
  }

  const out = []
  for (const n of assigned) {
    if (declared.has(n)) continue
    // Skip JS reserved words / globals we'd never want to shadow.
    if (RESERVED.has(n)) continue
    out.push(n)
  }
  return out
}

// Walk `var` / `let` declarations and append ` = 0` to any bare identifier
// (`var a, b = 1, c` → `var a = 0, b = 1, c = 0`). Operates on the source
// directly, splicing insertions in reverse order. Uses a comment/string-
// stripped mirror to locate positions without false-positives from
// `//var x` comments or `"var x"` strings.
function initBareVars(source) {
  const cleaned = stripCommentsAndStrings(source)
  const insertions = []
  const kwRe = /\b(var|let)\s+/g
  let m
  while ((m = kwRe.exec(cleaned)) !== null) {
    const listStart = m.index + m[0].length
    // Find end of declaration (semicolon or newline) at bracket depth 0.
    let end = listStart
    let depth = 0
    while (end < cleaned.length) {
      const c = cleaned[end]
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth-- }
      else if (depth === 0 && (c === ';' || c === '\n')) break
      end++
    }
    // Split declaration list by comma at bracket depth 0.
    const items = []
    let start = listStart
    let d = 0
    for (let k = listStart; k <= end; k++) {
      const c = cleaned[k]
      if (c === '(' || c === '[' || c === '{') d++
      else if (c === ')' || c === ']' || c === '}') d--
      else if (d === 0 && (c === ',' || k === end)) {
        items.push({ start, end: k })
        start = k + 1
      }
    }
    for (const item of items) {
      const text = cleaned.slice(item.start, item.end)
      // Has top-level `=` that isn't part of `==`/`===`/`!=`/`<=`/`>=`?
      let hasEq = false
      d = 0
      for (let k = 0; k < text.length; k++) {
        const c = text[k]
        if (c === '(' || c === '[' || c === '{') d++
        else if (c === ')' || c === ']' || c === '}') d--
        else if (d === 0 && c === '=') {
          const next = text[k + 1]
          const prev = text[k - 1]
          if (next !== '=' && prev !== '!' && prev !== '<' && prev !== '>' && prev !== '=') {
            hasEq = true
            break
          }
        }
      }
      if (hasEq) continue
      if (!/^[A-Za-z_$][\w$]*$/.test(text.trim())) continue
      insertions.push({ pos: item.end, text: ' = 0' })
    }
    kwRe.lastIndex = end
  }
  if (!insertions.length) return source
  insertions.sort((a, b) => b.pos - a.pos)
  let out = source
  for (const ins of insertions) {
    out = out.slice(0, ins.pos) + ins.text + out.slice(ins.pos)
  }
  return out
}

// Replace comment and string bodies with spaces (preserving structure) so a
// subsequent regex scan can't match code-looking content inside them. Not a
// full tokenizer — handles /* */, //, '…', "…", `…` well enough for PB patterns.
function stripCommentsAndStrings(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]
    if (c === '/' && c2 === '/') {
      out += '  '
      i += 2
      while (i < n && src[i] !== '\n') { out += ' '; i++ }
    } else if (c === '/' && c2 === '*') {
      out += '  '
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < n) { out += '  '; i += 2 }
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += ' '
      i++
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < n) { out += '  '; i += 2; continue }
        out += src[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < n) { out += ' '; i++ }
    } else {
      out += c
      i++
    }
  }
  return out
}

const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null',
  'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
  'undefined', 'var', 'void', 'while', 'with', 'yield', 'of'
])

export function classifyExports(exports) {
  const result = {
    beforeRender: exports.beforeRender,
    render: exports.render,
    render2D: exports.render2D,
    render3D: exports.render3D,
    controls: [],
    misc: []
  }
  const skip = new Set(['beforeRender', 'render', 'render2D', 'render3D'])
  for (const name of Object.keys(exports)) {
    if (skip.has(name)) continue
    const fn = exports[name]
    if (typeof fn !== 'function') continue
    const control = matchControl(name)
    if (control) result.controls.push({ ...control, fn })
    else result.misc.push({ name, fn })
  }
  return result
}

const CONTROL_PREFIXES = [
  ['hsvPicker',   'hsvPicker'],
  ['rgbPicker',   'rgbPicker'],
  ['slider',      'slider'],
  ['toggle',      'toggle'],
  ['trigger',     'trigger'],
  ['inputNumber', 'inputNumber'],
  ['showNumber',  'showNumber'],
  ['gauge',       'gauge']
]

function matchControl(name) {
  for (const [prefix, kind] of CONTROL_PREFIXES) {
    if (name.startsWith(prefix) && name.length > prefix.length) {
      const next = name[prefix.length]
      if (next === next.toUpperCase() && next !== next.toLowerCase()) {
        return { kind, name, label: name.slice(prefix.length) }
      }
    }
  }
  return null
}

export function applyControlDefaults(controls) {
  for (const c of controls) {
    try {
      switch (c.kind) {
        case 'slider':      c.fn(0.5); break
        case 'hsvPicker':   c.fn(0, 1, 1); break
        case 'rgbPicker':   c.fn(1, 1, 1); break
        case 'toggle':      c.fn(0); break
        case 'inputNumber': c.fn(0); break
      }
    } catch (err) {
      console.warn(`control ${c.name} threw on default invoke:`, err)
    }
  }
}
