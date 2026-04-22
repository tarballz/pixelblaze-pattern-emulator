import { describe, it, expect } from 'vitest'
import { samplePalette, setPalette, getPalette, paint, resetPixel, readPixel } from '../src/vm/currentPixel.js'

describe('samplePalette', () => {
  it('returns the exact stop color at its position', () => {
    const p = [0, 1, 0, 0,  0.5, 0, 1, 0,  1, 0, 0, 1]
    expect(samplePalette(p, 0)).toEqual([1, 0, 0])
    expect(samplePalette(p, 0.5)).toEqual([0, 1, 0])
    expect(samplePalette(p, 1)).toEqual([0, 0, 1])
  })

  it('linearly interpolates between stops', () => {
    const p = [0, 0, 0, 0,  1, 1, 1, 1]
    const mid = samplePalette(p, 0.5)
    expect(mid[0]).toBeCloseTo(0.5, 6)
    expect(mid[1]).toBeCloseTo(0.5, 6)
    expect(mid[2]).toBeCloseTo(0.5, 6)
  })

  it('quarter-point between red and green is mostly red', () => {
    const p = [0, 1, 0, 0,  1, 0, 1, 0]
    const q = samplePalette(p, 0.25)
    expect(q[0]).toBeCloseTo(0.75, 6)
    expect(q[1]).toBeCloseTo(0.25, 6)
    expect(q[2]).toBeCloseTo(0, 6)
  })
})

describe('setPalette / getPalette', () => {
  it('nested form is flattened at set time', () => {
    setPalette([[0, 1, 0, 0], [1, 0, 0, 1]])
    expect(getPalette()).toEqual([0, 1, 0, 0, 1, 0, 0, 1])
  })

  it('flat form is held by reference (mutations propagate)', () => {
    const arr = [0, 0, 0, 0, 1, 1, 1, 1]
    setPalette(arr)
    arr[1] = 0.5
    expect(getPalette()[1]).toBe(0.5)
  })

  it('empty input clears the palette', () => {
    setPalette([1, 1, 1, 1])
    setPalette([])
    expect(getPalette()).toBe(null)
  })
})

describe('paint() — inlined palette sampling', () => {
  function readRGB() {
    const out = new Float32Array(3)
    readPixel(out, 0)
    return [out[0], out[1], out[2]]
  }

  it('matches samplePalette output at stops and midpoints', () => {
    const p = [0, 1, 0, 0,  0.5, 0, 1, 0,  1, 0, 0, 1]
    setPalette(p)
    for (const v of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      resetPixel()
      paint(v, 1)
      const got = readRGB()
      const [r, g, b] = samplePalette(p, v - Math.floor(v))
      expect(got[0]).toBeCloseTo(r, 6)
      expect(got[1]).toBeCloseTo(g, 6)
      expect(got[2]).toBeCloseTo(b, 6)
    }
  })

  it('wraps value into [0,1)', () => {
    const p = [0, 1, 0, 0,  1, 0, 0, 1]
    setPalette(p)
    resetPixel(); paint(0.25, 1)
    const a = readRGB()
    resetPixel(); paint(1.25, 1)
    const b = readRGB()
    resetPixel(); paint(-0.75, 1)
    const c = readRGB()
    expect(b[0]).toBeCloseTo(a[0], 6); expect(b[2]).toBeCloseTo(a[2], 6)
    expect(c[0]).toBeCloseTo(a[0], 6); expect(c[2]).toBeCloseTo(a[2], 6)
  })

  it('brightness scales output channels', () => {
    setPalette([0, 1, 1, 1,  1, 1, 1, 1])
    resetPixel(); paint(0.3, 0.25)
    const rgb = readRGB()
    expect(rgb[0]).toBeCloseTo(0.25, 6)
    expect(rgb[1]).toBeCloseTo(0.25, 6)
    expect(rgb[2]).toBeCloseTo(0.25, 6)
  })

  it('falls back to hsv when no palette is set', () => {
    setPalette([])
    resetPixel(); paint(0, 1)
    const rgb = readRGB()
    expect(rgb[0]).toBeCloseTo(1, 3)
    expect(rgb[1]).toBeCloseTo(0, 3)
    expect(rgb[2]).toBeCloseTo(0, 3)
  })
})
