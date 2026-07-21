import { describe, it, expect } from 'vitest'
import { frameChunks, PROTO } from '../src/app/device.js'

describe('device: binary frame chunking', () => {
  it('single small payload → one frame with FIRST|LAST', () => {
    const frames = frameChunks(PROTO.TYPE_PUT_SOURCE, new TextEncoder().encode('hello'))
    expect(frames.length).toBe(1)
    expect(frames[0][0]).toBe(PROTO.TYPE_PUT_SOURCE)
    expect(frames[0][1]).toBe(PROTO.FRAME_FIRST | PROTO.FRAME_LAST)
    expect(new TextDecoder().decode(frames[0].subarray(2))).toBe('hello')
  })

  it('large payload chunks at 1280 bytes with first/middle/last flags', () => {
    const bytes = new Uint8Array(PROTO.CHUNK * 2 + 100) // 3 frames
    bytes.fill(7)
    const frames = frameChunks(PROTO.TYPE_PUT_SOURCE, bytes)
    expect(frames.length).toBe(3)
    expect(frames[0][1]).toBe(PROTO.FRAME_FIRST)
    expect(frames[1][1]).toBe(PROTO.FRAME_MIDDLE)
    expect(frames[2][1]).toBe(PROTO.FRAME_LAST)
    // No payload byte exceeds CHUNK per frame, and reassembly is lossless.
    expect(frames[0].length - 2).toBe(PROTO.CHUNK)
    expect(frames[2].length - 2).toBe(100)
    const total = frames.reduce((n, f) => n + f.length - 2, 0)
    expect(total).toBe(bytes.length)
  })

  it('empty payload still emits one FIRST|LAST frame', () => {
    const frames = frameChunks(PROTO.TYPE_PUT_SOURCE, new Uint8Array(0))
    expect(frames.length).toBe(1)
    expect(frames[0][1]).toBe(PROTO.FRAME_FIRST | PROTO.FRAME_LAST)
    expect(frames[0].length).toBe(2)
  })

  it('exact multiple of CHUNK does not emit a trailing empty frame', () => {
    const frames = frameChunks(PROTO.TYPE_PUT_SOURCE, new Uint8Array(PROTO.CHUNK * 2))
    expect(frames.length).toBe(2)
    expect(frames[0][1]).toBe(PROTO.FRAME_FIRST)
    expect(frames[1][1]).toBe(PROTO.FRAME_LAST)
  })
})
