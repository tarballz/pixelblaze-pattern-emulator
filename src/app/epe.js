// Pixelblaze EPE (Encoded Pattern Envelope) — JSON wrapper around a pattern's
// source. Real-world shape observed:
//   { name: string, id: string, sources: { main: string, ... }, preview: string }
// `sources.main` is the raw pattern JS (not base64). Files may include a UTF-8
// BOM. `preview` is a base64 JPEG we don't need.

export function parseEPE(text) {
  if (typeof text !== 'string' || !text.length) return null
  const stripped = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
  // Cheap gate — only try JSON.parse when it plausibly is one.
  if (stripped.trimStart()[0] !== '{') return null
  let obj
  try { obj = JSON.parse(stripped) } catch { return null }
  if (!obj || typeof obj !== 'object' || !obj.sources || typeof obj.sources !== 'object') return null
  const src = typeof obj.sources.main === 'string'
    ? obj.sources.main
    : Object.values(obj.sources).find(v => typeof v === 'string')
  if (typeof src !== 'string') return null
  return {
    source: src,
    name: typeof obj.name === 'string' ? obj.name : null,
    id: typeof obj.id === 'string' ? obj.id : null
  }
}

// Returns { source, name } — unwraps an EPE if it is one, else passes through.
export function unwrapPatternText(text, fallbackName = null) {
  const epe = parseEPE(text)
  if (epe) return { source: epe.source, name: epe.name || fallbackName }
  return { source: text, name: fallbackName }
}
