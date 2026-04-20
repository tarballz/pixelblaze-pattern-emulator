import { describe, it, expect } from 'vitest'
import { generateMap } from '../src/map/generate.js'
import { detectDim } from '../src/map/dispatch.js'
import { normalize } from '../src/map/normalize.js'

describe('generateMap', () => {
  it('1D produces a line of N pixels along x', () => {
    const m = generateMap({ shape: '1d', w: 10 })
    expect(m.pixelCount).toBe(10)
    expect(m.dimHint).toBe(1)
    // y and z are zero for every pixel
    for (let i = 0; i < 10; i++) {
      expect(m.coords[i * 3]).toBe(i)
      expect(m.coords[i * 3 + 1]).toBe(0)
      expect(m.coords[i * 3 + 2]).toBe(0)
    }
  })

  it('2D grid is row-major w×h', () => {
    const m = generateMap({ shape: '2d', w: 3, h: 2 })
    expect(m.pixelCount).toBe(6)
    expect(m.dimHint).toBe(2)
    // Row 0: (0,0), (1,0), (2,0); Row 1: (0,1), (1,1), (2,1)
    const expected = [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]]
    expected.forEach(([x, y], i) => {
      expect(m.coords[i * 3]).toBe(x)
      expect(m.coords[i * 3 + 1]).toBe(y)
      expect(m.coords[i * 3 + 2]).toBe(0)
    })
  })

  it('3D cube is w×h×d volume-major', () => {
    const m = generateMap({ shape: '3d', w: 2, h: 2, d: 2 })
    expect(m.pixelCount).toBe(8)
    expect(m.dimHint).toBe(3)
    // Pixel 7 should be at (1, 1, 1)
    expect(m.coords[7 * 3]).toBe(1)
    expect(m.coords[7 * 3 + 1]).toBe(1)
    expect(m.coords[7 * 3 + 2]).toBe(1)
  })

  it('clamps sizes to at least 1', () => {
    const m = generateMap({ shape: '2d', w: 0, h: -3 })
    expect(m.pixelCount).toBe(1)
  })

  it('rejects unknown shapes', () => {
    expect(() => generateMap({ shape: '4d' })).toThrow()
  })

  it('detectDim respects dimHint=1 for generated 1D maps', () => {
    const m = generateMap({ shape: '1d', w: 5 })
    expect(detectDim(m)).toBe(1)
  })

  it('normalizes generated 2D to [0, 1) as fill', () => {
    const m = generateMap({ shape: '2d', w: 4, h: 4 })
    const n = normalize(m.coords, { mode: 'fill' })
    expect(n.nx[0]).toBe(0)
    expect(n.nx[3]).toBeCloseTo(1, 5)  // last column reaches 1-eps
    expect(n.ny[12]).toBeCloseTo(1, 5)  // first pixel of last row
  })
})
