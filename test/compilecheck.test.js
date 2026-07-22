// Exercises compilecheck.js's client-side logic (fetch + Worker orchestration)
// against a fake fetch/Worker — no real network or Worker thread involved,
// so this runs under the default node environment like most of the suite.
// The real endpoint/Worker were verified manually against the actual
// pixelblaze-client compiler cache during development.

import { describe, it, expect, vi, beforeEach } from 'vitest'

class FakeWorker {
  constructor() {
    this.onmessage = null
    FakeWorker.last = this
  }
  postMessage(msg) {
    FakeWorker.posted.push(msg)
    const reply = FakeWorker.handler(msg)
    if (reply) queueMicrotask(() => this.onmessage?.({ data: reply }))
  }
}
FakeWorker.posted = []
FakeWorker.handler = () => null

beforeEach(() => {
  FakeWorker.posted = []
  FakeWorker.last = null
  FakeWorker.handler = () => null
  vi.stubGlobal('Worker', FakeWorker)
  vi.resetModules() // compilecheck.js has top-level singleton state — force a fresh module per test
})

function stubFetchOk(version, source) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ version, source }) })))
}

function stubFetch404() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
}

describe('compilecheck', () => {
  it('resolves { available: false } when no compiler is cached', async () => {
    stubFetch404()
    const { checkCompile } = await import('../src/vm/compilecheck.js')
    const result = await checkCompile('export function render(i){}')
    expect(result).toEqual({ available: false })
  })

  it('resolves { available: false } when the worker fails to initialize', async () => {
    stubFetchOk('3.51', 'BAD_COMPILER_SRC')
    FakeWorker.handler = (msg) => (msg.compilerSrc !== undefined ? { id: msg.id, ready: false } : null)
    const { checkCompile } = await import('../src/vm/compilecheck.js')
    const result = await checkCompile('export function render(i){}')
    expect(result).toEqual({ available: false })
  })

  it('initializes the worker with the fetched compiler source, then reports status per call', async () => {
    stubFetchOk('3.51', 'FAKE_COMPILER_SRC')
    FakeWorker.handler = (msg) =>
      msg.compilerSrc !== undefined ? { id: msg.id, ready: true } : { id: msg.id, status: 'OK' }
    const { checkCompile } = await import('../src/vm/compilecheck.js')
    const result = await checkCompile('export function render(i){}')
    expect(result).toEqual({ available: true, status: 'OK', version: '3.51' })
    expect(FakeWorker.posted[0]).toMatchObject({ compilerSrc: 'FAKE_COMPILER_SRC' })
  })

  it('surfaces the real compiler error text on failure', async () => {
    stubFetchOk('3.51', 'X')
    FakeWorker.handler = (msg) =>
      msg.compilerSrc !== undefined
        ? { id: msg.id, ready: true }
        : { id: msg.id, status: 'Unexpected token at line 4 column 12' }
    const { checkCompile } = await import('../src/vm/compilecheck.js')
    const result = await checkCompile('let {a} = b')
    expect(result).toEqual({ available: true, status: 'Unexpected token at line 4 column 12', version: '3.51' })
  })

  it('fetches and initializes the worker only once across multiple checkCompile calls', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ version: '3.51', source: 'X' }) }))
    vi.stubGlobal('fetch', fetchSpy)
    let initCalls = 0
    FakeWorker.handler = (msg) => {
      if (msg.compilerSrc !== undefined) {
        initCalls++
        return { id: msg.id, ready: true }
      }
      return { id: msg.id, status: 'OK' }
    }
    const { checkCompile } = await import('../src/vm/compilecheck.js')
    await Promise.all([checkCompile('a'), checkCompile('b'), checkCompile('c')])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(initCalls).toBe(1)
  })

  it('correlates concurrent calls by id rather than resolving in send order', async () => {
    stubFetchOk('3.51', 'X')
    FakeWorker.handler = (msg) => {
      if (msg.compilerSrc !== undefined) return { id: msg.id, ready: true }
      // Deliberately reply to the SECOND request before the first.
      return { id: msg.id, status: `status-for-${msg.source}`, __delay: msg.source === 'first' ? 10 : 0 }
    }
    const { checkCompile } = await import('../src/vm/compilecheck.js')
    const [first, second] = await Promise.all([checkCompile('first'), checkCompile('second')])
    expect(first.status).toBe('status-for-first')
    expect(second.status).toBe('status-for-second')
  })
})
