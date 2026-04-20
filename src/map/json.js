// Pixelblaze JSON map parser.
// Format: top-level array where each element is [x, y] (2D) or [x, y, z] (3D).
// Per canonical README.mapper.md: "Each element in the top level array represents
// a pixel. Within a pixel, an array with elements for the x, y, and optionally z".

export function parsePixelblazeJSON(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new Error(`JSON map parse error: ${err.message}`)
  }
  if (!Array.isArray(data)) {
    throw new Error('JSON map must be a top-level array')
  }
  return arrayToMap(data, 'pixelblaze-json')
}

// Shared by JSON parser and the mapper-function evaluator.
export function arrayToMap(data, sourceLabel = 'array') {
  const pixelCount = data.length
  if (!pixelCount) throw new Error('map is empty')

  // Determine dimensionality from the first entry; tolerate mixed but assume 3D if any row has 3 coords.
  let dim = 2
  for (const row of data) {
    if (Array.isArray(row) && row.length >= 3 && Number.isFinite(row[2])) { dim = 3; break }
  }

  const coords = new Float32Array(pixelCount * 3)
  for (let i = 0; i < pixelCount; i++) {
    const row = data[i]
    if (!Array.isArray(row)) {
      throw new Error(`map row ${i} is not an array`)
    }
    coords[i * 3 + 0] = Number(row[0]) || 0
    coords[i * 3 + 1] = Number(row[1]) || 0
    coords[i * 3 + 2] = dim === 3 && row.length >= 3 ? Number(row[2]) || 0 : 0
  }

  return { pixelCount, coords, dimHint: dim, source: sourceLabel }
}
