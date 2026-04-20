import { describe, it, expect } from 'vitest'
import { lintPattern } from '../src/vm/lint.js'

describe('lintPattern', () => {
  it('passes a clean pattern', () => {
    const src = `
      var h = 0
      export function beforeRender(delta) { h += delta * 0.001 }
      export function render3D(i, x, y, z) { hsv(h + x, 1, 1) }
    `
    expect(lintPattern(src)).toEqual([])
  })

  it('flags time() in render', () => {
    const src = `
      export function render(i) {
        var t = time(0.1)
        hsv(t, 1, 1)
      }
    `
    const findings = lintPattern(src)
    expect(findings.some(f => /time\(\)/.test(f.message) && f.severity === 'error')).toBe(true)
  })

  it('flags array() and array literal allocations in render', () => {
    const arrSrc = `export function render(i) { var a = array(4); hsv(i / 10, 1, 1) }`
    const findings1 = lintPattern(arrSrc)
    expect(findings1.some(f => /array\(\)/.test(f.message))).toBe(true)

    const litSrc = `export function render(i) { var a = [1, 2, 3]; hsv(i / 10, 1, 1) }`
    const findings2 = lintPattern(litSrc)
    expect(findings2.some(f => /[Aa]rray literal/.test(f.message))).toBe(true)
  })

  it('flags nested function in render', () => {
    const src = `
      export function render2D(i, x, y) {
        function helper() { return x + y }
        hsv(helper(), 1, 1)
      }
    `
    const findings = lintPattern(src)
    expect(findings.some(f => /[Nn]ested function/.test(f.message))).toBe(true)
  })

  it('warns about expensive ops in render', () => {
    const src = `
      export function render3D(i, x, y, z) {
        var v = perlin(x, y, z, 0) + atan2(y, x) + sqrt(x*x + y*y)
        hsv(v, 1, 1)
      }
    `
    const findings = lintPattern(src)
    const warns = findings.filter(f => f.severity === 'warn').map(f => f.message)
    expect(warns.some(m => /perlin\(\)/.test(m))).toBe(true)
    expect(warns.some(m => /atan2\(\)/.test(m))).toBe(true)
    expect(warns.some(m => /sqrt\(\)/.test(m))).toBe(true)
  })

  it('does not flag expensive ops outside render', () => {
    const src = `
      var cachedPerlin = 0
      export function beforeRender(delta) { cachedPerlin = perlin(1,2,3,0) }
      export function render(i) { hsv(cachedPerlin, 1, 1) }
    `
    const findings = lintPattern(src)
    expect(findings).toEqual([])
  })

  it('errors when no render function is defined', () => {
    const src = `
      var h = 0
      export function beforeRender(delta) { h += delta * 0.001 }
    `
    const findings = lintPattern(src)
    expect(findings.some(f => f.severity === 'error' && /No render function/.test(f.message))).toBe(true)
  })

  it('warns when render is declared without export', () => {
    const src = `
      function render(i) { hsv(i / 10, 1, 1) }
    `
    const findings = lintPattern(src)
    expect(findings.some(f => f.severity === 'warn' && /render\(\) declared without 'export'/.test(f.message))).toBe(true)
  })

  it('warns when beforeRender is declared without export', () => {
    const src = `
      var h = 0
      function beforeRender(delta) { h += delta * 0.001 }
      export function render(i) { hsv(h, 1, 1) }
    `
    const findings = lintPattern(src)
    expect(findings.some(f => f.severity === 'warn' && /beforeRender\(\) declared without 'export'/.test(f.message))).toBe(true)
  })

  it('does not warn when lifecycle hooks are properly exported', () => {
    const src = `
      var h = 0
      export function beforeRender(delta) { h += delta * 0.001 }
      export function render(i) { hsv(h, 1, 1) }
    `
    const findings = lintPattern(src)
    expect(findings.filter(f => /declared without 'export'/.test(f.message))).toEqual([])
  })

  it('emits 1-based line/col positions for body findings', () => {
    const src = [
      'export function render(i) {',    // line 1
      '  var t = time(0.1)',             // line 2, `time(` starts at col 11
      '  hsv(t, 1, 1)',                  // line 3
      '}'
    ].join('\n')
    const f = lintPattern(src).find(x => /time\(\)/.test(x.message))
    expect(f).toBeTruthy()
    expect(f.line).toBe(2)
    expect(f.col).toBe(11)
    expect(f.endLine).toBe(2)
    expect(typeof f.endCol).toBe('number')
  })

  it('positions a bare-lifecycle warning on the function name identifier', () => {
    const src = 'function render(i) { hsv(0, 1, 1) }'
    const f = lintPattern(src).find(x => /declared without 'export'/.test(x.message))
    expect(f).toBeTruthy()
    expect(f.line).toBe(1)
    expect(f.col).toBe(10)        // 'render' starts at column 10 (1-based)
    expect(f.endCol).toBe(16)
  })
})
