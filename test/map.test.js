import { describe, it, expect } from 'vitest'
import { parseMarimapperCSV } from '../src/map/csv.js'
import { parsePixelblazeJSON } from '../src/map/json.js'
import { runMapperFunction } from '../src/map/mapperFn.js'
import { normalize } from '../src/map/normalize.js'
import { detectDim, selectRenderFn } from '../src/map/dispatch.js'

describe('marimapper CSV parser', () => {
  it('parses a basic 3D CSV with sparse indices', () => {
    const text = [
      'index,x,y,z,xn,yn,zn,error',
      '0,1.0,2.0,3.0,0,0,0,0',
      '2,4.0,5.0,6.0,0,0,0,0'
    ].join('\n')
    const map = parseMarimapperCSV(text)
    expect(map.pixelCount).toBe(3)
    expect(map.dimHint).toBe(3)
    expect(map.coords[0 * 3 + 0]).toBeCloseTo(1.0)
    expect(map.coords[2 * 3 + 0]).toBeCloseTo(4.0)
    // Missing index 1 filled with zeros.
    expect(map.coords[1 * 3 + 0]).toBe(0)
  })

  it('parses a 2D CSV (no z column)', () => {
    const text = 'index,x,y\n0,10,20\n1,30,40'
    const map = parseMarimapperCSV(text)
    expect(map.dimHint).toBe(2)
    expect(map.coords[0 * 3 + 2]).toBe(0)
  })
})

describe('Pixelblaze JSON parser', () => {
  it('parses a 2D JSON array', () => {
    const map = parsePixelblazeJSON('[[0,0],[1,0],[1,1],[0,1]]')
    expect(map.pixelCount).toBe(4)
    expect(map.dimHint).toBe(2)
  })
  it('parses a 3D JSON array', () => {
    const map = parsePixelblazeJSON('[[0,0,0],[1,0,0],[0,1,0],[0,0,1]]')
    expect(map.dimHint).toBe(3)
  })
})

describe('mapper-function evaluator', () => {
  it('runs the canonical README zigzag example', () => {
    const source = `
      function (pixelCount) {
        width = 8
        var map = []
        for (i = 0; i < pixelCount; i++) {
          y = Math.floor(i / width)
          x = i % width
          x = y % 2 == 1 ? width - 1 - x : x
          map.push([x, y])
        }
        return map
      }
    `
    const map = runMapperFunction(source, 64)
    expect(map.pixelCount).toBe(64)
    expect(map.dimHint).toBe(2)
    // Row 0: 0..7; row 1: 7..0 (zigzag)
    expect(map.coords[0 * 3 + 0]).toBe(0)
    expect(map.coords[7 * 3 + 0]).toBe(7)
    expect(map.coords[8 * 3 + 0]).toBe(7)
    expect(map.coords[15 * 3 + 0]).toBe(0)
  })
})

describe('normalize', () => {
  it('fill mode: per-axis independent scaling into [0, 1)', () => {
    // 3 points: (0,0,0), (10,5,0), (20,10,0)
    const coords = new Float32Array([0, 0, 0, 10, 5, 0, 20, 10, 0])
    const { nx, ny, nz } = normalize(coords, { mode: 'fill' })
    expect(nx[0]).toBeCloseTo(0, 5)
    expect(nx[2]).toBeLessThan(1) // strict exclusive
    expect(nx[2]).toBeGreaterThan(0.9999)
    // Each axis scaled independently → y reaches ~1 too
    expect(ny[2]).toBeGreaterThan(0.9999)
  })

  it('contain mode: preserves aspect ratio', () => {
    // Same 2:1 aspect ratio points. x span = 20, y span = 10, z = 0.
    const coords = new Float32Array([0, 0, 0, 10, 5, 0, 20, 10, 0])
    const { nx, ny } = normalize(coords, { mode: 'contain' })
    // x should reach ~1, y should only reach ~0.5
    expect(nx[2]).toBeGreaterThan(0.9999)
    expect(ny[2]).toBeCloseTo(0.5, 2)
  })

  it('upper bound is strictly < 1', () => {
    const coords = new Float32Array([0, 0, 0, 1, 1, 1])
    const { nx } = normalize(coords, { mode: 'fill' })
    expect(nx[1]).toBeLessThan(1)
  })

  it('swapYZ flips y and z', () => {
    const coords = new Float32Array([0, 0, 0, 10, 20, 30])
    const { ny, nz } = normalize(coords, { mode: 'fill', swapYZ: true })
    // After swap, the coord that was z=30 becomes the y axis; y=20 goes to z axis.
    // Both axes reach ~1 since each is normalized to its own span.
    expect(ny[1]).toBeGreaterThan(0.9999)
    expect(nz[1]).toBeGreaterThan(0.9999)
  })
})

describe('render-function dispatch cascade', () => {
  it('3D map prefers render3D when available', () => {
    let called = ''
    const exports = { render3D: () => { called = '3d' }, render2D: () => { called = '2d' } }
    const fn = selectRenderFn(3, exports)
    fn(0, new Float32Array([0.5]), new Float32Array([0.5]), new Float32Array([0.5]), 1)
    expect(called).toBe('3d')
  })

  it('3D map falls back to render2D when only render2D is defined', () => {
    let called = ''
    const exports = { render2D: () => { called = '2d' } }
    const fn = selectRenderFn(3, exports)
    fn(0, new Float32Array([0.5]), new Float32Array([0.5]), new Float32Array([0.5]), 1)
    expect(called).toBe('2d')
  })

  it('2D map calls render3D with z=0.5 when only render3D is defined', () => {
    let zSeen
    const exports = { render3D: (_i, _x, _y, z) => { zSeen = z } }
    const fn = selectRenderFn(2, exports)
    fn(0, new Float32Array([0.1]), new Float32Array([0.2]), new Float32Array([0]), 1)
    expect(zSeen).toBe(0.5)
  })

  it('1D map with only render3D supplies x=i/pc and y=z=0.5', () => {
    let args
    const exports = { render3D: (i, x, y, z) => { args = [i, x, y, z] } }
    const fn = selectRenderFn(1, exports)
    fn(3, null, null, null, 10)
    expect(args).toEqual([3, 0.3, 0.5, 0.5])
  })
})

describe('detectDim', () => {
  it('respects a forced override', () => {
    expect(detectDim({ dimHint: 3, coords: new Float32Array(3), pixelCount: 1 }, 2)).toBe(2)
  })
  it('downgrades to 2D when all z are zero', () => {
    const map = { dimHint: 3, coords: new Float32Array([0, 0, 0, 1, 1, 0]), pixelCount: 2 }
    expect(detectDim(map)).toBe(2)
  })
  it('keeps 3D when any z is non-zero', () => {
    const map = { dimHint: 3, coords: new Float32Array([0, 0, 0, 1, 1, 0.5]), pixelCount: 2 }
    expect(detectDim(map)).toBe(3)
  })
})
