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

export function loadPattern(source, env) {
  const body = prepareSource(source)
  const keys = Object.keys(env)
  const values = keys.map(k => env[k])
  const runner = new Function(...keys, body)
  return runner.apply(Object.create(null), values)
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

  // 2. Strip `export` keyword while keeping the declaration otherwise intact.
  const stripped = source.replace(/(^|\n|;)\s*export\s+/g, '$1')

  // 3. Build a return object of all collected function names, guarded with typeof.
  const entries = Array.from(names)
    .map(n => `${JSON.stringify(n)}: typeof ${n} !== 'undefined' ? ${n} : undefined`)
    .join(', ')

  // Non-strict body. Pixelblaze's language allows implicit globals
  // (e.g. `runTime = 0` without `var`, `for (i = 0; ...)`). Running strict
  // would reject idiomatic patterns like axial_flow.js. A Function body without
  // a "use strict" directive uses non-strict mode even when the enclosing
  // module is strict.
  return `${stripped}\n;return { ${entries} };`
}

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
