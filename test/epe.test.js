import { describe, it, expect } from 'vitest'
import { parseEPE, unwrapPatternText } from '../src/app/epe.js'

const sampleSource = 'export function render(i) { hsv(i/pixelCount, 1, 1) }'
const sampleEPE = JSON.stringify({
  name: 'sample',
  id: 'abc123',
  sources: { main: sampleSource },
  preview: 'base64jpegdata'
})

describe('parseEPE', () => {
  it('unwraps sources.main', () => {
    const r = parseEPE(sampleEPE)
    expect(r).toEqual({ source: sampleSource, name: 'sample', id: 'abc123' })
  })

  it('strips UTF-8 BOM', () => {
    const r = parseEPE('\uFEFF' + sampleEPE)
    expect(r?.source).toBe(sampleSource)
  })

  it('returns null for plain JS source', () => {
    expect(parseEPE('export function render(i) { hsv(1,1,1) }')).toBeNull()
  })

  it('returns null for non-EPE JSON (no sources key)', () => {
    expect(parseEPE('{"foo": 1}')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseEPE('{not json')).toBeNull()
  })

  it('falls back to first string source when main is missing', () => {
    const text = JSON.stringify({ name: 'x', sources: { extra: sampleSource } })
    expect(parseEPE(text)?.source).toBe(sampleSource)
  })
})

describe('unwrapPatternText', () => {
  it('returns EPE source + name when input is EPE', () => {
    const r = unwrapPatternText(sampleEPE, 'fallback.epe')
    expect(r).toEqual({ source: sampleSource, name: 'sample' })
  })

  it('passes through raw JS unchanged', () => {
    const js = 'var x = 1'
    expect(unwrapPatternText(js, 'thing.js')).toEqual({ source: js, name: 'thing.js' })
  })

  it('uses fallback name when EPE lacks one', () => {
    const text = JSON.stringify({ sources: { main: sampleSource } })
    expect(unwrapPatternText(text, 'fallback.epe')).toEqual({ source: sampleSource, name: 'fallback.epe' })
  })
})
