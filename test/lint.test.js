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
})
