import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createWatcher } from '../src/app/watcher.js'

function fakeResponse(body, ok = true) {
  return { ok, text: async () => body }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('createWatcher', () => {
  it('fires onChange only when body changes (not on first tick, not on identical ticks)', async () => {
    let body = 'v1'
    const fetchImpl = vi.fn(async () => fakeResponse(body))
    const w = createWatcher({ intervalMs: 100, fetchImpl })
    const onChange = vi.fn()
    w.watch('pattern', { kind: 'path', value: '/x.js' }, onChange)

    // First tick: baseline, no callback.
    await vi.advanceTimersByTimeAsync(1)
    expect(onChange).not.toHaveBeenCalled()

    // Same body next tick: still no callback.
    await vi.advanceTimersByTimeAsync(100)
    expect(onChange).not.toHaveBeenCalled()

    // Body changes: callback fires with new text.
    body = 'v2'
    await vi.advanceTimersByTimeAsync(100)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('v2')

    // Body unchanged again: no callback.
    await vi.advanceTimersByTimeAsync(100)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('stop(key) cancels future callbacks', async () => {
    let body = 'a'
    const fetchImpl = vi.fn(async () => fakeResponse(body))
    const w = createWatcher({ intervalMs: 50, fetchImpl })
    const onChange = vi.fn()
    w.watch('pattern', { kind: 'path', value: '/x.js' }, onChange)
    await vi.advanceTimersByTimeAsync(1)   // baseline
    w.stop('pattern')
    body = 'b'
    await vi.advanceTimersByTimeAsync(500)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('ignores non-path/url descriptors without firing', async () => {
    const fetchImpl = vi.fn()
    const w = createWatcher({ intervalMs: 50, fetchImpl })
    const onChange = vi.fn()
    w.watch('pattern', { kind: 'file', value: null, name: 'f.js' }, onChange)
    w.watch('map',     { kind: 'paste', value: 'x' }, onChange)
    w.watch('x',       { kind: 'generated', value: '{}' }, onChange)
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('setEnabled(false) pauses polling and setEnabled(true) resumes', async () => {
    let body = 'a'
    const fetchImpl = vi.fn(async () => fakeResponse(body))
    const w = createWatcher({ intervalMs: 100, fetchImpl })
    const onChange = vi.fn()
    w.watch('pattern', { kind: 'path', value: '/x.js' }, onChange)
    await vi.advanceTimersByTimeAsync(1)  // baseline
    const calls0 = fetchImpl.mock.calls.length

    w.setEnabled(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchImpl.mock.calls.length).toBe(calls0)

    w.setEnabled(true)
    body = 'b'
    await vi.advanceTimersByTimeAsync(50)
    // After re-enable, a fresh baseline tick happens first — so first change
    // shows up only on a later tick.
    body = 'c'
    await vi.advanceTimersByTimeAsync(150)
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('silently swallows fetch errors and keeps polling', async () => {
    let body = 'ok'
    let shouldThrow = true
    const fetchImpl = vi.fn(async () => {
      if (shouldThrow) throw new Error('net down')
      return fakeResponse(body)
    })
    const w = createWatcher({ intervalMs: 50, fetchImpl })
    const onChange = vi.fn()
    w.watch('pattern', { kind: 'path', value: '/x.js' }, onChange)
    await vi.advanceTimersByTimeAsync(200)
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1)  // retried

    shouldThrow = false
    await vi.advanceTimersByTimeAsync(100)  // baseline (first successful tick)
    body = 'updated'
    await vi.advanceTimersByTimeAsync(100)
    expect(onChange).toHaveBeenCalledWith('updated')
  })

  it('watch(key, ...) replaces the prior watch for that key', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse('same'))
    const w = createWatcher({ intervalMs: 50, fetchImpl })
    const onChange = vi.fn()
    w.watch('pattern', { kind: 'path', value: '/a.js' }, onChange)
    await vi.advanceTimersByTimeAsync(1)
    w.watch('pattern', { kind: 'path', value: '/b.js' }, onChange)
    await vi.advanceTimersByTimeAsync(100)
    // Latest watched descriptor is /b.js; /a.js shouldn't be polled anymore.
    const urls = fetchImpl.mock.calls.map(c => c[0])
    expect(urls.at(-1)).toBe('/b.js')
  })
})
