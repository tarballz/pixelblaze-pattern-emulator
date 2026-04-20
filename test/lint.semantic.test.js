import { describe, it, expect } from 'vitest'
import { lintPattern } from '../src/vm/lint.js'

const RENDER = 'export function render(i) { hsv(0, 1, 1) }'

function find(src, pattern) {
  return lintPattern(src).find(f => pattern.test(f.message))
}

describe('semantic lint rules', () => {
  it('flags undefined identifiers with a position', () => {
    const src = `${RENDER}\nexport function beforeRender(d) { var h = perln(d, 0, 0, 0); hsv(h, 1, 1) }`
    const f = find(src, /Undefined identifier 'perln'/)
    expect(f).toBeTruthy()
    expect(f.severity).toBe('error')
    expect(f.line).toBe(2)
  })

  it('suggests a near match for typos', () => {
    const src = `${RENDER}\nexport function beforeRender(d) { hsx(0, 1, 1) }`
    const f = find(src, /Undefined identifier 'hsx'/)
    expect(f).toBeTruthy()
    expect(f.message).toMatch(/did you mean 'hsv'/)
  })

  it('does not flag pixelCount (runtime-injected global)', () => {
    const src = `export function render(i) { hsv(i / pixelCount, 1, 1) }`
    expect(lintPattern(src).some(f => /pixelCount/.test(f.message))).toBe(false)
  })

  it('flags a misspelled declaration even when the use site is only compound-assigned', () => {
    // User typo'd `var h = 0` as `var hh = 0`; the beforeRender hook still
    // does `h += delta`. Without this check, the rw would auto-promote `h` to
    // an implicit global and the undefined reference would be hidden.
    const src = `
      var hh = 0
      export function beforeRender(delta) { h += delta * 0.001 }
      export function render(i) { hsv(h, 1, 1) }
    `
    const f = find(src, /Undefined identifier 'h'/)
    expect(f).toBeTruthy()
  })

  it('does not flag implicit globals', () => {
    const src = `h = 0\nexport function render(i) { h = h + 0.01; hsv(h, 1, 1) }`
    expect(lintPattern(src).some(f => /Undefined identifier 'h'/.test(f.message))).toBe(false)
  })

  it('flags assignment to a read-only built-in', () => {
    const src = `${RENDER}\nexport function beforeRender(d) { PI = 3 }`
    const f = find(src, /Cannot assign to built-in/)
    expect(f).toBeTruthy()
    expect(f.message).toMatch(/'PI'/)
    expect(f.severity).toBe('error')
  })

  it('does not flag assignment to sensor globals', () => {
    const src = `${RENDER}\nexport function beforeRender(d) { light = 0.5 }`
    expect(lintPattern(src).some(f => /Cannot assign to built-in/.test(f.message))).toBe(false)
  })

  it('warns when a declaration shadows a built-in', () => {
    const src = `var sin = 0\n${RENDER}`
    const f = find(src, /shadows built-in 'sin'/)
    expect(f).toBeTruthy()
    expect(f.severity).toBe('warn')
  })

  it('warns about unused locals', () => {
    const src = `export function render(i) { var unused = 5; hsv(0, 1, 1) }`
    const f = find(src, /Unused local 'unused'/)
    expect(f).toBeTruthy()
    expect(f.severity).toBe('warn')
  })

  it('does not flag conventional render params (i, x, y, z) as unused', () => {
    const src = `export function render3D(i, x, y, z) { hsv(0, 1, 1) }`
    const findings = lintPattern(src).filter(f => /Unused/.test(f.message))
    expect(findings).toEqual([])
  })

  it('does not flag unused params of arrow callbacks', () => {
    const src = `
      var arr = array(4)
      export function beforeRender(delta) { arrayMutate(arr, (v, i, a) => v); delta }
      ${RENDER}
    `
    // Only `a` (arrow param) would have been flagged before the exemption.
    expect(lintPattern(src).some(f => /Unused parameter 'a'/.test(f.message))).toBe(false)
  })

  it('warns about unused non-exported top-level functions', () => {
    const src = `
      function helper() { return 1 }
      ${RENDER}
    `
    const f = find(src, /Unused function 'helper'/)
    expect(f).toBeTruthy()
  })

  it('does not flag exported functions or control callbacks as unused', () => {
    const src = `
      export function sliderBrightness(v) { }
      export function helper() { }
      ${RENDER}
    `
    expect(lintPattern(src).some(f => /Unused function/.test(f.message))).toBe(false)
  })

  it('flags under-arity on a built-in call', () => {
    const src = `export function render(i) { hsv(i) }`
    const f = find(src, /Call to built-in 'hsv'/)
    expect(f).toBeTruthy()
    expect(f.severity).toBe('warn')
    expect(f.message).toMatch(/1 argument/)
    expect(f.message).toMatch(/at least 3/)
  })

  it('flags over-arity on a built-in call', () => {
    // wave() takes exactly one argument.
    const src = `
      var t = 0
      export function beforeRender(d) { t += d * 0.001 }
      export function render(i) { hsv(wave(t, 0.5), 1, 1) }
    `
    const f = find(src, /Call to built-in 'wave'/)
    expect(f).toBeTruthy()
    expect(f.severity).toBe('error')
    expect(f.message).toMatch(/at most 1/)
  })

  it('tolerates variadic built-ins (max/min/hypot)', () => {
    const src = `export function render(i) { hsv(max(0.1, 0.2, 0.3, 0.4), 1, 1) }`
    expect(lintPattern(src).some(f => /Call to built-in 'max'/.test(f.message))).toBe(false)
  })

  it('does not flag calls to user-defined functions for arity', () => {
    const src = `
      function helper(a, b) { return a + b }
      export function render(i) { hsv(helper(1), 1, 1) }
    `
    expect(lintPattern(src).some(f => /Call to built-in/.test(f.message))).toBe(false)
  })
})
