// Marimapper CSV parser.
// Header: `index,x,y,z[,xn,yn,zn,error]` — 2D variant omits z/normals.
// Indices are not guaranteed to start at 0 or be contiguous; we allocate
// pixelCount = max(index) + 1 and fill missing rows with [0, 0, 0] so pattern
// pixelCount matches the real-hardware convention.

export function parseMarimapperCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  if (!lines.length) throw new Error('empty CSV')

  const header = lines[0].toLowerCase().split(',').map(s => s.trim())
  const col = {
    index: header.indexOf('index'),
    x: header.indexOf('x'),
    y: header.indexOf('y'),
    z: header.indexOf('z')
  }
  if (col.index < 0 || col.x < 0 || col.y < 0) {
    throw new Error(`CSV missing required columns (index, x, y). Got: ${header.join(',')}`)
  }
  const has3D = col.z >= 0

  const rows = []
  let maxIdx = -1
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const parts = line.split(',')
    const idx = parseInt(parts[col.index], 10)
    if (!Number.isFinite(idx) || idx < 0) continue
    const x = parseFloat(parts[col.x])
    const y = parseFloat(parts[col.y])
    const z = has3D ? parseFloat(parts[col.z]) : 0
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    rows.push({ idx, x, y, z })
    if (idx > maxIdx) maxIdx = idx
  }

  if (maxIdx < 0) throw new Error('CSV had no valid data rows')

  const pixelCount = maxIdx + 1
  const coords = new Float32Array(pixelCount * 3)
  for (const r of rows) {
    coords[r.idx * 3 + 0] = r.x
    coords[r.idx * 3 + 1] = r.y
    coords[r.idx * 3 + 2] = r.z
  }

  return {
    pixelCount,
    coords,          // interleaved xyz, raw world coords
    dimHint: has3D ? 3 : 2,
    source: 'marimapper-csv'
  }
}
