import { describe, it, expect } from 'vitest'
import { samplePalette, setPalette, getPalette } from '../src/vm/currentPixel.js'

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
