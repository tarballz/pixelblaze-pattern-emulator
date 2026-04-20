import { describe, it, expect } from 'vitest'
import { _internals } from '../src/app/controls.js'

const { hashSource, humanize, rgbToHex, hexToRgb } = _internals

describe('controls: pure helpers', () => {
  it('hashSource is stable and distinguishes different sources', () => {
    expect(hashSource('abc')).toBe(hashSource('abc'))
    expect(hashSource('abc')).not.toBe(hashSource('abd'))
  })

  it('humanize splits CamelCase into spaced words', () => {
    expect(humanize('Brightness')).toBe('Brightness')
    expect(humanize('HueOffset')).toBe('Hue Offset')
    expect(humanize('speedX')).toBe('speed X')
  })

  it('rgbToHex / hexToRgb round-trip within 1/255', () => {
    const cases = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.25, 0.75], [1, 1, 1]]
    for (const [r, g, b] of cases) {
      const [nr, ng, nb] = hexToRgb(rgbToHex(r, g, b))
      expect(Math.abs(nr - r)).toBeLessThanOrEqual(1 / 255)
      expect(Math.abs(ng - g)).toBeLessThanOrEqual(1 / 255)
      expect(Math.abs(nb - b)).toBeLessThanOrEqual(1 / 255)
    }
  })
})
