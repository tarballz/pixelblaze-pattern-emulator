// @vitest-environment happy-dom
// Widget tests need a DOM; the rest of the suite runs under node.

import { describe, it, expect, vi } from 'vitest'
import { buildControlPanel } from '../src/app/controls.js'

function build(controls) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const dispose = buildControlPanel(container, controls, '// test source')
  return { container, dispose }
}

describe('controls: showNumber / gauge read-out widgets', () => {
  it('showNumber renders the getter value and polls for updates', () => {
    vi.useFakeTimers()
    let value = 42
    const { container, dispose } = build([
      { kind: 'showNumber', name: 'showNumberPalette', label: 'Palette', fn: () => value }
    ])
    const readout = container.querySelector('.ctl-readout')
    expect(readout.textContent).toBe('42')

    value = 7.5
    vi.advanceTimersByTime(250)
    expect(readout.textContent).toBe('7.5')

    dispose()
    vi.useRealTimers()
  })

  it('gauge clamps the bar to 0..1 and shows the number', () => {
    vi.useFakeTimers()
    const { container, dispose } = build([
      { kind: 'gauge', name: 'gaugeEnergy', label: 'Energy', fn: () => 1.7 }
    ])
    const fill = container.querySelector('.ctl-gauge-fill')
    expect(fill.style.width).toBe('100%')
    expect(container.querySelector('.ctl-val').textContent).toBe('1.7')
    dispose()
    vi.useRealTimers()
  })

  it('a throwing getter shows a placeholder instead of crashing the panel', () => {
    vi.useFakeTimers()
    const { container, dispose } = build([
      { kind: 'showNumber', name: 'showNumberBad', label: 'Bad', fn: () => { throw new Error('boom') } }
    ])
    expect(container.querySelector('.ctl-readout').textContent).toBe('—')
    dispose()
    vi.useRealTimers()
  })

  it('rebuilding the panel stops the previous poller (no leaked intervals)', () => {
    vi.useFakeTimers()
    const calls = { a: 0, b: 0 }
    const { container } = build([
      { kind: 'showNumber', name: 'showNumberA', label: 'A', fn: () => { calls.a++; return 1 } }
    ])
    // Rebuild the same container with a different read-out — the old poller must die.
    buildControlPanel(container, [
      { kind: 'showNumber', name: 'showNumberB', label: 'B', fn: () => { calls.b++; return 2 } }
    ], '// other source')
    const beforeA = calls.a
    vi.advanceTimersByTime(1000)
    expect(calls.a).toBe(beforeA) // old getter no longer polled
    expect(calls.b).toBeGreaterThan(1)
    vi.useRealTimers()
  })

  it('read-outs are excluded from persisted/live values', () => {
    const { container } = build([
      { kind: 'showNumber', name: 'showNumberX', label: 'X', fn: () => 5 },
      { kind: 'slider', name: 'sliderY', label: 'Y', fn: () => {} }
    ])
    // readCurrentValues comes from the same module — import lazily to reuse container wiring.
    return import('../src/app/controls.js').then(({ readCurrentValues }) => {
      const vals = readCurrentValues(container)
      expect(vals.showNumberX).toBeUndefined()
      expect(vals.sliderY).toBe(0.5)
    })
  })
})
