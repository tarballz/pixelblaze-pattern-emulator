import { describe, it, expect } from 'vitest'
import { parsePattern } from '../src/vm/ast.js'
import { analyze } from '../src/vm/symbols.js'
import { BUILTIN_NAMES } from '../src/vm/builtins.catalog.js'
import { createBuiltins } from '../src/vm/builtins.js'

function run(source) {
  const tree = parsePattern(source)
  return analyze(tree, source)
}

function names(declMap) { return [...declMap.keys()].sort() }

describe('symbols.analyze', () => {
  it('records file-scope var / let / const declarations', () => {
    const r = run('var a = 1\nlet b = 2\nconst c = 3')
    expect(names(r.root.declarations)).toEqual(['a', 'b', 'c'])
    expect(r.root.declarations.get('a').kind).toBe('var')
    expect(r.root.declarations.get('b').kind).toBe('let')
    expect(r.root.declarations.get('c').kind).toBe('const')
  })

  it('records top-level function declarations and their params in a child scope', () => {
    const r = run('function foo(a, b) { var c = a + b; return c }')
    expect(r.root.declarations.has('foo')).toBe(true)
    const fn = r.root.children[0]
    expect(fn.kind).toBe('function')
    expect([...fn.declarations.keys()].sort()).toEqual(['a', 'b', 'c'])
  })

  it('resolves references up the scope chain', () => {
    const src = 'var h = 0\nfunction render(i) { hsv(h, 1, 1) }'
    const r = run(src)
    // `h` at file scope should have 1 read (from inside render).
    expect(r.root.declarations.get('h').readCount).toBe(1)
    // `i` is a param; referenced as an `index` would be unused — we don't use it here so it IS unused.
    expect(r.unresolved).toEqual([])
  })

  it('flags unresolved reads but not unresolved pure writes', () => {
    const r = run('function render(i) { undefinedThing = 1; hsv(notDefined, 1, 1) }')
    const undef = r.unresolved.map(u => u.name)
    expect(undef).toContain('notDefined')
    expect(undef).not.toContain('undefinedThing')   // write creates implicit global
    expect(undef).not.toContain('hsv')              // builtin
    expect(undef).not.toContain('i')                // param
  })

  it('treats compound assignment as both read and write', () => {
    const src = 'var h = 0\nfunction render(i) { h += 1; hsv(h, 1, 1) }'
    const r = run(src)
    const h = r.root.declarations.get('h')
    // Two reads (h += 1 reads h, hsv(h) reads h) + one write.
    expect(h.readCount).toBe(2)
    expect(h.writeCount).toBe(1)
  })

  it('ignores property names in member expressions', () => {
    // `.length` should not be treated as an identifier reference.
    const r = run('function render(i) { var a = array(4); hsv(a.length, 1, 1) }')
    expect(r.unresolved).toEqual([])
  })

  it('flags writes to read-only builtins', () => {
    const r = run('function render(i) { PI = 3.14; hsv(0, 1, 1) }')
    expect(r.constWrites.map(w => w.name)).toContain('PI')
  })

  it('does not flag writes to sensor globals', () => {
    const r = run('function beforeRender(delta) { accelerometer = 0 }')
    expect(r.constWrites.map(w => w.name)).not.toContain('accelerometer')
  })

  it('detects shadowed builtins', () => {
    const r = run('var sin = 0\nfunction render(i) { hsv(sin, 1, 1) }')
    expect(r.shadows.map(s => s.name)).toContain('sin')
  })

  it('finds unused locals', () => {
    const src = 'function render(i) { var unused = 5; hsv(0, 1, 1) }'
    const r = run(src)
    const unusedNames = r.unused.map(u => u.name)
    expect(unusedNames).toContain('unused')
  })

  it('does not flag conventional render params as unused', () => {
    const src = 'function render3D(i, x, y, z) { hsv(0, 1, 1) }'
    const r = run(src)
    const unusedNames = r.unused.map(u => u.name)
    // All four params are conventional and should be filtered out.
    expect(unusedNames).not.toContain('i')
    expect(unusedNames).not.toContain('x')
    expect(unusedNames).not.toContain('y')
    expect(unusedNames).not.toContain('z')
  })

  it('does NOT treat compound assignment on an undeclared name as an implicit global', () => {
    // `h +=` implies the user thinks `h` already exists. If it doesn't resolve,
    // that's a typo we want to surface — not silently promote to a global.
    const src = 'function beforeRender(delta) { h += delta }\nfunction render(i) { hsv(h, 1, 1) }'
    const r = run(src)
    const undef = r.unresolved.map(u => u.name)
    expect(undef).toContain('h')
  })

  it('treats an assignment without declaration at file scope as implicit global', () => {
    // `h = 0` at file scope is legal PB (implicit global). It's a pure write,
    // so it should NOT show up as unresolved.
    const src = 'h = 0\nfunction render(i) { h = h + 1; hsv(h, 1, 1) }'
    const r = run(src)
    const undef = r.unresolved.map(u => u.name)
    expect(undef).not.toContain('h')
  })

  it('handles nested functions with their own param scope', () => {
    const src = `
      function render(i) {
        function inner(a) { return a + i }
        hsv(inner(i), 1, 1)
      }
    `
    const r = run(src)
    expect(r.unresolved).toEqual([])
  })

  it('tolerates error recovery (partial input)', () => {
    const src = 'function render(i) { hsv(\n'
    const r = run(src)
    // Should not throw; tree is partial but walkable.
    expect(r.root).toBeTruthy()
  })

  it('catalog covers every runtime builtin (drift guard)', () => {
    const ctx = { now: () => 0, prngState: 1, transformStack: [], mapDim: 1 }
    const runtime = Object.keys(createBuiltins(ctx))
    const missing = runtime.filter(n => !BUILTIN_NAMES.has(n))
    expect(missing).toEqual([])
  })
})
