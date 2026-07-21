// Q16.16 fixed-point bitwise mode: the source transform and the raw-word ops,
// exercised with the exact idioms slime_mold.js relies on.

import { describe, it, expect } from 'vitest'
import { transformBitwiseOps, hasFixedPointPragma } from '../src/vm/fixedpoint.js'
import { createBuiltins } from '../src/vm/builtins.js'
import { loadPattern } from '../src/vm/sandbox.js'

function mkEnv() {
  const ctx = { now: () => 0, prngState: 1, transformStack: [], mapDim: 3 }
  const env = createBuiltins(ctx)
  env.pixelCount = 10
  return env
}

describe('fixedpoint: transformBitwiseOps', () => {
  it('rewrites simple binary ops', () => {
    expect(transformBitwiseOps('a << b')).toBe('__pbshl(a , b)')
    expect(transformBitwiseOps('a & b')).toBe('__pband(a , b)')
    expect(transformBitwiseOps('a >>> b')).toBe('__pbshru(a , b)')
  })

  it('handles precedence nesting (a << b & c) === ((a << b) & c)', () => {
    // << binds tighter than &
    expect(transformBitwiseOps('a << b & c')).toBe('__pband(__pbshl(a , b) , c)')
  })

  it('handles right-nesting (a & b << c)', () => {
    expect(transformBitwiseOps('a & b << c')).toBe('__pband(a , __pbshl(b , c))')
  })

  it('handles shared end offsets (a&b^c)', () => {
    expect(transformBitwiseOps('a&b^c')).toBe('__pbxor(__pband(a,b),c)')
  })

  it('handles unary ~ including under a shift', () => {
    expect(transformBitwiseOps('~a')).toBe('__pbnot(a)')
    expect(transformBitwiseOps('~a << b')).toBe('__pbshl(__pbnot(a) , b)')
  })

  it('rewrites compound assignment on a simple variable', () => {
    expect(transformBitwiseOps('x <<= n')).toBe('x = __pbshl(x, n)')
    expect(transformBitwiseOps('x &= 0xff')).toBe('x = __pband(x, 0xff)')
  })

  it('throws a line-numbered error on compound assignment to a complex target', () => {
    expect(() => transformBitwiseOps('var a = [1]\narr[i] |= 2')).toThrow(/line 2/)
  })

  it('leaves && and || and strings/comments alone', () => {
    const src = 'a && b || c; s = "x & y"; // z << 2\n'
    expect(transformBitwiseOps(src)).toBe(src)
  })

  it('never inserts newlines (preserves error-line mapping)', () => {
    const src = 'var a = 1 << 2\nvar b = a & 3\nvar c = ~b\n'
    const out = transformBitwiseOps(src)
    expect(out.split('\n').length).toBe(src.split('\n').length)
  })

  it('detects the pragma', () => {
    expect(hasFixedPointPragma('// @fixedpoint\nvar x')).toBe(true)
    expect(hasFixedPointPragma('//@FixedPoint tricks ahead')).toBe(true)
    expect(hasFixedPointPragma('var fixedpoint = 1')).toBe(false)
  })
})

describe('fixedpoint: raw-word op semantics (slime_mold idioms)', () => {
  const env = mkEnv()

  it('>> 16 moves the integer part into the fraction (0x7FFF >> 16)', () => {
    // Hardware: 32767 >> 16 leaves 0x7FFF in the fraction bits = 32767/65536.
    expect(env.__pbshr(0x7fff, 16)).toBeCloseTo(32767 / 65536, 10)
  })

  it('emptySlot sentinel round-trips: trunc/frac split then << 16 recovers', () => {
    const emptySlot = 0x7fff + env.__pbshr(0x7fff, 16)
    // trunc part = 32767; frac part << 16 recovers 32767.
    expect(Math.trunc(emptySlot)).toBe(0x7fff)
    const frac = emptySlot - Math.floor(emptySlot)
    expect(env.__pbshl(frac, 16)).toBe(0x7fff)
  })

  it('packs and unpacks two 16-bit indices per cell', () => {
    // slime_mold: cell = trunc(a) + (b >> 16); reads back b via frac(cell) << 16.
    const a = 12345, b = 641
    const cell = Math.trunc(a) + env.__pbshr(b, 16)
    expect(Math.trunc(cell)).toBe(a)
    expect(env.__pbshl(cell - Math.floor(cell), 16)).toBe(b)
  })

  it('& masks the raw word: random-ish value & 0x3f keeps low integer bits', () => {
    expect(env.__pband(99, 0x3f)).toBe(99 & 0x3f)
    // Fractional operand: 1.5 & 1 → raw 0x18000 & 0x10000 = 0x10000 → 1.0
    expect(env.__pband(1.5, 1)).toBe(1)
  })

  it('wraps at ±32768 like hardware instead of extending', () => {
    // 32767 << 2 overflows the Q16.16 range and wraps negative.
    const v = env.__pbshl(32767, 2)
    expect(v).toBeLessThan(0)
  })

  it('JS float bitwise (the thing we are fixing) would corrupt these', () => {
    // Sanity check the premise: plain JS >> on 0x7fff>>16 gives 0, losing data.
    expect(0x7fff >> 16).toBe(0)
    expect(env.__pbshr(0x7fff, 16)).not.toBe(0)
  })
})

describe('fixedpoint: end-to-end through loadPattern', () => {
  it('pragma enables the transform; pattern sees hardware semantics', () => {
    const src = `
      // @fixedpoint
      var packed = 0
      export function render(i) {
        packed = 700 + ((3 & 0xffff) >> 16)
        hsv(0, 0, 0)
      }
    `
    const env = mkEnv()
    const exports = loadPattern(src, env)
    expect(typeof exports.render).toBe('function')
    exports.render(0) // must not throw
  })

  it('without pragma or option, JS semantics are untouched', () => {
    const src = `
      var out = -1
      export function probe() { out = 0x7fff >> 16; return out }
      export function render(i) {}
    `
    const env = mkEnv()
    const exports = loadPattern(src, env)
    expect(exports.probe()).toBe(0) // plain JS int32 shift
  })

  it('explicit option forces the transform without a pragma', () => {
    const src = `
      export function probe() { return 0x7fff >> 16 }
      export function render(i) {}
    `
    const env = mkEnv()
    const exports = loadPattern(src, env, { fixedPoint: true })
    expect(exports.probe()).toBeCloseTo(32767 / 65536, 10)
  })
})
