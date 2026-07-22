// Pure hardware-FPS model. Expected values are hand-computed from the
// documented constants (48k px/s compute, WS2812 33k px/s + 300us latch).
import { describe, it, expect } from 'vitest'
import { HW_EST, estimateHardwareFps, estimateHardware } from '../src/vm/hwmodel.js'

describe('estimateHardwareFps', () => {
  it('is output-bound on a big WS2812 rig with a cheap pattern', () => {
    // tCompute = 1449/48000 = 0.030188 ; tOutput = 1449/33000 + 0.0003 = 0.044209
    const fps = estimateHardwareFps({ pixelCount: 1449, outputMethod: 'ws2812', expensiveOpCount: 0 })
    expect(fps).toBeCloseTo(22.62, 1)
  })

  it('becomes compute-bound once the pattern is expensive', () => {
    // computeRate = 48000/(1+0.15*10) = 19200 ; tCompute = 1449/19200 = 0.075469
    const fps = estimateHardwareFps({ pixelCount: 1449, outputMethod: 'ws2812', expensiveOpCount: 10 })
    expect(fps).toBeCloseTo(13.25, 1)
  })

  it('clamps to MAX_DISPLAY_FPS on tiny rigs', () => {
    const fps = estimateHardwareFps({ pixelCount: 100, outputMethod: 'ws2812', expensiveOpCount: 0 })
    expect(fps).toBe(HW_EST.MAX_DISPLAY_FPS)
  })

  it('treats apa102 as unbounded output (always compute-bound)', () => {
    const apa = estimateHardwareFps({ pixelCount: 1449, outputMethod: 'apa102', expensiveOpCount: 10 })
    const ws  = estimateHardwareFps({ pixelCount: 1449, outputMethod: 'ws2812', expensiveOpCount: 10 })
    expect(apa).toBeCloseTo(13.25, 1)   // compute term only
    expect(apa).toBeGreaterThanOrEqual(ws)
  })

  it('expander lifts the output ceiling above ws2812', () => {
    const exp = estimateHardwareFps({ pixelCount: 1449, outputMethod: 'expander', expensiveOpCount: 0 })
    const ws  = estimateHardwareFps({ pixelCount: 1449, outputMethod: 'ws2812', expensiveOpCount: 0 })
    expect(exp).toBeGreaterThan(ws)
  })

  it('falls back to ws2812 for an unknown output method', () => {
    const unknown = estimateHardwareFps({ pixelCount: 1449, outputMethod: 'nonsense', expensiveOpCount: 0 })
    const ws = estimateHardwareFps({ pixelCount: 1449, outputMethod: 'ws2812', expensiveOpCount: 0 })
    expect(unknown).toBe(ws)
  })

  it('returns null without a pixel count', () => {
    expect(estimateHardwareFps({ pixelCount: 0, outputMethod: 'ws2812', expensiveOpCount: 0 })).toBeNull()
    expect(estimateHardwareFps({ pixelCount: undefined, outputMethod: 'ws2812', expensiveOpCount: 0 })).toBeNull()
  })
})

describe('estimateHardware', () => {
  it('reports output-bound with matching fps and times for a cheap pattern', () => {
    // Same fixture as the output-bound estimateHardwareFps case above.
    const { fps, bound, tCompute, tOutput } =
      estimateHardware({ pixelCount: 1449, outputMethod: 'ws2812', expensiveOpCount: 0 })
    expect(bound).toBe('output')
    expect(fps).toBeCloseTo(22.62, 1)
    expect(tCompute).toBeLessThan(tOutput)
    expect(fps).toBeCloseTo(1 / tOutput, 5)
  })

  it('reports compute-bound with matching fps and times for an expensive pattern', () => {
    // Same fixture as the compute-bound estimateHardwareFps case above.
    const { fps, bound, tCompute, tOutput } =
      estimateHardware({ pixelCount: 1449, outputMethod: 'ws2812', expensiveOpCount: 10 })
    expect(bound).toBe('compute')
    expect(fps).toBeCloseTo(13.25, 1)
    expect(tCompute).toBeGreaterThanOrEqual(tOutput)
    expect(fps).toBeCloseTo(1 / tCompute, 5)
  })

  it('agrees with estimateHardwareFps on the fps value', () => {
    const params = { pixelCount: 1449, outputMethod: 'expander', expensiveOpCount: 3 }
    expect(estimateHardware(params).fps).toBe(estimateHardwareFps(params))
  })

  it('returns null fps and bound without a pixel count', () => {
    const result = estimateHardware({ pixelCount: 0, outputMethod: 'ws2812', expensiveOpCount: 0 })
    expect(result.fps).toBeNull()
    expect(result.bound).toBeNull()
  })
})
