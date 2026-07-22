// Regression coverage for a real bug: `new Function(compilerSrc)()` followed
// by reading `compilePattern` from the outside silently returns undefined
// (no throw) because the real compiler blob declares it with `const`, which
// doesn't leak out of the function body. loadCompiler() must capture it from
// within the same scope instead. Verified live against the real compiler
// cache during development; these fixtures mirror its actual shape (a
// `const`-declared function, not a global assignment) without embedding any
// proprietary content.

import { describe, it, expect, afterEach } from 'vitest'
import { loadCompiler } from '../src/vm/compilerLoad.js'

describe('loadCompiler', () => {
  // A bare `compilePattern = ...` assignment (no declaration keyword, tested
  // below) legitimately creates a real global in sloppy mode — same
  // mechanism the real compiler blob relies on for `window = {}`. Clean it
  // up so it can't leak into a later, unrelated test.
  afterEach(() => {
    delete globalThis.compilePattern
  })

  it('captures a const-declared compilePattern (the real compiler blob\'s shape)', () => {
    const fn = loadCompiler('const compilePattern = (src) => ({ status: src === "ok" ? "OK" : "bad" })')
    expect(typeof fn).toBe('function')
    expect(fn('ok')).toEqual({ status: 'OK' })
    expect(fn('nope')).toEqual({ status: 'bad' })
  })

  it('also captures a var-declared or bare-assigned compilePattern', () => {
    expect(typeof loadCompiler('var compilePattern = () => ({ status: "OK" })')).toBe('function')
    expect(typeof loadCompiler('compilePattern = () => ({ status: "OK" })')).toBe('function')
  })

  it('returns null when the blob never defines compilePattern', () => {
    expect(loadCompiler('const somethingElse = 1')).toBeNull()
  })

  it('propagates a throw during blob evaluation', () => {
    expect(() => loadCompiler('throw new Error("boom")')).toThrow('boom')
  })

  it('does not leak compilePattern into the caller\'s scope', () => {
    loadCompiler('const compilePattern = () => 1')
    // eslint-disable-next-line no-undef -- intentionally checking this ISN'T defined here
    expect(typeof compilePattern).toBe('undefined')
  })
})
