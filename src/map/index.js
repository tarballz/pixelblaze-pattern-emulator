// Public map loader entry: content → { pixelCount, coords, normalized, dim }.

import { parseMarimapperCSV } from './csv.js'
import { parsePixelblazeJSON } from './json.js'
import { runMapperFunction } from './mapperFn.js'
import { normalize } from './normalize.js'
import { detectDim } from './dispatch.js'

// Auto-detect format from content. Works for all four input methods.
export function parseMapContent(text, { pixelCountHint = 1024 } = {}) {
  const trimmed = text.trim()

  // JS mapper function: starts with "function" or an arrow pattern like "(pixelCount) =>"
  if (/^(function\s*\(|\(\s*\w*\s*\)\s*=>|\w+\s*=>)/.test(trimmed)) {
    return runMapperFunction(trimmed, pixelCountHint)
  }

  // JSON array
  if (trimmed.startsWith('[')) {
    return parsePixelblazeJSON(trimmed)
  }

  // CSV (header row)
  if (/^index\s*,/i.test(trimmed)) {
    return parseMarimapperCSV(trimmed)
  }

  throw new Error('Could not detect map format (expected CSV, JSON array, or JS function)')
}

export function prepareMap(parsed, { normalizeMode = 'fill', swapYZ = false, forceDim } = {}) {
  const normalized = normalize(parsed.coords, { mode: normalizeMode, swapYZ })
  const dim = detectDim(parsed, forceDim)
  return {
    ...parsed,
    normalized,
    dim
  }
}

export { normalize, detectDim }
export { parseMarimapperCSV } from './csv.js'
export { parsePixelblazeJSON } from './json.js'
export { runMapperFunction } from './mapperFn.js'
export { selectRenderFn, selectRenderFnInfo } from './dispatch.js'
